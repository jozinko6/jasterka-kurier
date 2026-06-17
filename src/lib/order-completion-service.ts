/**
 * Order completion service.
 *
 * This is the SINGLE place where an order is marked as DELIVERED and all
 * financial side-effects are triggered. The ENTIRE operation is one database
 * transaction — if any step fails, nothing is persisted:
 * - Conditional order update (compare-and-swap on status)
 * - Remuneration snapshot finalization
 * - Earning ledger entries creation (idempotent via idempotencyKey)
 * - Cash ledger entry creation (if CASH payment)
 * - Delivery assignment update
 * - Courier active order count recalculation
 * - Status history creation
 *
 * Idempotency: if the order is already DELIVERED by the same courier,
 * returns existing entries without creating duplicates.
 */

import { db } from '@/lib/db'
import type { OrderStatus } from '@prisma/client'
import { Prisma } from '@prisma/client'
import { calculateOrderRemuneration, type RemunerationPlanSnapshot, type OrderCompensationInput } from '@/lib/remuneration'
import { getBratislavaPeriodForDate } from '@/lib/payout-periods'

export interface CompleteOrderResult {
  orderId: string
  orderStatus: OrderStatus
  totalEarningsCents: number
  earningEntryIds: string[]
  cashCollectedCents: number | null
  idempotent: boolean
}

/**
 * Mark an order as DELIVERED and create all financial records.
 * The ENTIRE operation is a single database transaction.
 *
 * Idempotent: if the order is already DELIVERED by the same courier,
 * returns existing entries without creating duplicates.
 *
 * Caller must verify that the requesting courier owns the active assignment.
 */
export async function completeDeliveryOrder(
  orderId: string,
  courierId: string,
  actorUserId: string,
  options?: {
    tipCents?: number
    isBadWeather?: boolean
    actualDistanceMeters?: number
    idempotencyKey?: string
  }
): Promise<CompleteOrderResult> {
  const occurredAt = new Date()
  const idempotencyKey = options?.idempotencyKey || `complete:${orderId}:${courierId}`

  try {
    const result = await db.$transaction(async (tx) => {
      // 1. Load order with assignment (within transaction for consistency)
      // Include DELIVERED assignments too, for idempotent retry
      const order = await tx.order.findUnique({
        where: { id: orderId },
        include: {
          assignments: {
            where: {
              courierId,
              status: { in: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'DELIVERED'] },
            },
            take: 1,
          },
          deliveryZone: true,
        },
      })

      if (!order) {
        throw new CompleteOrderError('ORDER_NOT_FOUND', 'Objednávka nenájdená')
      }

      const assignment = order.assignments[0]

      // 2. If already delivered by same courier → idempotent return
      if (order.status === 'DELIVERED' && assignment?.status === 'DELIVERED') {
        const existingEntries = await tx.earningLedgerEntry.findMany({
          where: { orderId, type: { not: 'REVERSAL' }, status: 'CONFIRMED' },
          select: { id: true, amountCents: true },
        })
        const total = existingEntries.reduce((s, e) => s + e.amountCents, 0)

        // Get current cash balance for this courier
        const cashEntry = await tx.cashLedgerEntry.findFirst({
          where: { orderId, courierId, type: 'CASH_COLLECTED' },
          select: { balanceAfterCents: true },
        })

        return {
          orderId,
          orderStatus: 'DELIVERED' as OrderStatus,
          totalEarningsCents: total,
          earningEntryIds: existingEntries.map((e) => e.id),
          cashCollectedCents: cashEntry?.balanceAfterCents ?? null,
          idempotent: true,
        }
      }

      // 3. Verify ownership (courier must have an active assignment)
      if (!assignment || assignment.courierId !== courierId) {
        throw new CompleteOrderError('NOT_ASSIGNED', 'Objednávka nie je priradená tomuto kuriérovi')
      }

      // 4. Conditional update (compare-and-swap on status)
      const updateResult = await tx.order.updateMany({
        where: {
          id: orderId,
          status: { in: ['PICKED_UP', 'ON_THE_WAY'] },
        },
        data: {
          status: 'DELIVERED',
          deliveredAt: occurredAt,
        },
      })

      if (updateResult.count !== 1) {
        // Status changed between our read and update — race condition
        throw new CompleteOrderError('STATUS_CONFLICT', 'Objednávku medzičasom zmenil iný používateľ.')
      }

      // 5. Load remuneration plan snapshot for this courier
      const planData = await loadPlanSnapshotForCourierTx(tx, courierId, occurredAt)
      if (!planData) {
        throw new CompleteOrderError('NO_PLAN', 'Pre kuriéra nebol nájdený žiadny sadzobník.')
      }

      // 6. Calculate remuneration
      const input: OrderCompensationInput = {
        orderId,
        orderNumber: order.orderNumber,
        courierId,
        zoneId: order.deliveryZoneId,
        totalDistanceMeters: options?.actualDistanceMeters,
        tipCents: options?.tipCents,
        isBadWeather: options?.isBadWeather,
        occurredAt,
        courierOverrides: planData.overrides,
      }
      const calculation = calculateOrderRemuneration(planData.snapshot, input)

      // 7. Create or get remuneration snapshot (immutable)
      let snapshotId: string
      const existingSnapshot = await tx.orderRemunerationSnapshot.findUnique({
        where: { orderId },
        select: { id: true },
      })
      if (existingSnapshot) {
        snapshotId = existingSnapshot.id
        await tx.orderRemunerationSnapshot.update({
          where: { id: snapshotId },
          data: { actualTotalCents: calculation.totalCents },
        })
      } else {
        const created = await tx.orderRemunerationSnapshot.create({
          data: {
            orderId,
            courierId,
            remunerationPlanVersionId: planData.versionId,
            planSnapshotJson: JSON.stringify(planData.snapshot),
            estimatedTotalCents: calculation.totalCents,
            actualTotalCents: calculation.totalCents,
          },
          select: { id: true },
        })
        snapshotId = created.id
      }

      // 8. Create earning ledger entries (idempotent via unique idempotencyKey)
      const earningEntryIds: string[] = []
      for (let i = 0; i < calculation.components.length; i++) {
        const component = calculation.components[i]
        const entryIdempotencyKey = `order:${orderId}:${component.type}:${i}`

        // Try to find existing first
        let entry = await tx.earningLedgerEntry.findUnique({
          where: { idempotencyKey: entryIdempotencyKey },
          select: { id: true },
        })

        if (!entry) {
          // Get or create payout period
          const payoutPeriodId = await getOrCreatePayoutPeriodIdTx(tx, courierId, occurredAt)

          entry = await tx.earningLedgerEntry.create({
            data: {
              courierId,
              orderId,
              assignmentId: assignment.id,
              payoutPeriodId,
              type: component.type,
              amountCents: component.amountCents,
              currency: 'EUR',
              description: component.description,
              calculationMetadataJson: component.metadata
                ? JSON.stringify(component.metadata)
                : null,
              remunerationPlanVersionId: planData.versionId,
              status: 'CONFIRMED',
              occurredAt,
              confirmedAt: occurredAt,
              createdByUserId: actorUserId,
              idempotencyKey: entryIdempotencyKey,
            },
            select: { id: true },
          })
        }
        earningEntryIds.push(entry.id)
      }

      // 9. Create cash ledger entry (if CASH payment, idempotent)
      let cashCollectedCents: number | null = null
      if (order.paymentMethod === 'CASH') {
        const cashIdempotencyKey = `cash:${orderId}`
        const existingCash = await tx.cashLedgerEntry.findUnique({
          where: { idempotencyKey: cashIdempotencyKey },
          select: { id: true, balanceAfterCents: true },
        })

        if (existingCash) {
          cashCollectedCents = existingCash.balanceAfterCents
        } else {
          // Calculate balance from SUM (not read-then-write)
          const balanceAgg = await tx.cashLedgerEntry.aggregate({
            where: { courierId },
            _sum: { amountCents: true },
          })
          const balanceBefore = balanceAgg._sum.amountCents ?? 0
          const cashAmount = Math.round(order.totalAmount * 100)
          const balanceAfter = balanceBefore + cashAmount

          await tx.cashLedgerEntry.create({
            data: {
              courierId,
              orderId,
              type: 'CASH_COLLECTED',
              amountCents: cashAmount,
              balanceAfterCents: balanceAfter,
              note: 'Hotovosť od zákazníka za objednávku',
              occurredAt,
              idempotencyKey: cashIdempotencyKey,
            },
          })
          cashCollectedCents = balanceAfter
        }
      }

      // 10. Update assignment to DELIVERED
      await tx.deliveryAssignment.update({
        where: { id: assignment.id },
        data: {
          status: 'DELIVERED',
          deliveredAt: occurredAt,
        },
      })

      // 11. Create exactly one status history entry
      await tx.orderStatusHistory.create({
        data: {
          orderId,
          status: 'DELIVERED',
          changedByUserId: actorUserId,
          reason: 'Doručené kuriérom',
        },
      })

      // 12. Recalculate courier active order count
      const activeCount = await tx.deliveryAssignment.count({
        where: {
          courierId,
          status: { in: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP'] },
          order: { status: { in: ['ASSIGNED_TO_COURIER', 'PICKED_UP', 'ON_THE_WAY'] } },
        },
      })
      await tx.courier.update({
        where: { id: courierId },
        data: { activeOrderCount: activeCount },
      })

      return {
        orderId,
        orderStatus: 'DELIVERED' as OrderStatus,
        totalEarningsCents: calculation.totalCents,
        earningEntryIds,
        cashCollectedCents,
        idempotent: false,
      }
    })

    return result
  } catch (err) {
    if (err instanceof CompleteOrderError) throw err
    // Handle Prisma unique constraint violations (P2002) — idempotent retry
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      // Return existing state
      return await getIdempotentResult(orderId, courierId)
    }
    throw err
  }
}

/**
 * Load existing earning entries for an already-delivered order (idempotent path).
 */
async function getIdempotentResult(orderId: string, courierId: string): Promise<CompleteOrderResult> {
  const entries = await db.earningLedgerEntry.findMany({
    where: { orderId, type: { not: 'REVERSAL' }, status: 'CONFIRMED' },
    select: { id: true, amountCents: true },
  })
  const total = entries.reduce((s, e) => s + e.amountCents, 0)

  const cashEntry = await db.cashLedgerEntry.findFirst({
    where: { orderId, courierId, type: 'CASH_COLLECTED' },
    select: { balanceAfterCents: true },
  })

  return {
    orderId,
    orderStatus: 'DELIVERED',
    totalEarningsCents: total,
    earningEntryIds: entries.map((e) => e.id),
    cashCollectedCents: cashEntry?.balanceAfterCents ?? null,
    idempotent: true,
  }
}

/**
 * Load the active remuneration plan snapshot for a courier within a transaction.
 */
async function loadPlanSnapshotForCourierTx(
  tx: Prisma.TransactionClient,
  courierId: string,
  at: Date
): Promise<{ snapshot: RemunerationPlanSnapshot; versionId: string; overrides: any[] } | null> {
  const courier = await tx.courier.findUnique({
    where: { id: courierId },
    include: {
      activeCompensationProfile: {
        include: {
          remunerationPlan: {
            include: {
              rules: { where: { active: true } },
              zoneRules: { where: { active: true }, include: { zone: true } },
              peakRules: { where: { active: true } },
            },
          },
        },
      },
      rateOverrides: { where: { active: true } },
    },
  })

  let plan = courier?.activeCompensationProfile?.remunerationPlan ?? null

  if (!plan) {
    plan = await tx.remunerationPlan.findFirst({
      where: { isActive: true },
      include: {
        rules: { where: { active: true } },
        zoneRules: { where: { active: true }, include: { zone: true } },
        peakRules: { where: { active: true } },
      },
    })
  }

  if (!plan) return null

  const versions = await tx.remunerationPlanVersion.findMany({
    where: { planId: plan.id, effectiveFrom: { lte: at } },
    orderBy: { versionNumber: 'desc' },
  })
  const effectiveVersion = versions[0]
  if (!effectiveVersion) return null

  const snapshot: RemunerationPlanSnapshot = {
    planId: plan.id,
    planName: plan.name,
    versionNumber: effectiveVersion.versionNumber,
    currency: plan.currency,
    rules: plan.rules.map((r) => ({
      ruleType: r.ruleType,
      valueType: r.valueType,
      valueCents: r.valueCents,
      valueBasisPoints: r.valueBasisPoints,
      conditionJson: r.conditionJson,
      priority: r.priority,
    })),
    zoneRules: plan.zoneRules.map((z) => ({
      zoneId: z.zoneId,
      zoneName: z.zone.name,
      bonusCents: z.bonusCents,
    })),
    peakRules: plan.peakRules.map((p) => ({
      dayOfWeek: p.dayOfWeek,
      startTime: p.startTime,
      endTime: p.endTime,
      bonusCents: p.bonusCents,
    })),
  }

  const overrides = (courier?.rateOverrides ?? []).map((o) => ({
    ruleType: o.ruleType,
    valueType: o.valueType,
    valueCents: o.valueCents,
    valueBasisPoints: o.valueBasisPoints,
  }))

  return { snapshot, versionId: effectiveVersion.id, overrides }
}

/**
 * Get or create the open payout period for a courier at a given date.
 * Only OPEN periods are used — never LOCKED/APPROVED/PAID.
 */
async function getOrCreatePayoutPeriodIdTx(
  tx: Prisma.TransactionClient,
  courierId: string,
  date: Date
): Promise<string | null> {
  const courier = await tx.courier.findUnique({
    where: { id: courierId },
    include: {
      activeCompensationProfile: {
        select: {
          payoutFrequency: true,
          preferredPayoutWeekday: true,
          monthlyPayoutDay: true,
          payoutAnchorDate: true,
        },
      },
    },
  })

  if (!courier?.activeCompensationProfile) return null

  const profile = courier.activeCompensationProfile
  const range = getBratislavaPeriodForDate(date, {
    frequency: profile.payoutFrequency,
    payoutWeekday: profile.preferredPayoutWeekday ?? 4,
    monthlyPayoutDay: profile.monthlyPayoutDay ?? 15,
    anchorDate: profile.payoutAnchorDate ?? undefined,
  })

  // Find or create OPEN period — never use LOCKED/APPROVED/PAID
  const existing = await tx.payoutPeriod.findUnique({
    where: {
      courierId_periodStart_periodEnd: {
        courierId,
        periodStart: range.start,
        periodEnd: range.end,
      },
    },
    select: { id: true, status: true },
  })

  if (existing) {
    // If period is not OPEN, find or create the next OPEN period
    if (existing.status === 'OPEN') {
      return existing.id
    }
    // Late entry — find next OPEN period or create one
    // For simplicity, create a new OPEN period for the next cycle
    const nextRange = getBratislavaPeriodForDate(range.end, {
      frequency: profile.payoutFrequency,
      payoutWeekday: profile.preferredPayoutWeekday ?? 4,
      monthlyPayoutDay: profile.monthlyPayoutDay ?? 15,
      anchorDate: profile.payoutAnchorDate ?? undefined,
    })
    const nextExisting = await tx.payoutPeriod.findUnique({
      where: {
        courierId_periodStart_periodEnd: {
          courierId,
          periodStart: nextRange.start,
          periodEnd: nextRange.end,
        },
      },
      select: { id: true, status: true },
    })
    if (nextExisting && nextExisting.status === 'OPEN') {
      return nextExisting.id
    }
    if (nextExisting) {
      // Skip to next-next period
      return null
    }
    const created = await tx.payoutPeriod.create({
      data: {
        courierId,
        frequency: profile.payoutFrequency,
        periodStart: nextRange.start,
        periodEnd: nextRange.end,
        payoutDueDate: nextRange.dueDate,
        status: 'OPEN',
      },
      select: { id: true },
    })
    return created.id
  }

  // Create new OPEN period
  const created = await tx.payoutPeriod.create({
    data: {
      courierId,
      frequency: profile.payoutFrequency,
      periodStart: range.start,
      periodEnd: range.end,
      payoutDueDate: range.dueDate,
      status: 'OPEN',
    },
    select: { id: true },
  })
  return created.id
}

export class CompleteOrderError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
    this.name = 'CompleteOrderError'
  }
}

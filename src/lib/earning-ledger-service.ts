/**
 * Earning ledger service.
 *
 * This is the SINGLE place that creates EarningLedgerEntry records. All
 * callers must go through this service to ensure:
 * - idempotency (no duplicate entries for the same order)
 * - immutability (entries are never edited after confirmation)
 * - correct linking to remuneration plan version
 * - correct payout period assignment
 *
 * Correction of an entry is done via a REVERSAL entry + a new entry, never
 * by editing the original.
 */

import { db } from '@/lib/db'
import type { EarningEntryType, EarningEntryStatus } from '@prisma/client'
import type { EarningComponent, RemunerationPlanSnapshot } from '@/lib/remuneration'
import { getBratislavaPeriodForDate } from '@/lib/payout-periods'
import type { PayoutFrequency } from '@prisma/client'

export interface CreateEarningEntriesInput {
  courierId: string
  orderId: string
  assignmentId?: string | null
  workSessionId?: string | null
  components: EarningComponent[]
  planSnapshot: RemunerationPlanSnapshot
  remunerationPlanVersionId: string
  occurredAt: Date
  createdByUserId?: string | null
}

/**
 * Create earning ledger entries for a completed order. Idempotent: if entries
 * already exist for this order (identified by idempotencyKey prefix), the
 * existing entries are returned unchanged.
 *
 * Each component becomes its own ledger entry. The idempotency key format is:
 *   order:{orderId}:{componentType}:{index}
 *
 * This ensures that:
 * - re-running the same completion produces no duplicates
 * - different components for the same order are distinguishable
 * - reversal + re-creation uses a different key
 */
export async function createEarningEntriesForOrder(
  input: CreateEarningEntriesInput
): Promise<{ created: boolean; entryIds: string[] }> {
  // Check if entries already exist for this order
  const existing = await db.earningLedgerEntry.findMany({
    where: {
      orderId: input.orderId,
      type: { not: 'REVERSAL' },
    },
    select: { id: true, idempotencyKey: true },
  })

  if (existing.length > 0) {
    // Entries already created — idempotent return
    return { created: false, entryIds: existing.map((e) => e.id) }
  }

  // Determine payout period for occurredAt
  const payoutPeriodId = await getOrCreatePayoutPeriodId(
    input.courierId,
    input.occurredAt
  )

  const now = new Date()
  const entryIds: string[] = []

  // Create all entries in a transaction so they're atomic
  await db.$transaction(async (tx) => {
    for (let i = 0; i < input.components.length; i++) {
      const component = input.components[i]
      const idempotencyKey = `order:${input.orderId}:${component.type}:${i}`

      const entry = await tx.earningLedgerEntry.create({
        data: {
          courierId: input.courierId,
          orderId: input.orderId,
          assignmentId: input.assignmentId ?? null,
          workSessionId: input.workSessionId ?? null,
          payoutPeriodId,
          type: component.type as EarningEntryType,
          amountCents: component.amountCents,
          currency: 'EUR',
          description: component.description,
          calculationMetadataJson: component.metadata
            ? JSON.stringify(component.metadata)
            : null,
          remunerationPlanVersionId: input.remunerationPlanVersionId,
          status: 'CONFIRMED' as EarningEntryStatus,
          occurredAt: input.occurredAt,
          confirmedAt: now,
          createdByUserId: input.createdByUserId ?? null,
          idempotencyKey,
        },
        select: { id: true },
      })
      entryIds.push(entry.id)
    }
  })

  return { created: true, entryIds }
}

/**
 * Reverse all earning entries for an order (e.g. if the order was wrongly
 * marked as delivered). Creates REVERSAL entries with negative amounts,
 * referencing the original entries. Does NOT delete the originals.
 */
export async function reverseEarningsForOrder(
  orderId: string,
  reason: string,
  actorUserId: string
): Promise<{ reversedCount: number }> {
  const originals = await db.earningLedgerEntry.findMany({
    where: {
      orderId,
      status: { in: ['CONFIRMED', 'PENDING'] },
      type: { not: 'REVERSAL' },
    },
  })

  if (originals.length === 0) return { reversedCount: 0 }

  const now = new Date()
  await db.$transaction(async (tx) => {
    // Mark originals as REVERSED
    await tx.earningLedgerEntry.updateMany({
      where: { id: { in: originals.map((o) => o.id) } },
      data: { status: 'REVERSED' as EarningEntryStatus },
    })

    // Create reversal entries
    for (const original of originals) {
      await tx.earningLedgerEntry.create({
        data: {
          courierId: original.courierId,
          orderId: original.orderId,
          assignmentId: original.assignmentId,
          workSessionId: original.workSessionId,
          payoutPeriodId: original.payoutPeriodId,
          type: 'REVERSAL' as EarningEntryType,
          amountCents: -original.amountCents,
          currency: original.currency,
          description: `Reverz: ${original.description ?? original.type} (${reason})`,
          calculationMetadataJson: JSON.stringify({
            sourceEntryId: original.id,
            reason,
          }),
          remunerationPlanVersionId: original.remunerationPlanVersionId,
          sourceEntryId: original.id,
          status: 'CONFIRMED' as EarningEntryStatus,
          occurredAt: now,
          confirmedAt: now,
          createdByUserId: actorUserId,
          idempotencyKey: `reversal:${original.id}`,
        },
      })
    }
  })

  return { reversedCount: originals.length }
}

/**
 * Apply a manual adjustment (bonus or correction) to a courier's earnings.
 * Negative adjustments require a reason and are audited.
 */
export async function applyManualAdjustment(input: {
  courierId: string
  amountCents: number
  reason: string
  description?: string
  actorUserId: string
  orderId?: string
  payoutPeriodId?: string
  isNegative?: boolean
}): Promise<{ entryId: string }> {
  if (input.amountCents === 0) {
    throw new Error('Manual adjustment amount cannot be zero')
  }
  if (input.amountCents < 0 && !input.isNegative) {
    throw new Error('Negative adjustments require explicit isNegative=true flag')
  }
  if (!input.reason || input.reason.trim().length < 3) {
    throw new Error('Manual adjustment requires a reason (min 3 chars)')
  }

  const now = new Date()
  const payoutPeriodId =
    input.payoutPeriodId ?? (await getOrCreatePayoutPeriodId(input.courierId, now))

  const entry = await db.earningLedgerEntry.create({
    data: {
      courierId: input.courierId,
      orderId: input.orderId ?? null,
      payoutPeriodId,
      type: 'MANUAL_ADJUSTMENT' as EarningEntryType,
      amountCents: input.amountCents,
      currency: 'EUR',
      description: input.description ?? `Manuálna úprava: ${input.reason}`,
      calculationMetadataJson: JSON.stringify({
        reason: input.reason,
        actorUserId: input.actorUserId,
        isNegative: input.amountCents < 0,
      }),
      status: 'CONFIRMED' as EarningEntryStatus,
      occurredAt: now,
      confirmedAt: now,
      createdByUserId: input.actorUserId,
      idempotencyKey: `manual:${input.courierId}:${now.getTime()}:${Math.random().toString(36).slice(2, 8)}`,
    },
    select: { id: true },
  })

  // Audit log
  await db.courierAuditLog.create({
    data: {
      courierId: input.courierId,
      action: 'MANUAL_ADJUSTMENT',
      oldValueJson: null,
      newValueJson: JSON.stringify({
        amountCents: input.amountCents,
        reason: input.reason,
        entryId: entry.id,
      }),
      reason: input.reason,
      actorUserId: input.actorUserId,
    },
  })

  return { entryId: entry.id }
}

/**
 * Get or create the open payout period for a courier at a given date.
 * Returns the period ID. The period is created if it doesn't exist yet.
 */
async function getOrCreatePayoutPeriodId(
  courierId: string,
  date: Date
): Promise<string | null> {
  // Load the courier's compensation profile to determine frequency
  const courier = await db.courier.findUnique({
    where: { id: courierId },
    include: {
      activeCompensationProfile: {
        select: { payoutFrequency: true, preferredPayoutWeekday: true, monthlyPayoutDay: true, payoutAnchorDate: true },
      },
    },
  })

  if (!courier || !courier.activeCompensationProfile) {
    // No compensation profile → entries are created without a payout period.
    // They'll be assigned when the admin generates periods.
    return null
  }

  const profile = courier.activeCompensationProfile
  const frequency = profile.payoutFrequency as PayoutFrequency
  const range = getBratislavaPeriodForDate(date, {
    frequency,
    payoutWeekday: profile.preferredPayoutWeekday ?? 4,
    monthlyPayoutDay: profile.monthlyPayoutDay ?? 15,
    anchorDate: profile.payoutAnchorDate ?? undefined,
  })

  // Find or create the period
  const existing = await db.payoutPeriod.findUnique({
    where: {
      courierId_periodStart_periodEnd: {
        courierId,
        periodStart: range.start,
        periodEnd: range.end,
      },
    },
    select: { id: true },
  })

  if (existing) return existing.id

  const created = await db.payoutPeriod.create({
    data: {
      courierId,
      frequency,
      periodStart: range.start,
      periodEnd: range.end,
      payoutDueDate: range.dueDate,
      status: 'OPEN',
    },
    select: { id: true },
  })

  return created.id
}

/**
 * Recalculate a payout period's totals from its confirmed ledger entries.
 * Called after entries are added/reversed, or when admin recalculates.
 */
export async function recalculatePayoutPeriod(periodId: string): Promise<{
  grossEarningsCents: number
  bonusesCents: number
  adjustmentsCents: number
  payableCents: number
}> {
  const entries = await db.earningLedgerEntry.findMany({
    where: {
      payoutPeriodId: periodId,
      status: 'CONFIRMED',
    },
    select: { type: true, amountCents: true },
  })

  let grossEarningsCents = 0
  let bonusesCents = 0
  let adjustmentsCents = 0

  for (const entry of entries) {
    const amount = entry.amountCents
    if (entry.type === 'MANUAL_ADJUSTMENT' || entry.type === 'REVERSAL') {
      adjustmentsCents += amount
    } else if (
      entry.type === 'ZONE_BONUS' ||
      entry.type === 'PEAK_BONUS' ||
      entry.type === 'WEEKEND_BONUS' ||
      entry.type === 'HOLIDAY_BONUS' ||
      entry.type === 'WEATHER_BONUS' ||
      entry.type === 'MULTI_ORDER_BONUS' ||
      entry.type === 'MANUAL_BONUS'
    ) {
      bonusesCents += amount
      grossEarningsCents += amount
    } else {
      grossEarningsCents += amount
    }
  }

  const payableCents = grossEarningsCents + adjustmentsCents

  await db.payoutPeriod.update({
    where: { id: periodId },
    data: { grossEarningsCents, bonusesCents, adjustmentsCents, payableCents },
  })

  return { grossEarningsCents, bonusesCents, adjustmentsCents, payableCents }
}

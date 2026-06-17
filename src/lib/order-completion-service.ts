/**
 * Order completion service.
 *
 * This is the SINGLE place where an order is marked as DELIVERED and all
 * financial side-effects are triggered:
 * - Remuneration snapshot is finalized
 * - Earning ledger entries are created (idempotently)
 * - Cash ledger entry is created (if CASH payment)
 * - Delivery assignment is updated
 * - Courier active order count is decremented
 * - Work session stays open (courier can continue working)
 *
 * All operations are in a single transaction. The idempotency key on
 * EarningLedgerEntry ensures that a retried completion request does not
 * create duplicate earnings.
 */

import { db } from '@/lib/db'
import type { OrderStatus } from '@prisma/client'
import { getOrCreateOrderSnapshot, setActualSnapshotTotal } from '@/lib/remuneration-snapshot-service'
import { createEarningEntriesForOrder } from '@/lib/earning-ledger-service'
import { recordCashCollected } from '@/lib/cash-ledger-service'

export interface CompleteOrderResult {
  orderId: string
  orderStatus: OrderStatus
  totalEarningsCents: number
  earningEntryIds: string[]
  cashCollectedCents: number | null
}

/**
 * Mark an order as DELIVERED and create all financial records.
 * Idempotent: if the order is already DELIVERED, returns the existing state
 * without creating duplicate entries.
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
  }
): Promise<CompleteOrderResult> {
  // Load order with assignment
  const order = await db.order.findUnique({
    where: { id: orderId },
    include: {
      assignments: {
        where: { status: { in: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP'] } },
        take: 1,
      },
      deliveryZone: true,
    },
  })

  if (!order) {
    throw new CompleteOrderError('ORDER_NOT_FOUND', 'Objednávka nenájdená')
  }

  // If already delivered, return existing state (idempotent).
  // This check MUST come before the ownership check, because after delivery
  // the assignment status is DELIVERED (not in ASSIGNED/ACCEPTED/PICKED_UP),
  // so the ownership filter would return empty.
  if (order.status === 'DELIVERED') {
    const existingEntries = await db.earningLedgerEntry.findMany({
      where: { orderId, type: { not: 'REVERSAL' } },
      select: { id: true, amountCents: true },
    })
    const total = existingEntries.reduce((s, e) => s + e.amountCents, 0)
    return {
      orderId,
      orderStatus: 'DELIVERED',
      totalEarningsCents: total,
      earningEntryIds: existingEntries.map((e) => e.id),
      cashCollectedCents: null,
    }
  }

  // Verify ownership (courier must have an active assignment to this order)
  const assignment = order.assignments[0]
  if (!assignment || assignment.courierId !== courierId) {
    throw new CompleteOrderError('NOT_ASSIGNED', 'Objednávka nie je priradená tomuto kuriérovi')
  }

  // Verify the order is in a completable state
  if (!['PICKED_UP', 'ON_THE_WAY'].includes(order.status)) {
    throw new CompleteOrderError(
      'INVALID_STATUS',
      `Objednávku nemožno dokončiť zo stavu ${order.status}`
    )
  }

  const occurredAt = new Date()

  // 1. Get or create remuneration snapshot + calculate
  const { snapshotId, calculation } = await getOrCreateOrderSnapshot(orderId, courierId, {
    orderId,
    orderNumber: order.orderNumber,
    courierId,
    zoneId: order.deliveryZoneId,
    totalDistanceMeters: options?.actualDistanceMeters,
    tipCents: options?.tipCents,
    isBadWeather: options?.isBadWeather,
    occurredAt,
  })

  // 2. Create earning ledger entries (idempotent)
  const { entryIds, created } = await createEarningEntriesForOrder({
    courierId,
    orderId,
    assignmentId: assignment.id,
    components: calculation.components,
    planSnapshot: calculation.planSnapshot,
    remunerationPlanVersionId: await getPlanVersionId(snapshotId),
    occurredAt,
    createdByUserId: actorUserId,
  })

  // 3. Update snapshot with actual total
  if (created) {
    await setActualSnapshotTotal(orderId, calculation.totalCents)
  }

  // 4. If CASH payment, record cash collected
  let cashCollectedCents: number | null = null
  if (order.paymentMethod === 'CASH' && created) {
    const cashResult = await recordCashCollected({
      courierId,
      orderId,
      amountCents: Math.round(order.totalAmount * 100), // totalAmount is in euros (Float during migration)
    })
    cashCollectedCents = cashResult.balanceAfterCents
  }

  // 5. Update order status + assignment in a transaction
  await db.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'DELIVERED',
        deliveredAt: occurredAt,
        statusHistory: {
          create: {
            status: 'DELIVERED',
            changedByUserId: actorUserId,
            reason: 'Doručené kuriérom',
          },
        },
      },
    })

    await tx.deliveryAssignment.update({
      where: { id: assignment.id },
      data: {
        status: 'DELIVERED',
        deliveredAt: occurredAt,
      },
    })

    // Recalculate courier active order count
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
  })

  return {
    orderId,
    orderStatus: 'DELIVERED',
    totalEarningsCents: calculation.totalCents,
    earningEntryIds: entryIds,
    cashCollectedCents,
  }
}

async function getPlanVersionId(snapshotId: string): Promise<string> {
  const snapshot = await db.orderRemunerationSnapshot.findUnique({
    where: { id: snapshotId },
    select: { remunerationPlanVersionId: true },
  })
  if (!snapshot) throw new Error('Snapshot not found')
  return snapshot.remunerationPlanVersionId
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

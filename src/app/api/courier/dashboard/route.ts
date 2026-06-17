import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireCourier } from '@/lib/courier-auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { getTodayRange, getThisWeekRange, toBratislava } from '@/lib/timezone'
import { getCashBalance } from '@/lib/cash-ledger-service'
import { getActiveWorkSession } from '@/lib/work-session-service'
import { centsToEuros } from '@/lib/money'

/**
 * GET /api/courier/dashboard
 *
 * Single optimized endpoint for the courier mobile dashboard. Returns:
 * - courier profile (display name, vehicle, status)
 * - today's earnings (confirmed + pending)
 * - today's delivery count
 * - active work session info
 * - cash balance (if holding cash)
 * - active assignment (if any)
 * - next payout period summary
 *
 * Replaces the previous 4 separate polling requests.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireCourier(request)
  if ('error' in authResult) return authResult.error

  const { courier } = authResult.data

  // Today's range in Bratislava
  const todayRange = getTodayRange()

  // Active assignment (if any)
  const activeAssignment = await db.deliveryAssignment.findFirst({
    where: {
      courierId: courier.id,
      status: { in: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP'] },
    },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          orderType: true,
          paymentMethod: true,
          totalAmount: true,
          customerName: true,
          customerPhone: true,
          deliveryAddressLine1: true,
          deliveryCity: true,
          deliveryNote: true,
          kitchenNote: true,
          items: {
            select: {
              id: true,
              menuItemNameSnapshot: true,
              quantity: true,
            },
          },
          deliveryZone: {
            select: { id: true, name: true },
          },
        },
      },
    },
    orderBy: { assignedAt: 'desc' },
  })

  // Today's earnings from ledger
  const todayEntries = await db.earningLedgerEntry.findMany({
    where: {
      courierId: courier.id,
      occurredAt: { gte: todayRange.start, lt: todayRange.end },
      status: 'CONFIRMED',
      type: { not: 'REVERSAL' },
    },
    select: { amountCents: true, type: true },
  })

  const todayEarningsCents = todayEntries.reduce((s, e) => s + e.amountCents, 0)
  const todayDeliveryCount = todayEntries.filter((e) => e.type === 'DELIVERY_BASE').length

  // Pending (unconfirmed) earnings — entries that exist but aren't linked to a payout period yet
  const pendingEntries = await db.earningLedgerEntry.aggregate({
    where: {
      courierId: courier.id,
      status: 'CONFIRMED',
      payoutPeriodId: null,
      type: { not: 'REVERSAL' },
    },
    _sum: { amountCents: true },
  })

  // Active work session
  const workSession = await getActiveWorkSession(courier.id)

  // Cash balance
  const cashBalance = await getCashBalance(courier.id)

  // Open payout period
  const openPeriod = await db.payoutPeriod.findFirst({
    where: { courierId: courier.id, status: 'OPEN' },
    orderBy: { periodEnd: 'asc' },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      payoutDueDate: true,
      payableCents: true,
      status: true,
    },
  })

  // Compute live period total from confirmed entries in the period range
  let openPeriodPayableCents = openPeriod?.payableCents ?? 0
  if (openPeriod) {
    const periodEntries = await db.earningLedgerEntry.aggregate({
      where: {
        courierId: courier.id,
        status: 'CONFIRMED',
        type: { not: 'REVERSAL' },
        occurredAt: { gte: openPeriod.periodStart, lt: openPeriod.periodEnd },
      },
      _sum: { amountCents: true },
    })
    openPeriodPayableCents = periodEntries._sum.amountCents ?? 0
  }

  return Response.json({
    courier: {
      id: courier.id,
      displayName: courier.displayName,
      vehicleType: courier.vehicleType,
      status: courier.status,
      isOnline: courier.status !== 'OFFLINE',
    },
    today: {
      date: toBratislava(new Date()).toISOString().slice(0, 10),
      earningsCents: todayEarningsCents,
      earningsEuros: centsToEuros(todayEarningsCents),
      deliveryCount: todayDeliveryCount,
      pendingEarningsCents: pendingEntries._sum.amountCents ?? 0,
    },
    workSession: workSession
      ? {
          id: workSession.id,
          startedAt: workSession.startedAt,
          totalActiveSeconds: workSession.totalActiveSeconds,
          status: workSession.status,
        }
      : null,
    cashBalanceCents: cashBalance.balanceCents,
    cashBalanceEuros: centsToEuros(cashBalance.balanceCents),
    activeAssignment: activeAssignment
      ? {
          assignmentId: activeAssignment.id,
          assignmentStatus: activeAssignment.status,
          order: {
            id: activeAssignment.order.id,
            orderNumber: activeAssignment.order.orderNumber,
            status: activeAssignment.order.status,
            orderType: activeAssignment.order.orderType,
            paymentMethod: activeAssignment.order.paymentMethod,
            totalAmount: activeAssignment.order.totalAmount,
            customerName: activeAssignment.order.customerName,
            customerPhone: activeAssignment.order.customerPhone,
            deliveryAddressLine1: activeAssignment.order.deliveryAddressLine1,
            deliveryCity: activeAssignment.order.deliveryCity,
            deliveryNote: activeAssignment.order.deliveryNote,
            kitchenNote: activeAssignment.order.kitchenNote,
            items: activeAssignment.order.items,
            zone: activeAssignment.order.deliveryZone,
          },
        }
      : null,
    openPayoutPeriod: openPeriod
      ? {
          id: openPeriod.id,
          periodStart: openPeriod.periodStart,
          periodEnd: openPeriod.periodEnd,
          payoutDueDate: openPeriod.payoutDueDate,
          payableCents: openPeriodPayableCents,
          payableEuros: centsToEuros(openPeriodPayableCents),
          status: openPeriod.status,
        }
      : null,
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

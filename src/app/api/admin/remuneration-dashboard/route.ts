import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { withErrorHandler } from '@/lib/api-errors'
import { centsToEuros } from '@/lib/money'
import { getCashBalances } from '@/lib/cash-ledger-service'

/**
 * GET /api/admin/remuneration-dashboard
 *
 * Returns aggregated metrics for the admin "Odmeny a výplaty" dashboard:
 * - total current earnings (all couriers)
 * - confirmed vs pending earnings
 * - sum ready for next payouts
 * - by contract type (AGREEMENT vs SELF_EMPLOYED)
 * - unpaid periods count
 * - failed payments count
 * - pending invoices count
 * - cash held by couriers
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
  if ('error' in authResult) return authResult.error

  // Total confirmed earnings across all couriers (not in a PAID period)
  const totalConfirmed = await db.earningLedgerEntry.aggregate({
    where: {
      status: 'CONFIRMED',
      type: { not: 'REVERSAL' },
      payoutPeriod: { status: { not: 'PAID' } },
    },
    _sum: { amountCents: true },
    _count: true,
  })

  // Pending (not yet linked to a payout period)
  const totalPending = await db.earningLedgerEntry.aggregate({
    where: {
      status: 'CONFIRMED',
      payoutPeriodId: null,
      type: { not: 'REVERSAL' },
    },
    _sum: { amountCents: true },
  })

  // Periods by status
  const periodsByStatus = await db.payoutPeriod.groupBy({
    by: ['status'],
    _count: { status: true },
    _sum: { payableCents: true },
  })

  // By contract type
  const agreementCouriers = await db.courierCompensationProfile.findMany({
    where: { active: true, contractType: 'AGREEMENT' },
    select: { courierId: true },
  })
  const selfEmployedCouriers = await db.courierCompensationProfile.findMany({
    where: { active: true, contractType: 'SELF_EMPLOYED' },
    select: { courierId: true },
  })

  const agreementIds = agreementCouriers.map((c) => c.courierId)
  const selfEmployedIds = selfEmployedCouriers.map((c) => c.courierId)

  const [agreementEarnings, selfEmployedEarnings] = await Promise.all([
    agreementIds.length > 0
      ? db.earningLedgerEntry.aggregate({
          where: {
            courierId: { in: agreementIds },
            status: 'CONFIRMED',
            type: { not: 'REVERSAL' },
            payoutPeriod: { status: { not: 'PAID' } },
          },
          _sum: { amountCents: true },
        })
      : { _sum: { amountCents: 0 } },
    selfEmployedIds.length > 0
      ? db.earningLedgerEntry.aggregate({
          where: {
            courierId: { in: selfEmployedIds },
            status: 'CONFIRMED',
            type: { not: 'REVERSAL' },
            payoutPeriod: { status: { not: 'PAID' } },
          },
          _sum: { amountCents: true },
        })
      : { _sum: { amountCents: 0 } },
  ])

  // Failed payments
  const failedPayments = await db.payoutPeriod.count({
    where: { status: 'FAILED' },
  })

  // Pending invoices (ISSUED or DELIVERED, not yet ACCEPTED)
  const pendingInvoices = await db.selfBillingInvoice.count({
    where: { status: { in: ['ISSUED', 'DELIVERED'] } },
  })

  // Cash held by couriers
  const allCourierIds = [...agreementIds, ...selfEmployedIds]
  const cashBalances = allCourierIds.length > 0
    ? await getCashBalances(allCourierIds)
    : new Map<string, number>()
  const totalCashHeld = Array.from(cashBalances.values()).reduce((s, v) => s + v, 0)

  // Ready for payout (APPROVED periods)
  const readyForPayout = periodsByStatus.find((p) => p.status === 'APPROVED')
  const readyForPayoutCents = readyForPayout?._sum.payableCents ?? 0
  const readyForPayoutCount = readyForPayout?._count.status ?? 0

  // Courier list with their current earnings
  const couriers = await db.courier.findMany({
    where: { isActive: true },
    include: {
      activeCompensationProfile: {
        select: {
          contractType: true,
          payoutFrequency: true,
        },
      },
      payoutPeriods: {
        where: { status: 'OPEN' },
        orderBy: { periodEnd: 'asc' },
        take: 1,
        select: {
          id: true,
          periodStart: true,
          periodEnd: true,
          payoutDueDate: true,
          payableCents: true,
          status: true,
        },
      },
    },
    orderBy: { displayName: 'asc' },
  })

  // Get live earnings for each courier's open period
  const courierSummaries: Array<{
    id: string
    displayName: string
    status: string
    contractType: string | null
    payoutFrequency: string | null
    openPeriod: {
      id: string
      periodStart: Date
      periodEnd: Date
      payoutDueDate: Date
      liveEarningsCents: number
      liveEarningsEuros: number
      status: string
    } | null
    cashBalanceCents: number
    cashBalanceEuros: number
  }> = []
  for (const courier of couriers) {
    const openPeriod = courier.payoutPeriods[0]
    let liveEarningsCents = 0
    if (openPeriod) {
      const agg = await db.earningLedgerEntry.aggregate({
        where: {
          courierId: courier.id,
          status: 'CONFIRMED',
          type: { not: 'REVERSAL' },
          occurredAt: { gte: openPeriod.periodStart, lt: openPeriod.periodEnd },
        },
        _sum: { amountCents: true },
      })
      liveEarningsCents = agg._sum.amountCents ?? 0
    }

    const cashBalance = cashBalances.get(courier.id) ?? 0

    courierSummaries.push({
      id: courier.id,
      displayName: courier.displayName,
      status: courier.status,
      contractType: courier.activeCompensationProfile?.contractType ?? null,
      payoutFrequency: courier.activeCompensationProfile?.payoutFrequency ?? null,
      openPeriod: openPeriod
        ? {
            id: openPeriod.id,
            periodStart: openPeriod.periodStart,
            periodEnd: openPeriod.periodEnd,
            payoutDueDate: openPeriod.payoutDueDate,
            liveEarningsCents,
            liveEarningsEuros: centsToEuros(liveEarningsCents),
            status: openPeriod.status,
          }
        : null,
      cashBalanceCents: cashBalance,
      cashBalanceEuros: centsToEuros(cashBalance),
    })
  }

  return Response.json({
    summary: {
      totalCurrentEarningsCents: totalConfirmed._sum.amountCents ?? 0,
      totalCurrentEarningsEuros: centsToEuros(totalConfirmed._sum.amountCents ?? 0),
      totalEarningEntries: totalConfirmed._count,
      pendingEarningsCents: totalPending._sum.amountCents ?? 0,
      pendingEarningsEuros: centsToEuros(totalPending._sum.amountCents ?? 0),
      readyForPayoutCents,
      readyForPayoutEuros: centsToEuros(readyForPayoutCents),
      readyForPayoutCount,
      agreementEarningsCents: agreementEarnings._sum.amountCents ?? 0,
      agreementEarningsEuros: centsToEuros(agreementEarnings._sum.amountCents ?? 0),
      selfEmployedEarningsCents: selfEmployedEarnings._sum.amountCents ?? 0,
      selfEmployedEarningsEuros: centsToEuros(selfEmployedEarnings._sum.amountCents ?? 0),
      failedPayments,
      pendingInvoices,
      totalCashHeldCents: totalCashHeld,
      totalCashHeldEuros: centsToEuros(totalCashHeld),
      periodsByStatus: periodsByStatus.map((p) => ({
        status: p.status,
        count: p._count.status,
        totalCents: p._sum.payableCents ?? 0,
        totalEuros: centsToEuros(p._sum.payableCents ?? 0),
      })),
    },
    couriers: courierSummaries,
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

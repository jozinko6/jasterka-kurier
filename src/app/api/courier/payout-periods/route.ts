import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireCourier } from '@/lib/courier-auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { centsToEuros } from '@/lib/money'

/**
 * GET /api/courier/payout-periods
 *
 * Query params:
 * - status: filter by status (OPEN, LOCKED, APPROVED, PAID, etc.)
 * - limit: max 50 (default 20)
 *
 * Returns the courier's payout periods with live totals.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireCourier(request)
  if ('error' in authResult) return authResult.error

  const { courier } = authResult.data
  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '20', 10) || 20, 50)

  const where: Record<string, unknown> = { courierId: courier.id }
  if (status) where.status = status

  const periods = await db.payoutPeriod.findMany({
    where,
    orderBy: { periodStart: 'desc' },
    take: limit,
    select: {
      id: true,
      frequency: true,
      periodStart: true,
      periodEnd: true,
      payoutDueDate: true,
      status: true,
      grossEarningsCents: true,
      bonusesCents: true,
      adjustmentsCents: true,
      payableCents: true,
      lockedAt: true,
      approvedAt: true,
      paidAt: true,
      paymentReference: true,
    },
  })

  // For OPEN periods, compute live total from ledger entries
  const openPeriods = periods.filter((p) => p.status === 'OPEN')
  const liveTotals = new Map<string, number>()
  for (const p of openPeriods) {
    const agg = await db.earningLedgerEntry.aggregate({
      where: {
        courierId: courier.id,
        status: 'CONFIRMED',
        type: { not: 'REVERSAL' },
        occurredAt: { gte: p.periodStart, lt: p.periodEnd },
      },
      _sum: { amountCents: true },
    })
    liveTotals.set(p.id, agg._sum.amountCents ?? 0)
  }

  return Response.json({
    periods: periods.map((p) => ({
      ...p,
      livePayableCents: p.status === 'OPEN' ? (liveTotals.get(p.id) ?? p.payableCents) : p.payableCents,
      livePayableEuros: centsToEuros(p.status === 'OPEN' ? (liveTotals.get(p.id) ?? p.payableCents) : p.payableCents),
      payableEuros: centsToEuros(p.payableCents),
      grossEarningsEuros: centsToEuros(p.grossEarningsCents),
      bonusesEuros: centsToEuros(p.bonusesCents),
      adjustmentsEuros: centsToEuros(p.adjustmentsCents),
    })),
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

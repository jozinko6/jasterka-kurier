import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { centsToEuros } from '@/lib/money'
import { getCashBalances } from '@/lib/cash-ledger-service'

/**
 * GET /api/admin/payout-periods
 *
 * Query params:
 * - status: filter by status
 * - courierId: filter by courier
 * - limit: max 100 (default 50)
 * - cursor: pagination cursor
 *
 * Returns all payout periods across all couriers (admin view).
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
  if ('error' in authResult) return authResult.error

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const courierId = searchParams.get('courierId')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 100)
  const cursor = searchParams.get('cursor')

  const where: Record<string, unknown> = {}
  if (status) where.status = status
  if (courierId) where.courierId = courierId

  const periods = await db.payoutPeriod.findMany({
    where,
    orderBy: [{ periodStart: 'desc' }, { courierId: 'asc' }],
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: {
      courier: {
        select: {
          id: true,
          displayName: true,
          activeCompensationProfile: {
            select: { contractType: true, payoutFrequency: true },
          },
        },
      },
    },
  })

  const hasMore = periods.length > limit
  const items = hasMore ? periods.slice(0, limit) : periods
  const nextCursor = hasMore ? items[items.length - 1].id : null

  return Response.json({
    periods: items.map((p) => ({
      id: p.id,
      courierId: p.courierId,
      courierName: p.courier.displayName,
      contractType: p.courier.activeCompensationProfile?.contractType ?? null,
      frequency: p.frequency,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      payoutDueDate: p.payoutDueDate,
      status: p.status,
      grossEarningsCents: p.grossEarningsCents,
      grossEarningsEuros: centsToEuros(p.grossEarningsCents),
      bonusesCents: p.bonusesCents,
      bonusesEuros: centsToEuros(p.bonusesCents),
      adjustmentsCents: p.adjustmentsCents,
      adjustmentsEuros: centsToEuros(p.adjustmentsCents),
      payableCents: p.payableCents,
      payableEuros: centsToEuros(p.payableCents),
      lockedAt: p.lockedAt,
      approvedAt: p.approvedAt,
      paidAt: p.paidAt,
      paymentReference: p.paymentReference,
    })),
    nextCursor,
    hasMore,
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireCourier } from '@/lib/courier-auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { getTodayRange, getThisWeekRange, getThisMonthRange, toBratislava, fromBratislava } from '@/lib/timezone'
import { centsToEuros } from '@/lib/money'

/**
 * GET /api/courier/earnings
 *
 * Query params:
 * - range: 'today' | 'week' | 'month' | 'period' | 'custom' (default: today)
 * - from: ISO date (for custom range, Bratislava timezone)
 * - to: ISO date (for custom range, Bratislava timezone)
 * - periodId: payout period ID (for range=period)
 *
 * Returns:
 * - entries: list of earning ledger entries with component breakdown
 * - summary: confirmed, pending, bonuses, adjustments, delivery count
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireCourier(request)
  if ('error' in authResult) return authResult.error

  const { courier } = authResult.data
  const { searchParams } = new URL(request.url)
  const range = searchParams.get('range') ?? 'today'
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const periodId = searchParams.get('periodId')

  let start: Date
  let end: Date

  switch (range) {
    case 'today':
      ({ start, end } = getTodayRange())
      break
    case 'week':
      ({ start, end } = getThisWeekRange())
      break
    case 'month':
      ({ start, end } = getThisMonthRange())
      break
    case 'period':
      if (!periodId) {
        return apiError('INVALID_REQUEST', 'Pre range=period je potrebný parameter periodId')
      }
      const period = await db.payoutPeriod.findFirst({
        where: { id: periodId, courierId: courier.id },
        select: { periodStart: true, periodEnd: true },
      })
      if (!period) {
        return apiError('NOT_FOUND', 'Výplatné obdobie nebolo nájdené')
      }
      start = period.periodStart
      end = period.periodEnd
      break
    case 'custom':
      if (!fromParam || !toParam) {
        return apiError('INVALID_REQUEST', 'Pre range=custom sú potrebné parametre from a to')
      }
      // Parse as Bratislava wall-clock dates
      start = fromBratislava(new Date(fromParam + 'T00:00:00'))
      end = fromBratislava(new Date(toParam + 'T23:59:59.999'))
      break
    default:
      return apiError('INVALID_REQUEST', `Neznámy range: ${range}`)
  }

  // Load entries
  const entries = await db.earningLedgerEntry.findMany({
    where: {
      courierId: courier.id,
      occurredAt: { gte: start, lt: end },
      status: 'CONFIRMED',
    },
    orderBy: { occurredAt: 'desc' },
    select: {
      id: true,
      type: true,
      amountCents: true,
      description: true,
      occurredAt: true,
      orderId: true,
      payoutPeriodId: true,
      calculationMetadataJson: true,
    },
  })

  // Compute summary
  let confirmedCents = 0
  let pendingCents = 0
  let bonusCents = 0
  let adjustmentCents = 0
  let tipCents = 0
  let deliveryCount = 0

  const bonusTypes = new Set(['ZONE_BONUS', 'PEAK_BONUS', 'WEEKEND_BONUS', 'HOLIDAY_BONUS', 'WEATHER_BONUS', 'MULTI_ORDER_BONUS', 'MANUAL_BONUS'])

  for (const entry of entries) {
    if (entry.type === 'REVERSAL') continue
    confirmedCents += entry.amountCents
    if (entry.type === 'DELIVERY_BASE') deliveryCount++
    if (bonusTypes.has(entry.type)) bonusCents += entry.amountCents
    if (entry.type === 'TIP') tipCents += entry.amountCents
    if (entry.type === 'MANUAL_ADJUSTMENT') adjustmentCents += entry.amountCents
  }

  // Pending = confirmed entries not yet in a payout period
  const pendingEntries = await db.earningLedgerEntry.aggregate({
    where: {
      courierId: courier.id,
      status: 'CONFIRMED',
      payoutPeriodId: null,
      type: { not: 'REVERSAL' },
    },
    _sum: { amountCents: true },
  })
  pendingCents = pendingEntries._sum.amountCents ?? 0

  // Group by day for chart
  const byDay = new Map<string, number>()
  for (const entry of entries) {
    if (entry.type === 'REVERSAL') continue
    const dayKey = toBratislava(entry.occurredAt).toISOString().slice(0, 10)
    byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + entry.amountCents)
  }

  return Response.json({
    range: { start, end, type: range },
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      amountCents: e.amountCents,
      amountEuros: centsToEuros(e.amountCents),
      description: e.description,
      occurredAt: e.occurredAt,
      orderId: e.orderId,
      metadata: e.calculationMetadataJson ? JSON.parse(e.calculationMetadataJson) : null,
    })),
    summary: {
      confirmedCents,
      confirmedEuros: centsToEuros(confirmedCents),
      pendingCents,
      pendingEuros: centsToEuros(pendingCents),
      bonusCents,
      bonusEuros: centsToEuros(bonusCents),
      tipCents,
      tipEuros: centsToEuros(tipCents),
      adjustmentCents,
      adjustmentEuros: centsToEuros(adjustmentCents),
      deliveryCount,
    },
    byDay: Array.from(byDay.entries())
      .map(([date, cents]) => ({ date, cents, euros: centsToEuros(cents) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

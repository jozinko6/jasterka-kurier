import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { recalculatePayoutPeriod } from '@/lib/earning-ledger-service'
import { centsToEuros } from '@/lib/money'

/**
 * POST /api/admin/payout-periods/[id]/calculate
 *
 * Recalculates the payout period totals from its confirmed ledger entries.
 * Can be called on OPEN or CALCULATED periods.
 */
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
  if ('error' in authResult) return authResult.error

  const period = await db.payoutPeriod.findUnique({
    where: { id },
    select: { id: true, status: true },
  })

  if (!period) {
    return apiError('NOT_FOUND', 'Výplatné obdobie nebolo nájdené')
  }

  if (period.status !== 'OPEN' && period.status !== 'CALCULATED') {
    return apiError('BUSINESS_RULE_VIOLATION', `Obdobie v stave ${period.status} nemožno prepočítať`)
  }

  const totals = await recalculatePayoutPeriod(id)

  await db.payoutPeriod.update({
    where: { id },
    data: { status: 'CALCULATED' },
  })

  return Response.json({
    periodId: id,
    ...totals,
    grossEarningsEuros: centsToEuros(totals.grossEarningsCents),
    bonusesEuros: centsToEuros(totals.bonusesCents),
    adjustmentsEuros: centsToEuros(totals.adjustmentsCents),
    payableEuros: centsToEuros(totals.payableCents),
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

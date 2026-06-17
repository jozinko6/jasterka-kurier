import { NextRequest } from 'next/server'
import { requireCourier } from '@/lib/courier-auth'
import { getCashBalance } from '@/lib/cash-ledger-service'
import { withErrorHandler } from '@/lib/api-errors'
import { centsToEuros } from '@/lib/money'

/**
 * GET /api/courier/cash-balance
 *
 * Returns the courier's current cash balance (money collected from customers
 * that hasn't been handed over to the company yet).
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireCourier(request)
  if ('error' in authResult) return authResult.error

  const { courier } = authResult.data
  const balance = await getCashBalance(courier.id)

  return Response.json({
    courierId: courier.id,
    balanceCents: balance.balanceCents,
    balanceEuros: centsToEuros(balance.balanceCents),
    lastEntryAt: balance.lastEntryAt,
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

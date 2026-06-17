import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireCourier, requireAssignedCourierForOrder } from '@/lib/courier-auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { completeDeliveryOrder, CompleteOrderError } from '@/lib/order-completion-service'
import { centsToEuros } from '@/lib/money'

/**
 * POST /api/courier/orders/[id]/complete
 *
 * Atomic action: marks the order as DELIVERED and creates all financial records.
 * - Verifies courier owns the active assignment
 * - Computes remuneration from the plan snapshot
 * - Creates earning ledger entries (idempotent via idempotencyKey)
 * - Records cash collected (if CASH payment)
 * - Updates order, assignment, courier status, active order count
 *
 * Idempotent: if the order is already DELIVERED, returns existing earnings
 * without creating duplicates.
 */
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: orderId } = await params
  const authResult = await requireCourier(request)
  if ('error' in authResult) return authResult.error

  const { courier, user } = authResult.data

  // Verify ownership BEFORE calling completion service
  const ownership = await requireAssignedCourierForOrder(courier.id, orderId)
  if ('error' in ownership) return ownership.error

  // Parse optional body
  let body: { tipCents?: number; isBadWeather?: boolean; actualDistanceMeters?: number } = {}
  try {
    const text = await request.text()
    if (text) body = JSON.parse(text)
  } catch {
    // Empty or invalid body is fine — these are all optional
  }

  try {
    const result = await completeDeliveryOrder(orderId, courier.id, user.id, {
      tipCents: body.tipCents,
      isBadWeather: body.isBadWeather,
      actualDistanceMeters: body.actualDistanceMeters,
    })

    return Response.json({
      orderId: result.orderId,
      status: result.orderStatus,
      totalEarningsCents: result.totalEarningsCents,
      totalEarningsEuros: centsToEuros(result.totalEarningsCents),
      earningEntryIds: result.earningEntryIds,
      cashCollectedBalanceCents: result.cashCollectedCents,
      cashCollectedBalanceEuros: result.cashCollectedCents !== null
        ? centsToEuros(result.cashCollectedCents)
        : null,
    }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (err) {
    if (err instanceof CompleteOrderError) {
      const codeMap: Record<string, 'NOT_FOUND' | 'FORBIDDEN' | 'BUSINESS_RULE_VIOLATION'> = {
        ORDER_NOT_FOUND: 'NOT_FOUND',
        NOT_ASSIGNED: 'FORBIDDEN',
        INVALID_STATUS: 'BUSINESS_RULE_VIOLATION',
      }
      return apiError(codeMap[err.code] ?? 'BUSINESS_RULE_VIOLATION', err.message)
    }
    throw err
  }
})

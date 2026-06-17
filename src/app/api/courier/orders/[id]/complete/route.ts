import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireCourier } from '@/lib/courier-auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { completeDeliveryOrder, CompleteOrderError } from '@/lib/order-completion-service'
import { centsToEuros } from '@/lib/money'

/**
 * POST /api/courier/orders/[id]/complete
 *
 * Atomic action: marks the order as DELIVERED and creates all financial records
 * in a SINGLE database transaction.
 *
 * Idempotency:
 * - Accepts Idempotency-Key header (or generates one)
 * - If the order is already DELIVERED by the same courier, returns existing
 *   earnings without creating duplicates
 * - Different courier gets 403 (no financial data leaked)
 *
 * Transaction includes:
 * - Conditional order update (compare-and-swap)
 * - Remuneration snapshot finalization
 * - Earning ledger entries (idempotent via unique keys)
 * - Cash ledger entry (if CASH, idempotent via unique key)
 * - Assignment update to DELIVERED
 * - Single status history entry
 * - Active order count recalculation
 */
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: orderId } = await params
  const authResult = await requireCourier(request)
  if ('error' in authResult) return authResult.error

  const { courier, user } = authResult.data

  // Parse optional body
  let body: { tipCents?: number; isBadWeather?: boolean; actualDistanceMeters?: number } = {}
  try {
    const text = await request.text()
    if (text) body = JSON.parse(text)
  } catch {
    // Empty or invalid body is fine — these are all optional
  }

  // Accept Idempotency-Key header, or generate one
  const idempotencyKey = request.headers.get('Idempotency-Key') || undefined

  try {
    const result = await completeDeliveryOrder(orderId, courier.id, user.id, {
      tipCents: body.tipCents,
      isBadWeather: body.isBadWeather,
      actualDistanceMeters: body.actualDistanceMeters,
      idempotencyKey,
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
      idempotent: result.idempotent,
    }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (err) {
    if (err instanceof CompleteOrderError) {
      const codeMap: Record<string, 'NOT_FOUND' | 'FORBIDDEN' | 'BUSINESS_RULE_VIOLATION' | 'CONFLICT'> = {
        ORDER_NOT_FOUND: 'NOT_FOUND',
        NOT_ASSIGNED: 'FORBIDDEN',
        INVALID_STATUS: 'BUSINESS_RULE_VIOLATION',
        STATUS_CONFLICT: 'CONFLICT',
        NO_PLAN: 'BUSINESS_RULE_VIOLATION',
      }
      return apiError(codeMap[err.code] ?? 'BUSINESS_RULE_VIOLATION', err.message)
    }
    throw err
  }
})

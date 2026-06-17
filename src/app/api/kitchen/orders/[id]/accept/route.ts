import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { kitchenAcceptSchema, validateBody } from '@/lib/validations'
import {
  acceptOrderWithEstimate,
  KitchenEstimateError,
} from '@/lib/kitchen-estimate-service'
import type { EstimateSource } from '@prisma/client'

/**
 * POST /api/kitchen/orders/[id]/accept
 *
 * Atomic action: NEW → ACCEPTED + set initial prep estimate + compute delivery
 * window + status history + KitchenEvent audit.
 *
 * Body: { prepMinutes, source?, reason?, expectedStatus?, expectedEstimateVersion? }
 *
 * Access: KITCHEN, ADMIN, OWNER.
 * Actor identity always from session (estimateSetByUserId = authResult.user.id).
 *
 * Idempotent: if the order is already ACCEPTED with an estimate matching
 * prepMinutes (±1 min), returns the existing state without creating duplicates.
 *
 * 400 on invalid input (Zod validation).
 * 409 on optimistic concurrency conflict (status or estimate version mismatch).
 * 422 on business rule violation (wrong status, out of range).
 */
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: orderId } = await params

  const authResult = await requireRole(request, ['ADMIN', 'KITCHEN', 'OWNER'])
  if ('error' in authResult) return authResult.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_REQUEST', 'Neplatný JSON body')
  }

  const validation = validateBody(kitchenAcceptSchema, body)
  if ('error' in validation) return validation.error

  const data = validation.data
  const actorUserId = authResult.user.id

  try {
    const result = await acceptOrderWithEstimate({
      orderId,
      actorUserId,
      prepMinutes: data.prepMinutes,
      source: data.source as EstimateSource | undefined,
      reason: data.reason,
      expectedStatus: data.expectedStatus,
      expectedEstimateVersion: data.expectedEstimateVersion,
    })

    return Response.json(
      {
        orderId: result.orderId,
        status: result.status,
        estimatedReadyAt: result.estimatedReadyAt?.toISOString() ?? null,
        estimatedDeliveryFrom:
          result.estimatedDeliveryFrom?.toISOString() ?? null,
        estimatedDeliveryTo: result.estimatedDeliveryTo?.toISOString() ?? null,
        estimateStatus: result.estimateStatus,
        estimateVersion: result.estimateVersion,
        estimateUpdatedAt: result.estimateUpdatedAt?.toISOString() ?? null,
        publicDelayReason: result.publicDelayReason,
        updatedAt: result.updatedAt.toISOString(),
      },
      { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
    )
  } catch (err) {
    if (err instanceof KitchenEstimateError) {
      const codeMap: Record<
        string,
        'INVALID_REQUEST' | 'CONFLICT' | 'BUSINESS_RULE_VIOLATION' | 'NOT_FOUND'
      > = {
        ORDER_NOT_FOUND: 'NOT_FOUND',
        INVALID_STATUS: 'BUSINESS_RULE_VIOLATION',
        STATUS_CONFLICT: 'CONFLICT',
        ESTIMATE_VERSION_CONFLICT: 'CONFLICT',
        BUSINESS_RULE_VIOLATION: 'BUSINESS_RULE_VIOLATION',
      }
      return apiError(codeMap[err.code] ?? 'BUSINESS_RULE_VIOLATION', err.message, err.details)
    }
    throw err
  }
})

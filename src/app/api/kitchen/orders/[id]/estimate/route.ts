import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { kitchenEstimateSchema, validateBody } from '@/lib/validations'
import {
  setOrderEstimate,
  delayOrderEstimate,
  KitchenEstimateError,
} from '@/lib/kitchen-estimate-service'
import type { EstimateSource, PublicDelayReason } from '@prisma/client'

/**
 * PATCH /api/kitchen/orders/[id]/estimate
 *
 * Set, replace, or delay the kitchen's estimated ready time for an order.
 *
 * Body (discriminated union by `mode`):
 *  - { mode: 'MINUTES', minutes, source?, reason?, expectedVersion? }
 *  - { mode: 'EXACT_TIME', exactTime (ISO), source?, reason?, expectedVersion? }
 *  - { mode: 'DELAY', additionalMinutes, delayReason, reason?, expectedVersion? }
 *
 * Access: KITCHEN, ADMIN, OWNER.
 * Actor identity always from session (estimateSetByUserId = authResult.user.id).
 *
 * Returns: { orderId, estimatedReadyAt, estimatedDeliveryFrom,
 *            estimatedDeliveryTo, estimateStatus, estimateVersion, updatedAt }
 *
 * 400 on invalid input (Zod validation).
 * 409 on optimistic concurrency conflict (estimate version mismatch).
 * 422 on business rule violation (past time, terminal status, out of range).
 */
export const PATCH = withErrorHandler(async (
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

  const validation = validateBody(kitchenEstimateSchema, body)
  if ('error' in validation) return validation.error

  const data = validation.data
  const actorUserId = authResult.user.id

  try {
    if (data.mode === 'DELAY') {
      const result = await delayOrderEstimate({
        orderId,
        actorUserId,
        additionalMinutes: data.additionalMinutes,
        delayReason: data.delayReason as PublicDelayReason,
        reason: data.reason,
        expectedEstimateVersion: data.expectedVersion,
      })
      return Response.json(
        {
          orderId: result.orderId,
          estimatedReadyAt: result.estimatedReadyAt?.toISOString() ?? null,
          estimatedDeliveryFrom:
            result.estimatedDeliveryFrom?.toISOString() ?? null,
          estimatedDeliveryTo: result.estimatedDeliveryTo?.toISOString() ?? null,
          estimateStatus: result.estimateStatus,
          estimateVersion: result.estimateVersion,
          publicDelayReason: result.publicDelayReason,
          updatedAt: result.updatedAt.toISOString(),
        },
        { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
      )
    }

    // MINUTES or EXACT_TIME
    const result = await setOrderEstimate({
      orderId,
      actorUserId,
      mode: data.mode === 'MINUTES' ? 'MINUTES' : 'EXACT_TIME',
      minutes: data.mode === 'MINUTES' ? data.minutes : undefined,
      exactTime: data.mode === 'EXACT_TIME' ? data.exactTime : undefined,
      source: data.source as EstimateSource | undefined,
      reason: data.reason,
      expectedEstimateVersion: data.expectedVersion,
    })

    return Response.json(
      {
        orderId: result.orderId,
        estimatedReadyAt: result.estimatedReadyAt?.toISOString() ?? null,
        estimatedDeliveryFrom:
          result.estimatedDeliveryFrom?.toISOString() ?? null,
        estimatedDeliveryTo: result.estimatedDeliveryTo?.toISOString() ?? null,
        estimateStatus: result.estimateStatus,
        estimateVersion: result.estimateVersion,
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

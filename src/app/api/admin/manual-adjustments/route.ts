import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { z } from 'zod/v4'

const adjustmentSchema = z.object({
  courierId: z.string().min(1, 'ID kuriéra je povinné'),
  amountCents: z.number().int().refine((v) => v !== 0, 'Suma nesmie byť 0'),
  reason: z.string().min(3, 'Dôvod je povinný (min 3 znaky)').max(500),
  description: z.string().max(200).optional(),
  orderId: z.string().optional(),
  payoutPeriodId: z.string().optional(),
  isNegative: z.boolean().optional(),
})

/**
 * POST /api/admin/manual-adjustments
 *
 * Applies a manual adjustment to a courier's earnings. Positive adjustments
 * are bonuses; negative adjustments require isNegative=true and a reason.
 * All adjustments are audit-logged.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
  if ('error' in authResult) return authResult.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_REQUEST', 'Neplatný JSON body')
  }

  const validation = adjustmentSchema.safeParse(body)
  if (!validation.success) {
    return apiError('INVALID_REQUEST', 'Neplatné parametre', { errors: validation.error.issues })
  }

  const data = validation.data

  // Verify courier exists
  const courier = await db.courier.findUnique({
    where: { id: data.courierId },
    select: { id: true },
  })
  if (!courier) {
    return apiError('NOT_FOUND', 'Kuriér nebol nájdený')
  }

  // Use the earning ledger service to apply the adjustment
  const { applyManualAdjustment } = await import('@/lib/earning-ledger-service')
  const { entryId } = await applyManualAdjustment({
    courierId: data.courierId,
    amountCents: data.amountCents,
    reason: data.reason,
    description: data.description,
    actorUserId: authResult.user.id,
    orderId: data.orderId,
    payoutPeriodId: data.payoutPeriodId,
    isNegative: data.amountCents < 0 ? true : data.isNegative,
  })

  return Response.json({ entryId, amountCents: data.amountCents }, { status: 201 })
})

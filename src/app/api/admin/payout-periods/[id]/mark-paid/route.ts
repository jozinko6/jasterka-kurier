import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { markPayoutPaid, PayoutPeriodError } from '@/lib/payout-period-service'
import { z } from 'zod/v4'

const paidSchema = z.object({
  paymentReference: z.string().min(3, 'Referencia platby je povinná (min 3 znaky)'),
  paidAt: z.string().optional(),
})

/**
 * POST /api/admin/payout-periods/[id]/mark-paid
 *
 * Marks an approved payout period as paid. This is the final immutable state.
 */
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
  if ('error' in authResult) return authResult.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_REQUEST', 'Neplatný JSON body')
  }

  const validation = paidSchema.safeParse(body)
  if (!validation.success) {
    return apiError('INVALID_REQUEST', 'Neplatné parametre', { errors: validation.error.issues })
  }

  const paidAt = validation.data.paidAt ? new Date(validation.data.paidAt) : undefined

  try {
    await markPayoutPaid(id, authResult.user.id, validation.data.paymentReference, paidAt)
    return Response.json({ periodId: id, status: 'PAID', paymentReference: validation.data.paymentReference }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (err) {
    if (err instanceof PayoutPeriodError) {
      const codeMap: Record<string, 'NOT_FOUND' | 'BUSINESS_RULE_VIOLATION' | 'INVALID_REQUEST'> = {
        NOT_FOUND: 'NOT_FOUND',
        INVALID_STATUS: 'BUSINESS_RULE_VIOLATION',
        INVALID_REQUEST: 'INVALID_REQUEST',
      }
      return apiError(codeMap[err.code] ?? 'BUSINESS_RULE_VIOLATION', err.message)
    }
    throw err
  }
})

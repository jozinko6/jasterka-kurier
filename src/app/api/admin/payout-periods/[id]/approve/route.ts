import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { approvePayoutPeriod, PayoutPeriodError } from '@/lib/payout-period-service'
import { z } from 'zod/v4'

const approveSchema = z.object({
  reason: z.string().optional(),
})

/**
 * POST /api/admin/payout-periods/[id]/approve
 *
 * Approves a locked payout period, moving it to APPROVED status.
 */
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
  if ('error' in authResult) return authResult.error

  let body: { reason?: string } = {}
  try {
    body = await request.json()
  } catch {
    // body is optional
  }

  const validation = approveSchema.safeParse(body)
  if (!validation.success) {
    return apiError('INVALID_REQUEST', 'Neplatné parametre')
  }

  try {
    await approvePayoutPeriod(id, authResult.user.id, validation.data.reason)
    return Response.json({ periodId: id, status: 'APPROVED' }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (err) {
    if (err instanceof PayoutPeriodError) {
      const codeMap: Record<string, 'NOT_FOUND' | 'BUSINESS_RULE_VIOLATION'> = {
        NOT_FOUND: 'NOT_FOUND',
        INVALID_STATUS: 'BUSINESS_RULE_VIOLATION',
      }
      return apiError(codeMap[err.code] ?? 'BUSINESS_RULE_VIOLATION', err.message)
    }
    throw err
  }
})

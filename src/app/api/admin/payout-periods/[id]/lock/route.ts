import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { lockPayoutPeriod, PayoutPeriodError } from '@/lib/payout-period-service'
import { z } from 'zod/v4'

const lockSchema = z.object({
  reason: z.string().optional(),
})

/**
 * POST /api/admin/payout-periods/[id]/lock
 *
 * Locks the payout period. After locking, no new entries can be added.
 * Late entries are moved to the next open period.
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

  const validation = lockSchema.safeParse(body)
  if (!validation.success) {
    return apiError('INVALID_REQUEST', 'Neplatné parametre')
  }

  try {
    const result = await lockPayoutPeriod(id, authResult.user.id, validation.data.reason)
    return Response.json(result, {
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

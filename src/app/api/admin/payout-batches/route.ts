import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { createPayoutBatch, BatchError } from '@/lib/payout-batch-service'
import { centsToEuros } from '@/lib/money'

/**
 * GET /api/admin/payout-batches
 * Returns all payout batches.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
  if ('error' in authResult) return authResult.error

  const batches = await db.payoutBatch.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      periods: {
        select: {
          id: true,
          courierId: true,
          payableCents: true,
          paymentReference: true,
          status: true,
          courier: { select: { displayName: true } },
        },
      },
    },
  })

  return Response.json({
    batches: batches.map((b) => ({
      ...b,
      totalEuros: centsToEuros(b.totalCents),
      periods: b.periods.map((p) => ({
        ...p,
        payableEuros: centsToEuros(p.payableCents),
        courierName: p.courier.displayName,
      })),
    })),
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

/**
 * POST /api/admin/payout-batches
 * Creates a new payout batch from all APPROVED periods.
 * Body: { courierId?: string }
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
  if ('error' in authResult) return authResult.error

  let body: { courierId?: string } = {}
  try {
    body = await request.json()
  } catch {
    // body is optional
  }

  try {
    const batch = await createPayoutBatch(authResult.user.id, body)
    return Response.json({
      ...batch,
      totalEuros: centsToEuros(batch.totalCents),
    }, { status: 201 })
  } catch (err) {
    if (err instanceof BatchError) {
      return apiError('BUSINESS_RULE_VIOLATION', err.message)
    }
    throw err
  }
})

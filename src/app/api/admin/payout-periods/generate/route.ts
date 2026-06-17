import { NextRequest } from 'next/server'
import { requireRole } from '@/lib/auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { generatePeriodsForCourier, PayoutPeriodError } from '@/lib/payout-period-service'
import { db } from '@/lib/db'
import { z } from 'zod/v4'

const generateSchema = z.object({
  courierId: z.string().min(1).optional(),
  allCouriers: z.boolean().optional(),
  from: z.string().min(1),
  to: z.string().min(1),
})

/**
 * POST /api/admin/payout-periods/generate
 *
 * Generates payout periods for a courier (or all couriers) within a date range.
 * Body: { courierId?, allCouriers?, from, to }
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

  const validation = generateSchema.safeParse(body)
  if (!validation.success) {
    return apiError('INVALID_REQUEST', 'Neplatné parametre', { errors: validation.error.issues })
  }

  const { courierId, allCouriers, from, to } = validation.data
  const fromDate = new Date(from)
  const toDate = new Date(to)

  if (fromDate >= toDate) {
    return apiError('INVALID_REQUEST', 'Dátum "from" musí byť pred "to"')
  }

  const results: Array<{ courierId: string; generated: number; skipped: number; error?: string }> = []

  if (allCouriers) {
    const couriers = await db.courier.findMany({
      where: { isActive: true },
      select: { id: true },
    })
    for (const c of couriers) {
      try {
        const result = await generatePeriodsForCourier(c.id, fromDate, toDate)
        results.push({ courierId: c.id, ...result })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error'
        results.push({ courierId: c.id, generated: 0, skipped: 0, error: message })
      }
    }
  } else if (courierId) {
    try {
      const result = await generatePeriodsForCourier(courierId, fromDate, toDate)
      results.push({ courierId, ...result })
    } catch (err) {
      if (err instanceof PayoutPeriodError) {
        return apiError('BUSINESS_RULE_VIOLATION', err.message)
      }
      throw err
    }
  } else {
    return apiError('INVALID_REQUEST', 'Zadajte courierId alebo allCouriers=true')
  }

  const totalGenerated = results.reduce((s, r) => s + r.generated, 0)
  const totalSkipped = results.reduce((s, r) => s + r.skipped, 0)

  return Response.json({
    results,
    totalGenerated,
    totalSkipped,
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

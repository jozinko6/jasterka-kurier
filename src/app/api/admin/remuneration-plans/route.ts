import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { z } from 'zod/v4'

/**
 * GET /api/admin/remuneration-plans
 * Returns all remuneration plans with their versions and rule counts.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
  if ('error' in authResult) return authResult.error

  const plans = await db.remunerationPlan.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: { select: { rules: true, zoneRules: true, peakRules: true, versions: true } },
      versions: {
        orderBy: { versionNumber: 'desc' },
        take: 5,
        select: { id: true, versionNumber: true, effectiveFrom: true, effectiveTo: true, createdAt: true },
      },
    },
  })

  return Response.json({ plans }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

const createPlanSchema = z.object({
  name: z.string().min(1, 'Názov je povinný').max(100),
  description: z.string().max(500).optional(),
  currency: z.string().max(3).default('EUR'),
  rules: z.array(z.object({
    ruleType: z.enum([
      'DELIVERY_BASE', 'PICKUP_FEE', 'DROPOFF_FEE', 'PER_KILOMETER',
      'COURIER_TO_STORE_DISTANCE', 'STORE_TO_CUSTOMER_DISTANCE',
      'MINIMUM_PER_ORDER', 'WEEKEND_BONUS', 'HOLIDAY_BONUS',
      'WEATHER_BONUS', 'CANCELLATION_COMPENSATION', 'HOURLY_GUARANTEE',
      'MANUAL_BONUS',
    ]),
    valueType: z.enum(['FIXED_CENTS', 'PERCENT_BASIS_POINTS', 'PER_KILOMETER_CENTS']),
    valueCents: z.number().int().min(0).default(0),
    valueBasisPoints: z.number().int().min(0).max(10000).default(0),
    priority: z.number().int().min(0).default(0),
  })).optional(),
})

/**
 * POST /api/admin/remuneration-plans
 * Creates a new remuneration plan with an initial version and rules.
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

  const validation = createPlanSchema.safeParse(body)
  if (!validation.success) {
    return apiError('INVALID_REQUEST', 'Neplatné parametre', { errors: validation.error.issues })
  }

  const data = validation.data
  const plan = await db.$transaction(async (tx) => {
    const created = await tx.remunerationPlan.create({
      data: {
        name: data.name,
        description: data.description ?? null,
        currency: data.currency,
        isActive: false, // Not active until a version is effective
      },
    })

    // Create initial version
    const version = await tx.remunerationPlanVersion.create({
      data: {
        planId: created.id,
        versionNumber: 1,
        effectiveFrom: new Date(),
        rulesSnapshot: JSON.stringify(data.rules ?? []),
        createdByUserId: authResult.user.id,
      },
    })

    // Create rules
    if (data.rules) {
      for (const rule of data.rules) {
        await tx.remunerationRule.create({
          data: {
            planId: created.id,
            ruleType: rule.ruleType,
            valueType: rule.valueType,
            valueCents: rule.valueCents,
            valueBasisPoints: rule.valueBasisPoints,
            priority: rule.priority,
            active: true,
          },
        })
      }
    }

    // Activate the plan
    await tx.remunerationPlan.update({
      where: { id: created.id },
      data: { isActive: true },
    })

    return { plan: created, version }
  })

  return Response.json(plan, { status: 201 })
})

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { z } from 'zod/v4'

const createVersionSchema = z.object({
  effectiveFrom: z.string().min(1),
  rules: z.array(z.object({
    ruleType: z.string(),
    valueType: z.enum(['FIXED_CENTS', 'PERCENT_BASIS_POINTS', 'PER_KILOMETER_CENTS']),
    valueCents: z.number().int().min(0).default(0),
    valueBasisPoints: z.number().int().min(0).max(10000).default(0),
    priority: z.number().int().min(0).default(0),
  })),
  comment: z.string().optional(),
})

/**
 * POST /api/admin/remuneration-plans/[id]/versions
 *
 * Creates a new version of an existing remuneration plan. The new version
 * becomes effective at `effectiveFrom`. Historical earnings are NOT
 * recalculated — they keep using the snapshot from the version that was
 * effective at the time of the earning.
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

  const validation = createVersionSchema.safeParse(body)
  if (!validation.success) {
    return apiError('INVALID_REQUEST', 'Neplatné parametre', { errors: validation.error.issues })
  }

  const data = validation.data
  const effectiveFrom = new Date(data.effectiveFrom)

  const plan = await db.remunerationPlan.findUnique({
    where: { id },
    include: {
      versions: { orderBy: { versionNumber: 'desc' }, take: 1 },
    },
  })

  if (!plan) {
    return apiError('NOT_FOUND', 'Sadzobník nebol nájdený')
  }

  const lastVersion = plan.versions[0]
  const newVersionNumber = (lastVersion?.versionNumber ?? 0) + 1

  const result = await db.$transaction(async (tx) => {
    // Close the previous version
    if (lastVersion && !lastVersion.effectiveTo) {
      await tx.remunerationPlanVersion.update({
        where: { id: lastVersion.id },
        data: { effectiveTo: effectiveFrom },
      })
    }

    // Create new version
    const version = await tx.remunerationPlanVersion.create({
      data: {
        planId: id,
        versionNumber: newVersionNumber,
        effectiveFrom,
        rulesSnapshot: JSON.stringify({
          rules: data.rules,
          comment: data.comment,
          createdBy: authResult.user.id,
        }),
        createdByUserId: authResult.user.id,
      },
    })

    // Deactivate old rules and create new ones
    await tx.remunerationRule.updateMany({
      where: { planId: id, active: true },
      data: { active: false, validTo: effectiveFrom },
    })

    for (const rule of data.rules) {
      await tx.remunerationRule.create({
        data: {
          planId: id,
          ruleType: rule.ruleType as never,
          valueType: rule.valueType,
          valueCents: rule.valueCents,
          valueBasisPoints: rule.valueBasisPoints,
          priority: rule.priority,
          active: true,
          validFrom: effectiveFrom,
        },
      })
    }

    return version
  })

  return Response.json(result, { status: 201 })
})

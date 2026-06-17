import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { getTodayRange, toBratislava, fromBratislava } from '@/lib/timezone'

/**
 * GET /api/courier-earnings
 *
 * Query params:
 * - courierId: optional (admin can view any; courier views own)
 * - from: ISO date (Bratislava wall-clock)
 * - to: ISO date (Bratislava wall-clock)
 * - range: 'today' | 'week' | 'custom' (default: today)
 *
 * UI "Dnešné zárobky" should use range=today which sends the start and end
 * of the current day in Europe/Bratislava. Lifetime aggregate is NEVER
 * returned as "today".
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRole(request, ['ADMIN', 'COURIER', 'OWNER'])
  if ('error' in authResult) return authResult.error

  const { searchParams } = new URL(request.url)
  const requestedCourierId = searchParams.get('courierId')
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const range = searchParams.get('range') ?? 'today'
  const canManage = authResult.user.role === 'ADMIN' || authResult.user.role === 'OWNER'

  let courierId = requestedCourierId

  if (!canManage) {
    // Couriers can only view their own earnings
    const courier = await db.courier.findUnique({
      where: { userId: authResult.user.id },
      select: { id: true },
    })
    if (!courier) {
      return apiError('NOT_FOUND', 'Kuriérsky profil nebol nájdený')
    }
    if (requestedCourierId && requestedCourierId !== courier.id) {
      return apiError('FORBIDDEN', 'Nemáte oprávnenie zobraziť zárobky tohto kuriéra')
    }
    courierId = courier.id
  }

  // Determine date range in Europe/Bratislava
  let start: Date
  let end: Date

  if (range === 'today') {
    const r = getTodayRange()
    start = r.start
    end = r.end
  } else if (range === 'week') {
    const local = toBratislava(new Date())
    const dayOfWeek = local.getUTCDay()
    const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    const startWall = new Date(Date.UTC(
      local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday, 0, 0, 0, 0
    ))
    const endWall = new Date(startWall)
    endWall.setUTCDate(endWall.getUTCDate() + 7)
    start = fromBratislava(startWall)
    end = fromBratislava(endWall)
  } else if (range === 'custom') {
    if (!fromParam || !toParam) {
      return apiError('INVALID_REQUEST', 'Pre range=custom sú potrebné parametre from a to')
    }
    start = fromBratislava(new Date(fromParam + 'T00:00:00'))
    end = fromBratislava(new Date(toParam + 'T23:59:59.999'))
  } else {
    return apiError('INVALID_REQUEST', `Neznámy range: ${range}`)
  }

  const where: Record<string, unknown> = {
    earningDate: { gte: start, lt: end },
  }
  if (courierId) {
    where.courierId = courierId
  }

  const earnings = await db.courierEarning.findMany({
    where,
    orderBy: { earningDate: 'desc' },
    include: {
      courier: { select: { id: true, displayName: true, phone: true } },
      order: { select: { id: true, orderNumber: true } },
      zone: { select: { id: true, name: true } },
    },
  })

  // Summary for the requested range (NOT lifetime)
  if (courierId) {
    const summary = await db.courierEarning.aggregate({
      where: { courierId, earningDate: { gte: start, lt: end } },
      _sum: {
        baseAmount: true,
        zoneBonusAmount: true,
        manualAdjustmentAmount: true,
        totalAmount: true,
      },
      _count: true,
    })

    return NextResponse.json({
      range: { start, end, type: range },
      earnings,
      summary: {
        totalBaseAmount: Number(summary._sum.baseAmount) || 0,
        totalZoneBonus: Number(summary._sum.zoneBonusAmount) || 0,
        totalAdjustments: Number(summary._sum.manualAdjustmentAmount) || 0,
        totalEarnings: Number(summary._sum.totalAmount) || 0,
        deliveryCount: summary._count,
      },
    }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  }

  return NextResponse.json(earnings, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

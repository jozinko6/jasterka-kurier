import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireCourier } from '@/lib/courier-auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { getTodayRange, getThisWeekRange, toBratislava, fromBratislava } from '@/lib/timezone'

/**
 * GET /api/courier/deliveries
 *
 * Query params:
 * - filter: 'active' | 'scheduled' | 'completed' | 'cancelled' (default: active)
 * - range: 'today' | 'week' | 'custom' (default: today; for completed/cancelled)
 * - from, to: ISO date for custom range
 * - limit: max 100 (default 50)
 * - cursor: pagination cursor
 *
 * Returns courier's deliveries with assignment and order details.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireCourier(request)
  if ('error' in authResult) return authResult.error

  const { courier } = authResult.data
  const { searchParams } = new URL(request.url)
  const filter = searchParams.get('filter') ?? 'active'
  const range = searchParams.get('range') ?? 'today'
  const fromParam = searchParams.get('from')
  const toParam = searchParams.get('to')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 100)
  const cursor = searchParams.get('cursor')

  let start: Date | null = null
  let end: Date | null = null

  if (filter === 'completed' || filter === 'cancelled') {
    if (range === 'today') {
      ({ start, end } = getTodayRange())
    } else if (range === 'week') {
      ({ start, end } = getThisWeekRange())
    } else if (range === 'custom' && fromParam && toParam) {
      start = fromBratislava(new Date(fromParam + 'T00:00:00'))
      end = fromBratislava(new Date(toParam + 'T23:59:59.999'))
    }
  }

  // Build where clause based on filter
  const where: Record<string, unknown> = { courierId: courier.id }

  if (filter === 'active') {
    where.status = { in: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP'] }
  } else if (filter === 'completed') {
    where.status = 'DELIVERED'
    if (start && end) {
      where.deliveredAt = { gte: start, lt: end }
    }
  } else if (filter === 'cancelled') {
    where.status = 'CANCELLED'
    if (start && end) {
      where.updatedAt = { gte: start, lt: end }
    }
  } else if (filter === 'scheduled') {
    // Scheduled = assigned but not yet picked up
    where.status = { in: ['ASSIGNED', 'ACCEPTED'] }
  }

  const assignments = await db.deliveryAssignment.findMany({
    where,
    orderBy: { assignedAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          status: true,
          orderType: true,
          paymentMethod: true,
          totalAmount: true,
          customerName: true,
          customerPhone: true,
          deliveryAddressLine1: true,
          deliveryCity: true,
          deliveryNote: true,
          kitchenNote: true,
          items: {
            select: {
              id: true,
              menuItemNameSnapshot: true,
              quantity: true,
            },
          },
          deliveryZone: {
            select: { id: true, name: true },
          },
          acceptedAt: true,
          readyAt: true,
          pickedUpAt: true,
          deliveredAt: true,
          createdAt: true,
        },
      },
      zone: {
        select: { id: true, name: true },
      },
    },
  })

  const hasMore = assignments.length > limit
  const items = hasMore ? assignments.slice(0, limit) : assignments
  const nextCursor = hasMore ? items[items.length - 1].id : null

  // For completed deliveries, also load the earning breakdown
  const orderIds = items.map((a) => a.orderId).filter(Boolean)
  const earnings = orderIds.length > 0
    ? await db.earningLedgerEntry.findMany({
        where: {
          courierId: courier.id,
          orderId: { in: orderIds },
          status: 'CONFIRMED',
          type: { not: 'REVERSAL' },
        },
        select: {
          orderId: true,
          type: true,
          amountCents: true,
          description: true,
        },
      })
    : []

  const earningsByOrder = new Map<string, { total: number; components: Array<{ type: string; amount: number; description: string | null }> }>()
  for (const e of earnings) {
    if (!e.orderId) continue
    const existing = earningsByOrder.get(e.orderId) ?? { total: 0, components: [] }
    existing.total += e.amountCents
    existing.components.push({ type: e.type, amount: e.amountCents, description: e.description })
    earningsByOrder.set(e.orderId, existing)
  }

  return Response.json({
    deliveries: items.map((a) => ({
      assignmentId: a.id,
      assignmentStatus: a.status,
      assignedAt: a.assignedAt,
      pickedUpAt: a.pickedUpAt,
      deliveredAt: a.deliveredAt,
      order: a.order,
      zone: a.zone,
      earnings: a.orderId ? earningsByOrder.get(a.orderId) ?? null : null,
    })),
    nextCursor,
    hasMore,
    range: start && end ? { start, end } : null,
    filter,
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

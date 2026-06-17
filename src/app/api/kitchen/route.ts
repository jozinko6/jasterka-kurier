import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { OrderStatus } from '@prisma/client'
import { requireRole } from '@/lib/auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { toKitchenOrderDTO } from '@/lib/kitchen-dto'
import { getAllowedTransitionsForContext } from '@/lib/order-policy'

/**
 * GET /api/kitchen
 *
 * Returns all active kitchen orders (NEW, ACCEPTED, IN_KITCHEN, PREPARING, READY).
 *
 * Optimized for polling (kitchen polls every 3-5s):
 * - Selects ONLY kitchen-relevant fields — no customer phone/email/name,
 *   no delivery address, no financial data, no courier internals.
 * - Includes ETA fields, items, delivery zone name only.
 * - Adds `allowedTransitions` per order based on the requester's role.
 *
 * Access: ADMIN, KITCHEN, OWNER.
 * Cache-Control: private, no-store, max-age=0 (never cached by browser/SW).
 */
const KITCHEN_STATUSES: OrderStatus[] = [
  'NEW',
  'ACCEPTED',
  'IN_KITCHEN',
  'PREPARING',
  'READY',
]

export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRole(request, ['ADMIN', 'KITCHEN', 'OWNER'])
  if ('error' in authResult) return authResult.error

  const role = authResult.user.role as 'ADMIN' | 'OWNER' | 'KITCHEN'

  // Select ONLY kitchen-relevant fields. No customer contact info, no financial
  // data, no courier internals. Items + delivery zone name only.
  const orders = await db.order.findMany({
    where: { status: { in: KITCHEN_STATUSES } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      orderType: true,
      paymentMethod: true,
      createdAt: true,
      scheduledFor: true,
      kitchenNote: true,
      // ETA fields
      estimatedReadyAt: true,
      estimatedDeliveryFrom: true,
      estimatedDeliveryTo: true,
      estimateStatus: true,
      estimateVersion: true,
      estimateUpdatedAt: true,
      publicDelayReason: true,
      readyAt: true,
      // Zone name only (no address)
      deliveryZone: { select: { name: true } },
      // Items — kitchen-relevant fields only
      items: {
        select: {
          id: true,
          menuItemNameSnapshot: true,
          quantity: true,
          selectedSize: true,
          selectedOptions: true,
          kitchenNote: true,
        },
      },
    },
  })

  const dtos = orders.map((order) => {
    const dto = toKitchenOrderDTO(order)
    const allowedTransitions = getAllowedTransitionsForContext({
      role,
      orderType: order.orderType as 'DELIVERY' | 'PICKUP',
      currentStatus: order.status as OrderStatus,
      courierAssigned: false,
    })
    return { ...dto, allowedTransitions }
  })

  return Response.json(dtos, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderStatus } from '@prisma/client'
import { authenticateRequest } from '@/lib/auth'
import { updateOrderStatusSchema, validateBody } from '@/lib/validations'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { canReadOrder, toPublicOrderTrackingDTO, toKitchenOrderDTO } from '@/lib/order-auth'
import { canTransitionOrder, getAllowedTransitionsForContext } from '@/lib/order-policy'

/**
 * GET /api/orders/[id]
 *
 * - Authenticated staff: full detail (ADMIN/OWNER), kitchen-scoped (KITCHEN),
 *   full detail if owned (COURIER)
 * - Anonymous public tracking: requires ?token={trackingToken}
 *   Returns ONLY the PublicOrderTrackingDTO (no personal/internal fields)
 */
export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  const { searchParams } = new URL(request.url)
  const trackingToken = searchParams.get('token')

  // Try authenticated read first
  const authResult = await authenticateRequest(request)

  if (!('error' in authResult)) {
    const readPerm = await canReadOrder(authResult.user, id)

    if (readPerm.allowed) {
      // Load order with appropriate includes based on scope
      if (readPerm.scope === 'kitchen') {
        // Kitchen sees items + status but NOT customer contact or courier internals
        const order = await db.order.findUnique({
          where: { id },
          select: {
            id: true,
            orderNumber: true,
            status: true,
            orderType: true,
            paymentMethod: true,
            kitchenNote: true,
            createdAt: true,
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
        if (!order) return apiError('NOT_FOUND', 'Objednávka nenájdená')
        // Include allowedTransitions for kitchen UI
        const kitchenTransitions = getAllowedTransitionsForContext({
          role: 'KITCHEN',
          orderType: order.orderType,
          currentStatus: order.status,
          courierAssigned: false,
        })
        return NextResponse.json(
          { ...toKitchenOrderDTO(order), allowedTransitions: kitchenTransitions },
          { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
        )
      }

      // Full detail for ADMIN/OWNER/COURIER(own)
      const order = await db.order.findUnique({
        where: { id },
        include: {
          items: true,
          statusHistory: {
            orderBy: { createdAt: 'asc' },
            include: { changedByUser: { select: { id: true, email: true, role: true } } },
          },
          deliveryZone: true,
          customer: { include: { user: { select: { id: true, email: true, phone: true } } } },
          assignments: {
            include: { courier: { include: { user: { select: { id: true, email: true } } } } },
          },
        },
      })

      if (!order) return apiError('NOT_FOUND', 'Objednávka nenájdená')

      // Compute allowed transitions for this user + order
      const courierAssigned = readPerm.courierOwned ?? false
      const allowedTransitions = getAllowedTransitionsForContext({
        role: authResult.user.role,
        orderType: order.orderType,
        currentStatus: order.status,
        courierAssigned,
      })

      return NextResponse.json(
        { ...order, allowedTransitions },
        { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
      )
    }
  }

  // Anonymous public tracking — requires valid tracking token
  if (!trackingToken) {
    return apiError('UNAUTHENTICATED', 'Pre zobrazenie objednávky sa prihláste alebo použite tracking token.')
  }

  // Load order by id + verify token hash
  const order = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      orderNumber: true,
      status: true,
      orderType: true,
      paymentMethod: true,
      totalAmount: true,
      createdAt: true,
      acceptedAt: true,
      readyAt: true,
      pickedUpAt: true,
      deliveredAt: true,
      trackingTokenHash: true,
      items: {
        select: {
          id: true,
          menuItemNameSnapshot: true,
          quantity: true,
          lineTotal: true,
          selectedSize: true,
          selectedOptions: true,
        },
      },
      assignments: {
        where: { status: { in: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP'] } },
        orderBy: { assignedAt: 'desc' },
        take: 1,
        select: {
          status: true,
          courier: {
            select: {
              displayName: true,
              vehicleType: true,
              profilePhotoUrl: true,
            },
          },
        },
      },
    },
  })

  if (!order) return apiError('NOT_FOUND', 'Objednávka nenájdená')

  // Verify tracking token (constant-time comparison)
  if (!order.trackingTokenHash) {
    return apiError('FORBIDDEN', 'Tracking token nie je k dispozícii pre túto objednávku.')
  }

  const crypto = await import('crypto')
  const providedHash = crypto.createHash('sha256').update(trackingToken).digest('hex')
  const a = Buffer.from(providedHash)
  const b = Buffer.from(order.trackingTokenHash)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return apiError('FORBIDDEN', 'Neplatný tracking token.')
  }

  // Return sanitized public DTO (strip trackingTokenHash from response)
  const { trackingTokenHash: _omit, ...publicOrder } = order
  void _omit
  return NextResponse.json(
    toPublicOrderTrackingDTO(publicOrder),
    { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
  )
})

/**
 * PATCH /api/orders/[id]
 *
 * Updates order status with:
 * - Resource-level authorization (role + ownership)
 * - Role-specific transition policy (DELIVERY vs PICKUP, KITCHEN vs COURIER vs ADMIN)
 * - Optimistic concurrency (expectedStatus → updateMany → 409 if mismatch)
 * - Audit actor from session (NEVER from client)
 */
export const PATCH = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const authResult = await authenticateRequest(request)
  if ('error' in authResult) {
    return apiError('UNAUTHENTICATED', 'Neautorizovaný prístup.')
  }

  const { id } = await params
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_REQUEST', 'Neplatný JSON body')
  }

  const validation = validateBody(updateOrderStatusSchema, body)
  if ('error' in validation) return validation.error

  const data = validation.data

  // Load current order with assignment info (for ownership check)
  const existingOrder = await db.order.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      orderType: true,
      assignments: { select: { courierId: true, status: true } },
    },
  })
  if (!existingOrder) {
    return apiError('NOT_FOUND', 'Objednávka nenájdená')
  }

  // ─── Resource-level authorization ───
  // Only staff (ADMIN/OWNER/KITCHEN/COURIER) can mutate orders.
  // COURIER can only mutate orders they own.
  const role = authResult.user.role
  if (!['ADMIN', 'OWNER', 'KITCHEN', 'COURIER'].includes(role)) {
    return apiError('FORBIDDEN', 'Nemáte oprávnenie meniť stav objednávky.')
  }

  let courierAssigned = false
  if (role === 'COURIER') {
    const courier = await db.courier.findUnique({
      where: { userId: authResult.user.id },
      select: { id: true },
    })
    if (!courier) return apiError('FORBIDDEN', 'Kuriérsky profil nebol nájdený.')
    courierAssigned = existingOrder.assignments.some(
      (a) => a.courierId === courier.id && ['ASSIGNED', 'ACCEPTED', 'PICKED_UP'].includes(a.status)
    )
    if (!courierAssigned) {
      return apiError('FORBIDDEN', 'Nemáte priradenú túto objednávku.')
    }
  }

  // ─── Transition policy check ───
  const transition = canTransitionOrder(
    {
      role: role as 'ADMIN' | 'OWNER' | 'KITCHEN' | 'COURIER',
      orderType: existingOrder.orderType,
      currentStatus: existingOrder.status,
      courierAssigned,
    },
    data.status as OrderStatus
  )
  if (!transition.allowed) {
    return apiError('BUSINESS_RULE_VIOLATION', transition.reason ?? 'Prechod nie je povolený.')
  }

  // ─── Unconditional optimistic concurrency ───
  // ALWAYS use compare-and-swap with the server-loaded currentStatus.
  // This prevents race conditions even when the client doesn't send expectedStatus.
  // If the client sends expectedStatus and it doesn't match currentStatus, return 409 immediately.
  const currentStatus = existingOrder.status
  const clientExpectedStatus = data.expectedStatus

  if (clientExpectedStatus && clientExpectedStatus !== currentStatus) {
    return apiError('CONFLICT', 'Objednávku medzičasom zmenil iný používateľ.', {
      currentStatus,
      expectedStatus: clientExpectedStatus,
    })
  }

  const now = new Date()

  const timestampUpdates: Record<string, Date> = {}
  switch (data.status as OrderStatus) {
    case 'ACCEPTED': timestampUpdates.acceptedAt = now; break
    case 'READY': timestampUpdates.readyAt = now; break
    case 'PICKED_UP': timestampUpdates.pickedUpAt = now; break
    case 'DELIVERED': timestampUpdates.deliveredAt = now; break
  }

  try {
    const updatedOrder = await db.$transaction(async (tx) => {
      // Unconditional compare-and-swap: always guard with currentStatus
      const updateResult = await tx.order.updateMany({
        where: {
          id,
          status: currentStatus, // server-loaded status as guard
        },
        data: {
          status: data.status as OrderStatus,
          ...timestampUpdates,
        },
      })

      if (updateResult.count !== 1) {
        // Status changed between our read and update — race condition detected
        throw new Error('STATUS_CONFLICT')
      }

      // Create status history (actor from session, NEVER from client)
      await tx.orderStatusHistory.create({
        data: {
          orderId: id,
          status: data.status as OrderStatus,
          changedByUserId: authResult.user.id,
          reason: data.reason || null,
        },
      })

      // Update delivery assignment for courier transitions
      if (data.status === 'PICKED_UP') {
        await tx.deliveryAssignment.updateMany({
          where: { orderId: id, status: { in: ['ASSIGNED', 'ACCEPTED'] } },
          data: { status: 'PICKED_UP', pickedUpAt: now },
        })
      }
      if (data.status === 'DELIVERED') {
        await tx.deliveryAssignment.updateMany({
          where: { orderId: id, status: { in: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP'] } },
          data: { status: 'DELIVERED', deliveredAt: now },
        })
      }
      if (data.status === 'CANCELLED') {
        await tx.deliveryAssignment.updateMany({
          where: { orderId: id, status: { in: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP'] } },
          data: { status: 'CANCELLED' },
        })
      }

      // Recalculate courier active order count (centralized)
      const affectedCourierIds = [...new Set(existingOrder.assignments.map((a) => a.courierId))]
      for (const courierId of affectedCourierIds) {
        const activeOrderCount = await tx.deliveryAssignment.count({
          where: {
            courierId,
            status: { in: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP'] },
            order: { status: { in: ['ASSIGNED_TO_COURIER', 'PICKED_UP', 'ON_THE_WAY'] } },
          },
        })
        await tx.courier.update({
          where: { id: courierId },
          data: { activeOrderCount },
        })
      }

      // Return the updated order with includes
      return tx.order.findUnique({
        where: { id },
        include: {
          items: true,
          statusHistory: { orderBy: { createdAt: 'asc' } },
          deliveryZone: true,
          assignments: {
            include: { courier: { include: { user: { select: { id: true, email: true } } } } },
          },
        },
      })
    })

    // Compute allowed transitions for the new state
    const allowedTransitions = getAllowedTransitionsForContext({
      role: role as 'ADMIN' | 'OWNER' | 'KITCHEN' | 'COURIER',
      orderType: updatedOrder!.orderType,
      currentStatus: updatedOrder!.status,
      courierAssigned,
    })

    return NextResponse.json(
      { ...updatedOrder!, allowedTransitions },
      { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
    )
  } catch (err) {
    if (err instanceof Error && err.message === 'STATUS_CONFLICT') {
      // Reload current status for the response
      const current = await db.order.findUnique({
        where: { id },
        select: { status: true },
      })
      return apiError('CONFLICT', 'Objednávku medzičasom zmenil iný používateľ.', {
        currentStatus: current?.status,
      })
    }
    throw err
  }
})

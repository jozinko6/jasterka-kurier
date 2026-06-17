import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireCourier, requireAssignedCourierForOrder } from '@/lib/courier-auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'

/**
 * POST /api/courier/orders/[id]/pickup
 *
 * Atomic action: marks the order as PICKED_UP.
 * - Verifies courier owns the active assignment
 * - Verifies order is in ASSIGNED_TO_COURIER state
 * - Updates order, assignment, and courier status in one transaction
 * - Creates status history with session identity (not client-provided)
 */
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: orderId } = await params
  const authResult = await requireCourier(request)
  if ('error' in authResult) return authResult.error

  const { courier, user } = authResult.data

  // Verify ownership
  const ownership = await requireAssignedCourierForOrder(courier.id, orderId)
  if ('error' in ownership) return ownership.error

  // Optimistic concurrency: use updateMany with expected status
  const now = new Date()
  const result = await db.$transaction(async (tx) => {
    // Try to update order with expectedStatus check
    const updated = await tx.order.updateMany({
      where: { id: orderId, status: 'ASSIGNED_TO_COURIER' },
      data: {
        status: 'PICKED_UP',
        pickedUpAt: now,
      },
    })

    if (updated.count !== 1) {
      throw new Error('STATUS_CONFLICT')
    }

    // Create status history
    await tx.orderStatusHistory.create({
      data: {
        orderId,
        status: 'PICKED_UP',
        changedByUserId: user.id,
        reason: 'Vyzdvihnuté kuriérom',
      },
    })

    // Update assignment
    await tx.deliveryAssignment.updateMany({
      where: { orderId, status: { in: ['ASSIGNED', 'ACCEPTED'] } },
      data: { status: 'PICKED_UP', pickedUpAt: now },
    })

    // Update courier status
    await tx.courier.update({
      where: { id: courier.id },
      data: { status: 'PICKING_UP' },
    })

    return { ok: true }
  }).catch((err) => {
    if (err instanceof Error && err.message === 'STATUS_CONFLICT') {
      return { conflict: true }
    }
    throw err
  })

  if ('conflict' in result) {
    // Load current status for the response
    const current = await db.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    })
    return apiError('CONFLICT', 'Objednávku medzičasom zmenil iný používateľ.', {
      currentStatus: current?.status,
    })
  }

  return Response.json({ orderId, status: 'PICKED_UP' }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

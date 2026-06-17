import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireCourier, requireAssignedCourierForOrder } from '@/lib/courier-auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'

/**
 * POST /api/courier/orders/[id]/start-delivery
 *
 * Atomic action: marks the order as ON_THE_WAY.
 * - Verifies courier owns the active assignment
 * - Verifies order is in PICKED_UP state
 * - Updates order, assignment, and courier status in one transaction
 */
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id: orderId } = await params
  const authResult = await requireCourier(request)
  if ('error' in authResult) return authResult.error

  const { courier, user } = authResult.data

  const ownership = await requireAssignedCourierForOrder(courier.id, orderId)
  if ('error' in ownership) return ownership.error

  const now = new Date()
  const result = await db.$transaction(async (tx) => {
    const updated = await tx.order.updateMany({
      where: { id: orderId, status: 'PICKED_UP' },
      data: { status: 'ON_THE_WAY' },
    })

    if (updated.count !== 1) {
      throw new Error('STATUS_CONFLICT')
    }

    await tx.orderStatusHistory.create({
      data: {
        orderId,
        status: 'ON_THE_WAY',
        changedByUserId: user.id,
        reason: 'Kuriér na ceste k zákazníkovi',
      },
    })

    await tx.deliveryAssignment.updateMany({
      where: { orderId, status: 'PICKED_UP' },
      data: { status: 'PICKED_UP' }, // assignment stays PICKED_UP until DELIVERED
    })

    await tx.courier.update({
      where: { id: courier.id },
      data: { status: 'DELIVERING' },
    })

    return { ok: true }
  }).catch((err) => {
    if (err instanceof Error && err.message === 'STATUS_CONFLICT') {
      return { conflict: true }
    }
    throw err
  })

  if ('conflict' in result) {
    const current = await db.order.findUnique({
      where: { id: orderId },
      select: { status: true },
    })
    return apiError('CONFLICT', 'Objednávku medzičasom zmenil iný používateľ.', {
      currentStatus: current?.status,
    })
  }

  return Response.json({ orderId, status: 'ON_THE_WAY' }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

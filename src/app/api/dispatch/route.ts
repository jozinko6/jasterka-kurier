import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { dispatchSchema, validateBody } from '@/lib/validations'

export async function POST(request: NextRequest) {
  try {
    // Only ADMIN and OWNER can dispatch couriers
    const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const body = await request.json()

    // Validate input
    const validation = validateBody(dispatchSchema, body)
    if ('error' in validation) {
      return validation.error
    }

    const data = validation.data

    // Wrap all writes in a transaction
    const assignment = await db.$transaction(async (tx) => {
      // Verify order exists
      const order = await tx.order.findUnique({
        where: { id: data.orderId },
      })

      if (!order) {
        throw new Error('ORDER_NOT_FOUND')
      }

      // Verify courier exists and is active
      const courier = await tx.courier.findUnique({
        where: { id: data.courierId },
      })

      if (!courier || !courier.isActive) {
        throw new Error('COURIER_NOT_FOUND')
      }

      const existingAssignment = await tx.deliveryAssignment.findFirst({
        where: {
          orderId: data.orderId,
          status: { in: ['PENDING', 'ASSIGNED', 'ACCEPTED', 'PICKED_UP'] },
        },
      })

      if (existingAssignment) {
        throw new Error('ORDER_ALREADY_ASSIGNED')
      }

      // Create assignment
      const assignment = await tx.deliveryAssignment.create({
        data: {
          orderId: data.orderId,
          courierId: data.courierId,
          zoneId: order.deliveryZoneId || null,
          assignedByUserId: data.assignedByUserId || authResult.user.id,
          status: 'ASSIGNED',
        },
      })

      // Update order status
      await tx.order.update({
        where: { id: data.orderId },
        data: {
          status: 'ASSIGNED_TO_COURIER',
          statusHistory: {
            create: {
              status: 'ASSIGNED_TO_COURIER',
              changedByUserId: data.assignedByUserId || authResult.user.id,
              reason: `Priradený kuriér: ${courier.displayName}`,
            },
          },
        },
      })

      // Increment courier active order count
      await tx.courier.update({
        where: { id: data.courierId },
        data: {
          activeOrderCount: { increment: 1 },
        },
      })

      return assignment
    })

    return NextResponse.json(assignment, { status: 201 })
  } catch (error) {
    if (error instanceof Error && error.message === 'ORDER_NOT_FOUND') {
      return NextResponse.json(
        { error: 'Objednávka nenájdená' },
        { status: 404 }
      )
    }
    if (error instanceof Error && error.message === 'COURIER_NOT_FOUND') {
      return NextResponse.json(
        { error: 'Kuriér nenájdený alebo neaktívny' },
        { status: 404 }
      )
    }
    if (error instanceof Error && error.message === 'ORDER_ALREADY_ASSIGNED') {
      return NextResponse.json(
        { error: 'Objednavka uz ma aktivne priradenie kuriera' },
        { status: 409 }
      )
    }
    console.error('Error assigning courier:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa priradiť kuriéra' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { orderId, courierId, assignedByUserId } = body

    if (!orderId || !courierId) {
      return NextResponse.json(
        { error: 'Missing required fields: orderId, courierId' },
        { status: 400 }
      )
    }

    // Verify order exists
    const order = await db.order.findUnique({
      where: { id: orderId },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Verify courier exists and is active
    const courier = await db.courier.findUnique({
      where: { id: courierId },
    })

    if (!courier || !courier.isActive) {
      return NextResponse.json(
        { error: 'Courier not found or inactive' },
        { status: 404 }
      )
    }

    // Create assignment, update order status, and increment courier activeOrderCount
    const assignment = await db.deliveryAssignment.create({
      data: {
        orderId,
        courierId,
        zoneId: order.deliveryZoneId || null,
        assignedByUserId: assignedByUserId || null,
        status: 'ASSIGNED',
      },
    })

    await db.order.update({
      where: { id: orderId },
      data: {
        status: 'ASSIGNED_TO_COURIER',
        statusHistory: {
          create: {
            status: 'ASSIGNED_TO_COURIER',
            changedByUserId: assignedByUserId || null,
            reason: `Assigned to courier: ${courier.displayName}`,
          },
        },
      },
    })

    await db.courier.update({
      where: { id: courierId },
      data: {
        activeOrderCount: { increment: 1 },
      },
    })

    return NextResponse.json(assignment, { status: 201 })
  } catch (error) {
    console.error('Error assigning courier:', error)
    return NextResponse.json(
      { error: 'Failed to assign courier' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderStatus } from '@prisma/client'
import { decimalToNumber } from '@/lib/decimal-utils'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const order = await db.order.findUnique({
      where: { id },
      include: {
        items: true,
        statusHistory: {
          orderBy: { createdAt: 'asc' },
          include: {
            changedByUser: {
              select: { id: true, email: true, role: true },
            },
          },
        },
        deliveryZone: true,
        customer: {
          include: {
            user: {
              select: { id: true, email: true, phone: true },
            },
          },
        },
        assignments: {
          include: {
            courier: {
              include: {
                user: { select: { id: true, email: true } },
              },
            },
          },
        },
        earnings: true,
        kitchenEvents: {
          orderBy: { createdAt: 'desc' },
        },
      },
    })

    if (!order) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    return NextResponse.json(decimalToNumber(order))
  } catch (error) {
    console.error('Error fetching order:', error)
    return NextResponse.json(
      { error: 'Failed to fetch order' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await request.json()
    const { status, changedByUserId, reason } = body

    if (!status) {
      return NextResponse.json(
        { error: 'Missing required field: status' },
        { status: 400 }
      )
    }

    // Verify order exists
    const existingOrder = await db.order.findUnique({ where: { id } })
    if (!existingOrder) {
      return NextResponse.json(
        { error: 'Order not found' },
        { status: 404 }
      )
    }

    // Build timestamp updates based on status
    const timestampUpdates: Record<string, Date> = {}
    const now = new Date()

    switch (status as OrderStatus) {
      case 'ACCEPTED':
        timestampUpdates.acceptedAt = now
        break
      case 'READY':
        timestampUpdates.readyAt = now
        break
      case 'PICKED_UP':
        timestampUpdates.pickedUpAt = now
        break
      case 'DELIVERED':
        timestampUpdates.deliveredAt = now
        break
    }

    // Update order and create status history in a transaction
    const updatedOrder = await db.order.update({
      where: { id },
      data: {
        status: status as OrderStatus,
        ...timestampUpdates,
        statusHistory: {
          create: {
            status: status as OrderStatus,
            changedByUserId: changedByUserId || null,
            reason: reason || null,
          },
        },
      },
      include: {
        items: true,
        statusHistory: {
          orderBy: { createdAt: 'asc' },
        },
        deliveryZone: true,
      },
    })

    return NextResponse.json(decimalToNumber(updatedOrder))
  } catch (error) {
    console.error('Error updating order:', error)
    return NextResponse.json(
      { error: 'Failed to update order' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderStatus } from '@prisma/client'
import { decimalToNumber } from '@/lib/decimal-utils'
import { authenticateRequest, requireRole, isValidStatusTransition, getAllowedTransitions } from '@/lib/auth'
import { updateOrderStatusSchema, validateBody } from '@/lib/validations'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Public endpoint - customers can track their orders by ID
    // (No authentication required - knowing the order ID is sufficient)
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
        { error: 'Objednávka nenájdená' },
        { status: 404 }
      )
    }

    return NextResponse.json(decimalToNumber(order))
  } catch (error) {
    console.error('Error fetching order:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa načítať objednávku' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // Require at least KITCHEN or ADMIN role to change order status
    const authResult = await requireRole(request, ['ADMIN', 'KITCHEN', 'COURIER', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const { id } = await params
    const body = await request.json()

    // Validate input
    const validation = validateBody(updateOrderStatusSchema, body)
    if ('error' in validation) {
      return validation.error
    }

    const data = validation.data

    // Verify order exists
    const existingOrder = await db.order.findUnique({ where: { id } })
    if (!existingOrder) {
      return NextResponse.json(
        { error: 'Objednávka nenájdená' },
        { status: 404 }
      )
    }

    // Validate status transition
    if (!isValidStatusTransition(existingOrder.status, data.status)) {
      return NextResponse.json(
        {
          error: `Zmena stavu z ${existingOrder.status} na ${data.status} nie je povolená`,
          currentStatus: existingOrder.status,
          allowedTransitions: getAllowedTransitions(existingOrder.status),
        },
        { status: 400 }
      )
    }

    // Build timestamp updates based on status
    const timestampUpdates: Record<string, Date> = {}
    const now = new Date()

    switch (data.status as OrderStatus) {
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
    const updatedOrder = await db.$transaction(async (tx) => {
      return tx.order.update({
        where: { id },
        data: {
          status: data.status as OrderStatus,
          ...timestampUpdates,
          statusHistory: {
            create: {
              status: data.status as OrderStatus,
              changedByUserId: data.changedByUserId || authResult.user.id,
              reason: data.reason || null,
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
    })

    return NextResponse.json(decimalToNumber(updatedOrder))
  } catch (error) {
    console.error('Error updating order:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa aktualizovať objednávku' },
      { status: 500 }
    )
  }
}

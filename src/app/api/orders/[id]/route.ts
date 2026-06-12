import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderStatus } from '@prisma/client'
import { decimalToNumber } from '@/lib/decimal-utils'
import { authenticateRequest, requireRole, isValidStatusTransition, getAllowedTransitions } from '@/lib/auth'
import { updateOrderStatusSchema, validateBody } from '@/lib/validations'

const STAFF_ROLES = ['ADMIN', 'KITCHEN', 'COURIER', 'OWNER']

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const authResult = await authenticateRequest(request)
    const canViewFullOrder =
      !('error' in authResult) && STAFF_ROLES.includes(authResult.user.role)

    if (canViewFullOrder) {
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
          { error: 'Objednavka nenajdena' },
          { status: 404 }
        )
      }

      return NextResponse.json(decimalToNumber(order))
    }

    const publicOrder = await db.order.findUnique({
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
      },
    })

    if (!publicOrder) {
      return NextResponse.json(
        { error: 'Objednavka nenajdena' },
        { status: 404 }
      )
    }

    return NextResponse.json(decimalToNumber(publicOrder))
  } catch (error) {
    console.error('Error fetching order:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa nacitat objednavku' },
      { status: 500 }
    )
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireRole(request, ['ADMIN', 'KITCHEN', 'COURIER', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const { id } = await params
    const body = await request.json()

    const validation = validateBody(updateOrderStatusSchema, body)
    if ('error' in validation) {
      return validation.error
    }

    const data = validation.data

    const existingOrder = await db.order.findUnique({ where: { id } })
    if (!existingOrder) {
      return NextResponse.json(
        { error: 'Objednavka nenajdena' },
        { status: 404 }
      )
    }

    if (!isValidStatusTransition(existingOrder.status, data.status)) {
      return NextResponse.json(
        {
          error: `Zmena stavu z ${existingOrder.status} na ${data.status} nie je povolena`,
          currentStatus: existingOrder.status,
          allowedTransitions: getAllowedTransitions(existingOrder.status),
        },
        { status: 400 }
      )
    }

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
      { error: 'Nepodarilo sa aktualizovat objednavku' },
      { status: 500 }
    )
  }
}

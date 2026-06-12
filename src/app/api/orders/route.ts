import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderStatus } from '@prisma/client'
import { decimalToNumber } from '@/lib/decimal-utils'
import { requireRole } from '@/lib/auth'
import { createOrderSchema, validateBody } from '@/lib/validations'
import crypto from 'crypto'

function createOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase()
  return `JAS-${timestamp}-${suffix}`
}

export async function GET(request: NextRequest) {
  try {
    // Staff-only endpoint for viewing order lists.
    const authResult = await requireRole(request, ['ADMIN', 'KITCHEN', 'COURIER', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    const where: Record<string, unknown> = {}
    if (status) {
      where.status = status as OrderStatus
    }

    const orders = await db.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
        statusHistory: {
          orderBy: { createdAt: 'asc' },
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
      },
    })

    return NextResponse.json(decimalToNumber(orders))
  } catch (error) {
    console.error('Error fetching orders:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa načítať objednávky' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    // Order creation is public (customers place orders)
    const body = await request.json()

    // Validate input
    const validation = validateBody(createOrderSchema, body)
    if ('error' in validation) {
      return validation.error
    }

    const data = validation.data

    // Look up all menu items for price calculation
    const menuItemIds = data.items.map((item) => item.menuItemId)
    const menuItems = await db.menuItem.findMany({
      where: { id: { in: menuItemIds } },
      include: {
        options: { where: { isActive: true } },
      },
    })

    // Build a map for quick lookup
    type MenuItemWithOptions = (typeof menuItems)[number]
    const menuItemMap = new Map<string, MenuItemWithOptions>(
      menuItems.map((mi) => [mi.id, mi])
    )

    // Calculate order items with server-side price calculation
    let subtotalAmount = 0
    const orderItemsData: Array<{
      menuItemId: string
      menuItemNameSnapshot: string
      quantity: number
      basePriceSnapshot: number
      unitTotalSnapshot: number
      lineTotal: number
      selectedSize: string | null
      selectedOptions: string | null
      kitchenNote: string | null
    }> = []

    for (const item of data.items) {
      const menuItem = menuItemMap.get(item.menuItemId)
      if (!menuItem) {
        return NextResponse.json(
          { error: `Položka menu nenájdená: ${item.menuItemId}` },
          { status: 400 }
        )
      }

      const basePrice = Number(menuItem.basePrice)
      let unitTotal = basePrice

      // Apply size price delta
      if (item.selectedSize) {
        const sizeOption = menuItem.options.find(
          (opt) =>
            opt.optionType === 'SIZE' &&
            opt.name === item.selectedSize
        )
        if (sizeOption) {
          unitTotal += Number(sizeOption.priceDelta)
        }
      }

      // Apply selected options price deltas
      const selectedOptionDeltas: Array<{ name: string; price: number }> = []
      if (item.selectedOptions && Array.isArray(item.selectedOptions)) {
        for (const optName of item.selectedOptions) {
          const option = menuItem.options.find(
            (opt) => opt.name === optName
          )
          if (option) {
            unitTotal += Number(option.priceDelta)
            selectedOptionDeltas.push({ name: option.name, price: Number(option.priceDelta) })
          }
        }
      }

      const lineTotal = unitTotal * item.quantity
      subtotalAmount += lineTotal

      orderItemsData.push({
        menuItemId: item.menuItemId,
        menuItemNameSnapshot: menuItem.name,
        quantity: item.quantity,
        basePriceSnapshot: basePrice,
        unitTotalSnapshot: unitTotal,
        lineTotal,
        selectedSize: item.selectedSize || null,
        selectedOptions:
          selectedOptionDeltas.length > 0
            ? JSON.stringify(selectedOptionDeltas)
            : null,
        kitchenNote: item.kitchenNote || null,
      })
    }

    // Get delivery fee from zone
    let deliveryFee = 0
    if (data.deliveryZoneId && data.orderType === 'DELIVERY') {
      const zone = await db.deliveryZone.findUnique({
        where: { id: data.deliveryZoneId },
      })
      if (zone) {
        deliveryFee = Number(zone.deliveryFee)
      }
    }

    const totalAmount = subtotalAmount + deliveryFee

    // Generate a collision-resistant public order number.
    const order = await db.$transaction(async (tx) => {
      const orderNumber = createOrderNumber()

      return tx.order.create({
        data: {
          orderNumber,
          customerName: data.customerName,
          customerPhone: data.customerPhone,
          customerEmail: data.customerEmail || null,
          orderType: data.orderType || 'DELIVERY',
          paymentMethod: data.paymentMethod || 'CASH',
          deliveryZoneId: data.deliveryZoneId || null,
          deliveryAddressLine1: data.deliveryAddressLine1 || null,
          deliveryCity: data.deliveryCity || null,
          deliveryNote: data.deliveryNote || null,
          kitchenNote: data.kitchenNote || null,
          subtotalAmount,
          deliveryFee,
          totalAmount,
          items: {
            create: orderItemsData,
          },
          statusHistory: {
            create: {
              status: 'NEW',
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

    return NextResponse.json(decimalToNumber(order), { status: 201 })
  } catch (error) {
    console.error('Error creating order:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa vytvoriť objednávku' },
      { status: 500 }
    )
  }
}

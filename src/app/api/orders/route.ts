import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderStatus } from '@prisma/client'
import { decimalToNumber } from '@/lib/decimal-utils'

export async function GET(request: NextRequest) {
  try {
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
      { error: 'Failed to fetch orders' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const {
      customerName,
      customerPhone,
      customerEmail,
      orderType,
      paymentMethod,
      deliveryZoneId,
      deliveryAddressLine1,
      deliveryCity,
      deliveryNote,
      kitchenNote,
      items,
    } = body

    // Validate required fields
    if (!customerName || !customerPhone || !items || items.length === 0) {
      return NextResponse.json(
        { error: 'Missing required fields: customerName, customerPhone, items' },
        { status: 400 }
      )
    }

    // Look up all menu items for price calculation
    const menuItemIds = items.map((item: { menuItemId: string }) => item.menuItemId)
    const menuItems = await db.menuItem.findMany({
      where: { id: { in: menuItemIds } },
      include: {
        options: { where: { isActive: true } },
      },
    })

    // Build a map for quick lookup
    const menuItemMap = new Map(menuItems.map((mi) => [mi.id, mi]))

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

    for (const item of items) {
      const menuItem = menuItemMap.get(item.menuItemId)
      if (!menuItem) {
        return NextResponse.json(
          { error: `Menu item not found: ${item.menuItemId}` },
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
    if (deliveryZoneId && orderType === 'DELIVERY') {
      const zone = await db.deliveryZone.findUnique({
        where: { id: deliveryZoneId },
      })
      if (zone) {
        deliveryFee = Number(zone.deliveryFee)
      }
    }

    const totalAmount = subtotalAmount + deliveryFee

    // Generate order number
    const lastOrder = await db.order.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { orderNumber: true },
    })

    let nextNumber = 1001
    if (lastOrder && lastOrder.orderNumber) {
      const match = lastOrder.orderNumber.match(/JAS-(\d+)/)
      if (match) {
        nextNumber = parseInt(match[1], 10) + 1
      }
    }
    const orderNumber = `JAS-${nextNumber}`

    // Create order with items and status history in a transaction
    const order = await db.order.create({
      data: {
        orderNumber,
        customerName,
        customerPhone,
        customerEmail: customerEmail || null,
        orderType: orderType || 'DELIVERY',
        paymentMethod: paymentMethod || 'CASH',
        deliveryZoneId: deliveryZoneId || null,
        deliveryAddressLine1: deliveryAddressLine1 || null,
        deliveryCity: deliveryCity || null,
        deliveryNote: deliveryNote || null,
        kitchenNote: kitchenNote || null,
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

    return NextResponse.json(decimalToNumber(order), { status: 201 })
  } catch (error) {
    console.error('Error creating order:', error)
    return NextResponse.json(
      { error: 'Failed to create order' },
      { status: 500 }
    )
  }
}

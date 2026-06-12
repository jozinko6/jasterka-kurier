import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderStatus } from '@prisma/client'
import { decimalToNumber } from '@/lib/decimal-utils'
import { requireRole } from '@/lib/auth'

const KITCHEN_STATUSES: OrderStatus[] = [
  'NEW',
  'ACCEPTED',
  'IN_KITCHEN',
  'PREPARING',
  'READY',
]

export async function GET(request: NextRequest) {
  try {
    // Only kitchen staff and admins can view kitchen orders
    const authResult = await requireRole(request, ['ADMIN', 'KITCHEN', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const orders = await db.order.findMany({
      where: {
        status: { in: KITCHEN_STATUSES },
      },
      orderBy: { createdAt: 'asc' },
      include: {
        items: true,
        statusHistory: {
          orderBy: { createdAt: 'asc' },
        },
        deliveryZone: true,
      },
    })

    return NextResponse.json(decimalToNumber(orders))
  } catch (error) {
    console.error('Error fetching kitchen orders:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa načítať objednávky kuchyne' },
      { status: 500 }
    )
  }
}

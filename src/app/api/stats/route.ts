import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decimalToNumber } from '@/lib/decimal-utils'
import { requireRole } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    // Only admins can view stats
    const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    // Get order counts by status
    const statusCounts = await db.order.groupBy({
      by: ['status'],
      _count: { status: true },
    })

    const countsByStatus: Record<string, number> = {}
    for (const item of statusCounts) {
      countsByStatus[item.status] = item._count.status
    }

    // Get today's date range
    const today = new Date()
    const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)

    // Today's revenue and order count
    const todaysOrders = await db.order.findMany({
      where: {
        createdAt: {
          gte: startOfDay,
          lt: endOfDay,
        },
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
      },
      select: { totalAmount: true },
    })

    const todaysRevenue = todaysOrders.reduce((sum, order) => sum + Number(order.totalAmount), 0)
    const todaysOrderCount = todaysOrders.length

    return NextResponse.json({
      orderCountsByStatus: countsByStatus,
      todaysRevenue,
      todaysOrderCount,
    })
  } catch (error) {
    console.error('Error fetching stats:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa načítať štatistiky' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
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

    const todaysRevenue = todaysOrders.reduce((sum, order) => sum + order.totalAmount, 0)
    const todaysOrderCount = todaysOrders.length

    return NextResponse.json({
      orderCountsByStatus: countsByStatus,
      todaysRevenue,
      todaysOrderCount,
    })
  } catch (error) {
    console.error('Error fetching stats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    )
  }
}

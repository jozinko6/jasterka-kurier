import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const courierId = searchParams.get('courierId')

    const where: Record<string, unknown> = {}
    if (courierId) {
      where.courierId = courierId
    }

    const earnings = await db.courierEarning.findMany({
      where,
      orderBy: { earningDate: 'desc' },
      include: {
        courier: {
          select: {
            id: true,
            displayName: true,
            phone: true,
          },
        },
        order: {
          select: {
            id: true,
            orderNumber: true,
          },
        },
        zone: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    })

    // If specific courier, also return summary
    if (courierId) {
      const summary = await db.courierEarning.aggregate({
        where: { courierId },
        _sum: {
          baseAmount: true,
          zoneBonusAmount: true,
          manualAdjustmentAmount: true,
          totalAmount: true,
        },
        _count: true,
      })

      return NextResponse.json({
        earnings,
        summary: {
          totalBaseAmount: summary._sum.baseAmount || 0,
          totalZoneBonus: summary._sum.zoneBonusAmount || 0,
          totalAdjustments: summary._sum.manualAdjustmentAmount || 0,
          totalEarnings: summary._sum.totalAmount || 0,
          deliveryCount: summary._count,
        },
      })
    }

    return NextResponse.json(earnings)
  } catch (error) {
    console.error('Error fetching courier earnings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch courier earnings' },
      { status: 500 }
    )
  }
}

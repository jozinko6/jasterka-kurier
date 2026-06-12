import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decimalToNumber } from '@/lib/decimal-utils'
import { requireRole } from '@/lib/auth'

export async function GET(request: NextRequest) {
  try {
    // Only couriers and admins can view earnings
    const authResult = await requireRole(request, ['ADMIN', 'COURIER', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

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
        earnings: decimalToNumber(earnings),
        summary: {
          totalBaseAmount: Number(summary._sum.baseAmount) || 0,
          totalZoneBonus: Number(summary._sum.zoneBonusAmount) || 0,
          totalAdjustments: Number(summary._sum.manualAdjustmentAmount) || 0,
          totalEarnings: Number(summary._sum.totalAmount) || 0,
          deliveryCount: summary._count,
        },
      })
    }

    return NextResponse.json(decimalToNumber(earnings))
  } catch (error) {
    console.error('Error fetching courier earnings:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa načítať zárobky kuriéra' },
      { status: 500 }
    )
  }
}

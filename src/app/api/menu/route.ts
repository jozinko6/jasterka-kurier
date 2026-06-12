import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decimalToNumber } from '@/lib/decimal-utils'

export async function GET(request: NextRequest) {
  try {
    const categories = await db.menuCategory.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      include: {
        menuItems: {
          where: { isActive: true },
          orderBy: { name: 'asc' },
          include: {
            options: {
              where: { isActive: true },
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    })

    return NextResponse.json(decimalToNumber(categories))
  } catch (error) {
    console.error('Error fetching menu:', error)
    return NextResponse.json(
      { error: 'Failed to fetch menu' },
      { status: 500 }
    )
  }
}

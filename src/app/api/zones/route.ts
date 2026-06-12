import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decimalToNumber } from '@/lib/decimal-utils'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const showAll = searchParams.get('all') === 'true'

    const zones = await db.deliveryZone.findMany({
      where: showAll ? {} : { isActive: true },
      orderBy: { priority: 'asc' },
    })

    return NextResponse.json(decimalToNumber(zones))
  } catch (error) {
    console.error('Error fetching delivery zones:', error)
    return NextResponse.json(
      { error: 'Failed to fetch delivery zones' },
      { status: 500 }
    )
  }
}

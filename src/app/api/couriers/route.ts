import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { CourierStatus } from '@prisma/client'

export async function GET(request: NextRequest) {
  try {
    const couriers = await db.courier.findMany({
      where: { isActive: true },
      include: {
        user: {
          select: { id: true, email: true, phone: true, role: true },
        },
      },
      orderBy: { displayName: 'asc' },
    })

    return NextResponse.json(couriers)
  } catch (error) {
    console.error('Error fetching couriers:', error)
    return NextResponse.json(
      { error: 'Failed to fetch couriers' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json()
    const { courierId, status } = body

    if (!courierId || !status) {
      return NextResponse.json(
        { error: 'Missing required fields: courierId, status' },
        { status: 400 }
      )
    }

    const courier = await db.courier.findUnique({
      where: { id: courierId },
    })

    if (!courier) {
      return NextResponse.json(
        { error: 'Courier not found' },
        { status: 404 }
      )
    }

    const updatedCourier = await db.courier.update({
      where: { id: courierId },
      data: { status: status as CourierStatus },
      include: {
        user: {
          select: { id: true, email: true, phone: true, role: true },
        },
      },
    })

    return NextResponse.json(updatedCourier)
  } catch (error) {
    console.error('Error updating courier status:', error)
    return NextResponse.json(
      { error: 'Failed to update courier status' },
      { status: 500 }
    )
  }
}

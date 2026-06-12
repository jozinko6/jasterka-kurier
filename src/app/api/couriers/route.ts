import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { CourierStatus } from '@prisma/client'
import { requireRole } from '@/lib/auth'
import { updateCourierStatusSchema, validateBody } from '@/lib/validations'

export async function GET(request: NextRequest) {
  try {
    // Couriers and admins can view courier list
    const authResult = await requireRole(request, ['ADMIN', 'COURIER', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

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
      { error: 'Nepodarilo sa načítať kuriérov' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    // Only admins can update courier status
    const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const body = await request.json()

    // Validate input
    const validation = validateBody(updateCourierStatusSchema, body)
    if ('error' in validation) {
      return validation.error
    }

    const data = validation.data

    const courier = await db.courier.findUnique({
      where: { id: data.courierId },
    })

    if (!courier) {
      return NextResponse.json(
        { error: 'Kuriér nenájdený' },
        { status: 404 }
      )
    }

    const updatedCourier = await db.courier.update({
      where: { id: data.courierId },
      data: { status: data.status as CourierStatus },
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
      { error: 'Nepodarilo sa aktualizovať stav kuriéra' },
      { status: 500 }
    )
  }
}

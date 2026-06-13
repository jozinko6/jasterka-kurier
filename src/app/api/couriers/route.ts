import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { db } from '@/lib/db'
import { CourierStatus, VehicleType } from '@prisma/client'
import { requireRole } from '@/lib/auth'
import {
  createCourierSchema,
  updateCourierSchema,
  updateCourierStatusSchema,
  validateBody,
} from '@/lib/validations'

const courierInclude = {
  user: {
    select: { id: true, email: true, phone: true, role: true, isActive: true },
  },
}

function cleanNullable(value: string | null | undefined) {
  const trimmed = typeof value === 'string' ? value.trim() : ''
  return trimmed.length > 0 ? trimmed : null
}

async function ensureUniqueLogin(email: string | null, phone: string | null, currentUserId?: string) {
  if (!email && !phone) {
    return NextResponse.json(
      { error: 'Vyplňte email alebo telefón pre prihlásenie kuriéra' },
      { status: 400 }
    )
  }

  const existing = await db.user.findFirst({
    where: {
      OR: [
        ...(email ? [{ email }] : []),
        ...(phone ? [{ phone }] : []),
      ],
      ...(currentUserId ? { NOT: { id: currentUserId } } : {}),
    },
  })

  if (existing) {
    return NextResponse.json(
      { error: 'Email alebo telefón už používa iný účet' },
      { status: 409 }
    )
  }

  return null
}

export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, ['ADMIN', 'COURIER', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const canManage = authResult.user.role === 'ADMIN' || authResult.user.role === 'OWNER'
    const couriers = await db.courier.findMany({
      where: canManage ? {} : { isActive: true },
      include: courierInclude,
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

export async function POST(request: NextRequest) {
  try {
    const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const validation = validateBody(createCourierSchema, await request.json())
    if ('error' in validation) {
      return validation.error
    }

    const data = validation.data
    const email = cleanNullable(data.email)?.toLowerCase() ?? null
    const phone = cleanNullable(data.phone)
    const uniqueError = await ensureUniqueLogin(email, phone)
    if (uniqueError) return uniqueError

    const isActive = data.isActive ?? false
    const passwordHash = await bcrypt.hash(data.password, 10)
    const courier = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          email,
          phone,
          passwordHash,
          role: 'COURIER',
          isActive,
        },
      })

      return tx.courier.create({
        data: {
          userId: user.id,
          displayName: data.displayName.trim(),
          phone,
          vehicleType: (data.vehicleType ?? 'CAR') as VehicleType,
          status: isActive ? ((data.status ?? 'AVAILABLE') as CourierStatus) : 'OFFLINE',
          isActive,
        },
        include: courierInclude,
      })
    })

    return NextResponse.json(courier, { status: 201 })
  } catch (error) {
    console.error('Error creating courier:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa vytvoriť kuriéra' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const validation = validateBody(updateCourierSchema, await request.json())
    if ('error' in validation) {
      return validation.error
    }

    const data = validation.data
    const courier = await db.courier.findUnique({
      where: { id: data.courierId },
      include: { user: true },
    })

    if (!courier) {
      return NextResponse.json(
        { error: 'Kuriér nenájdený' },
        { status: 404 }
      )
    }

    const email = data.email !== undefined ? cleanNullable(data.email)?.toLowerCase() ?? null : courier.user.email
    const phone = data.phone !== undefined ? cleanNullable(data.phone) : courier.user.phone
    const uniqueError = await ensureUniqueLogin(email, phone, courier.userId)
    if (uniqueError) return uniqueError

    const userUpdate: Record<string, unknown> = {}
    if (data.email !== undefined) userUpdate.email = email
    if (data.phone !== undefined) userUpdate.phone = phone
    if (data.password && data.password.length > 0) {
      userUpdate.passwordHash = await bcrypt.hash(data.password, 10)
    }
    if (data.isActive !== undefined) userUpdate.isActive = data.isActive

    const courierUpdate: Record<string, unknown> = {}
    if (data.displayName !== undefined) courierUpdate.displayName = data.displayName.trim()
    if (data.phone !== undefined) courierUpdate.phone = phone
    if (data.vehicleType !== undefined) courierUpdate.vehicleType = data.vehicleType as VehicleType
    if (data.status !== undefined) courierUpdate.status = data.status as CourierStatus
    if (data.isActive !== undefined) {
      courierUpdate.isActive = data.isActive
      if (!data.isActive) courierUpdate.status = 'OFFLINE'
      if (data.isActive && courier.status === 'OFFLINE' && !data.status) courierUpdate.status = 'AVAILABLE'
    }

    const updatedCourier = await db.$transaction(async (tx) => {
      if (Object.keys(userUpdate).length > 0) {
        await tx.user.update({
          where: { id: courier.userId },
          data: userUpdate,
        })
      }

      return tx.courier.update({
        where: { id: data.courierId },
        data: courierUpdate,
        include: courierInclude,
      })
    })

    return NextResponse.json(updatedCourier)
  } catch (error) {
    console.error('Error updating courier:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa upraviť kuriéra' },
      { status: 500 }
    )
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const validation = validateBody(updateCourierStatusSchema, await request.json())
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
      include: courierInclude,
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

export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const { courierId } = await request.json()
    if (!courierId || typeof courierId !== 'string') {
      return NextResponse.json(
        { error: 'ID kuriéra je povinné' },
        { status: 400 }
      )
    }

    const courier = await db.courier.findUnique({ where: { id: courierId } })
    if (!courier) {
      return NextResponse.json(
        { error: 'Kuriér nenájdený' },
        { status: 404 }
      )
    }

    const updatedCourier = await db.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: courier.userId },
        data: { isActive: false },
      })

      return tx.courier.update({
        where: { id: courierId },
        data: { isActive: false, status: 'OFFLINE' },
        include: courierInclude,
      })
    })

    return NextResponse.json(updatedCourier)
  } catch (error) {
    console.error('Error deleting courier:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa odobrať kuriéra' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { updateOpeningHoursSchema, validateBody } from '@/lib/validations'

export async function GET(request: NextRequest) {
  try {
    // Opening hours are public
    const openingHours = await db.openingHours.findMany({
      orderBy: { dayOfWeek: 'asc' },
    })

    return NextResponse.json(openingHours)
  } catch (error) {
    console.error('Error fetching opening hours:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa načítať otváracie hodiny' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Only admins can update opening hours
    const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const body = await request.json()

    // Validate input
    const validation = validateBody(updateOpeningHoursSchema, body)
    if ('error' in validation) {
      return validation.error
    }

    const data = validation.data

    const results: Record<string, unknown>[] = []

    for (const item of data) {
      const { dayOfWeek, openTime, closeTime, isClosed } = item

      // Upsert by dayOfWeek (unique constraint)
      const result = await db.openingHours.upsert({
        where: { dayOfWeek },
        update: {
          openTime: openTime ?? null,
          closeTime: closeTime ?? null,
          isClosed: isClosed ?? false,
        },
        create: {
          dayOfWeek,
          openTime: openTime ?? null,
          closeTime: closeTime ?? null,
          isClosed: isClosed ?? false,
        },
      })

      results.push(result)
    }

    return NextResponse.json(results)
  } catch (error) {
    console.error('Error updating opening hours:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa aktualizovať otváracie hodiny' },
      { status: 500 }
    )
  }
}

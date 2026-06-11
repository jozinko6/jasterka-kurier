import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const openingHours = await db.openingHours.findMany({
      orderBy: { dayOfWeek: 'asc' },
    })

    return NextResponse.json(openingHours)
  } catch (error) {
    console.error('Error fetching opening hours:', error)
    return NextResponse.json(
      { error: 'Failed to fetch opening hours' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()

    if (!Array.isArray(body)) {
      return NextResponse.json(
        { error: 'Request body must be an array of opening hours' },
        { status: 400 }
      )
    }

    const results = []

    for (const item of body) {
      const { dayOfWeek, openTime, closeTime, isClosed } = item

      if (dayOfWeek === undefined || dayOfWeek === null) {
        continue
      }

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
      { error: 'Failed to update opening hours' },
      { status: 500 }
    )
  }
}

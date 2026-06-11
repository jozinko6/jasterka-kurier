import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const settings = await db.restaurantSettings.findFirst()

    if (!settings) {
      // Create default settings if none exist
      const defaultSettings = await db.restaurantSettings.create({
        data: {
          deliveryEnabled: true,
          pickupEnabled: true,
          isOpen: true,
          averagePrepMinutes: 30,
          minimumOrderAmount: 0,
        },
      })
      return NextResponse.json(defaultSettings)
    }

    return NextResponse.json(settings)
  } catch (error) {
    console.error('Error fetching settings:', error)
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()

    // Get existing settings
    const existing = await db.restaurantSettings.findFirst()

    if (!existing) {
      // Create if none exist
      const settings = await db.restaurantSettings.create({
        data: {
          deliveryEnabled: body.deliveryEnabled ?? true,
          pickupEnabled: body.pickupEnabled ?? true,
          isOpen: body.isOpen ?? true,
          customerMessage: body.customerMessage || null,
          averagePrepMinutes: body.averagePrepMinutes ?? 30,
          minimumOrderAmount: body.minimumOrderAmount ?? 0,
          storePhone: body.storePhone || null,
          storeAddress: body.storeAddress || null,
        },
      })
      return NextResponse.json(settings)
    }

    // Update existing settings
    const updateData: Record<string, unknown> = {}
    const allowedFields = [
      'deliveryEnabled',
      'pickupEnabled',
      'isOpen',
      'customerMessage',
      'averagePrepMinutes',
      'minimumOrderAmount',
      'storePhone',
      'storeAddress',
    ]

    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field]
      }
    }

    const updatedSettings = await db.restaurantSettings.update({
      where: { id: existing.id },
      data: updateData,
    })

    return NextResponse.json(updatedSettings)
  } catch (error) {
    console.error('Error updating settings:', error)
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    )
  }
}

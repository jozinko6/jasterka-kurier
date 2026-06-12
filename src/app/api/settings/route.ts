import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { decimalToNumber } from '@/lib/decimal-utils'
import { requireRole } from '@/lib/auth'
import { updateSettingsSchema, validateBody } from '@/lib/validations'

export async function GET(request: NextRequest) {
  try {
    // Settings are public (customers need to know if restaurant is open)
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
      return NextResponse.json(decimalToNumber(defaultSettings))
    }

    return NextResponse.json(decimalToNumber(settings))
  } catch (error) {
    console.error('Error fetching settings:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa načítať nastavenia' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    // Only admins can update settings
    const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
    if ('error' in authResult) {
      return authResult.error
    }

    const body = await request.json()

    // Validate input
    const validation = validateBody(updateSettingsSchema, body)
    if ('error' in validation) {
      return validation.error
    }

    const data = validation.data

    // Get existing settings
    const existing = await db.restaurantSettings.findFirst()

    if (!existing) {
      // Create if none exist
      const settings = await db.restaurantSettings.create({
        data: {
          deliveryEnabled: data.deliveryEnabled ?? true,
          pickupEnabled: data.pickupEnabled ?? true,
          isOpen: data.isOpen ?? true,
          customerMessage: data.customerMessage || null,
          averagePrepMinutes: data.averagePrepMinutes ?? 30,
          minimumOrderAmount: data.minimumOrderAmount ?? 0,
          storePhone: data.storePhone || null,
          storeAddress: data.storeAddress || null,
        },
      })
      return NextResponse.json(decimalToNumber(settings))
    }

    // Update existing settings
    const updateData: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(data)) {
      if (value !== undefined) {
        if (key === 'minimumOrderAmount') {
          updateData[key] = value
        } else {
          updateData[key] = value
        }
      }
    }

    const updatedSettings = await db.restaurantSettings.update({
      where: { id: existing.id },
      data: updateData,
    })

    return NextResponse.json(decimalToNumber(updatedSettings))
  } catch (error) {
    console.error('Error updating settings:', error)
    return NextResponse.json(
      { error: 'Nepodarilo sa aktualizovať nastavenia' },
      { status: 500 }
    )
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { updateSettingsSchema, validateBody } from '@/lib/validations'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { SETTINGS_SINGLETON_ID } from '@/lib/settings-singleton'

/**
 * GET /api/settings
 *
 * Returns the restaurant settings singleton (id = 'main').
 * NEVER creates the settings in GET — that's a write operation.
 * If settings don't exist, returns 404 with a hint to run the seed/bootstrap.
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const settings = await db.restaurantSettings.findUnique({
    where: { id: SETTINGS_SINGLETON_ID },
  })

  if (!settings) {
    // Don't auto-create — return a safe default shape so the UI can render,
    // but signal that admin must run the bootstrap.
    return NextResponse.json({
      id: null,
      deliveryEnabled: false,
      pickupEnabled: false,
      isOpen: false,
      customerMessage: 'Reštaurácia nie je nastavená. Kontaktujte administrátora.',
      averagePrepMinutes: 30,
      minimumOrderAmount: 0,
      storePhone: null,
      storeAddress: null,
      needsBootstrap: true,
    }, {
      headers: { 'Cache-Control': 'public, max-age=60' },
    })
  }

  return NextResponse.json(settings, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  })
})

/**
 * PUT /api/settings
 *
 * Updates the restaurant settings singleton. Creates it if it doesn't exist
 * (only admin can do this — effectively a bootstrap).
 */
export const PUT = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
  if ('error' in authResult) return authResult.error

  const body = await request.json()
  const validation = validateBody(updateSettingsSchema, body)
  if ('error' in validation) return validation.error

  const data = validation.data

  // Upsert to the singleton id
  const updateData: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      updateData[key] = value
    }
  }

  const settings = await db.restaurantSettings.upsert({
    where: { id: SETTINGS_SINGLETON_ID },
    update: updateData,
    create: {
      id: SETTINGS_SINGLETON_ID,
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

  return NextResponse.json(settings, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

import { z } from 'zod/v4'

// ─── Auth Schemas ───

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Prihlasovacie meno je povinné').max(200, 'Príliš dlhé'),
  password: z.string().min(1, 'Heslo je povinné').max(1000, 'Príliš dlhé'),
})

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Aktuálne heslo je povinné').max(1000),
  newPassword: z.string().min(8, 'Nové heslo musí mať aspoň 8 znakov').max(1000),
})

// ─── Phone normalization ───

const PHONE_STRIP = /[\s\-()/]/g
export function normalizePhone(phone: string): string {
  const stripped = phone.replace(PHONE_STRIP, '')
  // If starts with 00, replace with +
  if (stripped.startsWith('00')) return '+' + stripped.slice(2)
  // If starts with 0 and not 00, assume SK local → +421
  if (stripped.startsWith('0') && !stripped.startsWith('00')) return '+421' + stripped.slice(1)
  return stripped
}

const phoneSchema = z
  .string()
  .transform(normalizePhone)
  .refine((v) => /^\+\d{6,15}$/.test(v), 'Neplatný telefón (očakávaný formát +421...)')

// ─── URL validation for imageUrl/profilePhotoUrl ───

const urlSchema = z
  .string()
  .url('Neplatná URL')
  .max(2000, 'Príliš dlhá URL')
  .refine(
    (v) => v.startsWith('https://') || v.startsWith('http://localhost'),
    'URL musí byť HTTPS (alebo localhost pre vývoj)'
  )
  .nullable()
  .optional()

// ─── HH:mm validation for opening hours ───

const hhMmSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Čas musí byť vo formáte HH:mm')
  .nullable()
  .optional()

// ─── Order Schemas ───

const MAX_QUANTITY = 50

const orderItemSchema = z.object({
  menuItemId: z.string().min(1, 'ID položky menu je povinné').max(100),
  quantity: z.number().int().min(1, 'Množstvo musí byť aspoň 1').max(MAX_QUANTITY, `Maximálne ${MAX_QUANTITY} ks`),
  selectedSize: z.string().max(100).nullable().optional(),
  selectedOptions: z.array(z.string().max(100)).max(50, 'Príliš veľa volieb').nullable().optional(),
  kitchenNote: z.string().trim().max(500, 'Poznámka je príliš dlhá').nullable().optional(),
})

// Base fields shared by DELIVERY and PICKUP
const orderBase = {
  customerName: z.string().trim().min(1, 'Meno je povinné').max(100, 'Meno je príliš dlhé'),
  customerPhone: phoneSchema,
  customerEmail: z.string().trim().toLowerCase().email('Neplatný email').max(200).optional().or(z.literal('')),
  paymentMethod: z.enum(['CASH', 'CARD_ON_DELIVERY', 'CARD_ON_PICKUP']),
  kitchenNote: z.string().trim().max(500, 'Poznámka je príliš dlhá').optional(),
  items: z.array(orderItemSchema).min(1, 'Objednávka musí obsahovať aspoň jednu položku').max(50, 'Príliš veľa položiek'),
}

// Discriminated union by orderType
// DELIVERY requires zone + address; PICKUP must NOT include delivery fields.
// SCHEDULED_* removed: not implemented end-to-end.
export const createOrderSchema = z.discriminatedUnion('orderType', [
  z.object({
    ...orderBase,
    orderType: z.literal('DELIVERY'),
    deliveryZoneId: z.string().min(1, 'Zóna doručenia je povinná').max(100),
    deliveryAddressLine1: z.string().trim().min(1, 'Adresa je povinná').max(200, 'Adresa je príliš dlhá'),
    deliveryCity: z.string().trim().min(1, 'Mesto je povinné').max(100, 'Mesto je príliš dlhé'),
    deliveryNote: z.string().trim().max(500, 'Poznámka je príliš dlhá').optional(),
  }),
  z.object({
    ...orderBase,
    orderType: z.literal('PICKUP'),
    // PICKUP must NOT include delivery fields — reject them explicitly
    deliveryZoneId: z.undefined().optional(),
    deliveryAddressLine1: z.undefined().optional(),
    deliveryCity: z.undefined().optional(),
    deliveryNote: z.undefined().optional(),
  }),
])

// ─── Order status update ───
// NOTE: changedByUserId is INTENTIONALLY REMOVED — actor identity always comes
// from the session (authResult.user.id). See P0-4 audit spoofing fix.
export const updateOrderStatusSchema = z.object({
  status: z.enum([
    'NEW', 'ACCEPTED', 'IN_KITCHEN', 'PREPARING', 'READY',
    'WAITING_FOR_COURIER', 'ASSIGNED_TO_COURIER', 'PICKED_UP',
    'ON_THE_WAY', 'DELIVERED', 'CANCELLED', 'REFUNDED',
  ], { error: 'Neplatný stav' }),
  reason: z.string().trim().max(500, 'Dôvod je príliš dlhý').optional(),
  // Optimistic concurrency: client sends the status it believes is current.
  expectedStatus: z.enum([
    'NEW', 'ACCEPTED', 'IN_KITCHEN', 'PREPARING', 'READY',
    'WAITING_FOR_COURIER', 'ASSIGNED_TO_COURIER', 'PICKED_UP',
    'ON_THE_WAY', 'DELIVERED', 'CANCELLED', 'REFUNDED',
  ]).optional(),
})

// ─── Dispatch Schema ───
// NOTE: assignedByUserId is INTENTIONALLY REMOVED — actor identity always comes
// from the session (authResult.user.id). See P0-4 audit spoofing fix.
export const dispatchSchema = z.object({
  orderId: z.string().min(1, 'ID objednávky je povinné').max(100),
  courierId: z.string().min(1, 'ID kuriéra je povinné').max(100),
})

// ─── Courier Schemas ───

export const updateCourierStatusSchema = z.object({
  courierId: z.string().min(1, 'ID kuriéra je povinné').max(100),
  status: z.enum(['OFFLINE', 'AVAILABLE', 'ASSIGNED', 'PICKING_UP', 'DELIVERING', 'BREAK'], {
    error: 'Neplatný stav kuriéra',
  }),
})

export const createCourierSchema = z.object({
  displayName: z.string().trim().min(1, 'Meno kuriéra je povinné').max(100),
  email: z.string().trim().toLowerCase().email('Neplatný email').max(200).nullable().or(z.literal('')),
  phone: phoneSchema.nullable().optional(),
  password: z.string().min(8, 'Heslo musí mať aspoň 8 znakov').max(1000),
  vehicleType: z.enum(['BICYCLE', 'SCOOTER', 'CAR']).optional(),
  profilePhotoUrl: urlSchema,
  licensePlate: z.string().trim().max(50).nullable().optional(),
  status: z.enum(['OFFLINE', 'AVAILABLE', 'ASSIGNED', 'PICKING_UP', 'DELIVERING', 'BREAK']).optional(),
  isActive: z.boolean().optional(),
})

export const updateCourierSchema = z.object({
  courierId: z.string().min(1, 'ID kuriéra je povinné').max(100),
  displayName: z.string().trim().min(1, 'Meno kuriéra je povinné').max(100).optional(),
  email: z.string().trim().toLowerCase().email('Neplatný email').max(200).nullable().or(z.literal('')).optional(),
  phone: z.string().transform(normalizePhone).nullable().optional(),
  // Password change requires currentPassword when changing own password
  currentPassword: z.string().max(1000).optional(),
  password: z.string().min(8, 'Heslo musí mať aspoň 8 znakov').max(1000).optional().or(z.literal('')),
  vehicleType: z.enum(['BICYCLE', 'SCOOTER', 'CAR']).optional(),
  profilePhotoUrl: urlSchema,
  licensePlate: z.string().trim().max(50).nullable().optional(),
  status: z.enum(['OFFLINE', 'AVAILABLE', 'ASSIGNED', 'PICKING_UP', 'DELIVERING', 'BREAK']).optional(),
  isActive: z.boolean().optional(),
})

// ─── Menu / Category Schemas ───

export const createCategorySchema = z.object({
  slug: z.string().trim().min(1, 'Slug je povinný').max(100),
  name: z.string().trim().min(1, 'Názov je povinný').max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  sortOrder: z.number().int().min(0).max(10000).optional(),
  isActive: z.boolean().optional(),
  isDailyMenu: z.boolean().optional(),
  imageUrl: urlSchema,
})

export const createMenuItemSchema = z.object({
  categoryId: z.string().min(1, 'ID kategórie je povinné').max(100),
  slug: z.string().trim().min(1, 'Slug je povinný').max(100),
  name: z.string().trim().min(1, 'Názov je povinný').max(200),
  description: z.string().trim().max(1000).nullable().optional(),
  basePrice: z.number().min(0, 'Cena musí byť nezáporná').max(10000, 'Príliš vysoká cena'),
  imageUrl: urlSchema,
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  preparationTimeMinutes: z.number().int().min(0).max(600).nullable().optional(),
})

export const updateMenuItemSchema = z.object({
  id: z.string().min(1, 'ID je povinné').max(100),
  categoryId: z.string().max(100).optional(),
  slug: z.string().trim().max(100).optional(),
  name: z.string().trim().max(200).optional(),
  description: z.string().trim().max(1000).nullable().optional(),
  basePrice: z.number().min(0, 'Cena musí byť nezáporná').max(10000).optional(),
  imageUrl: urlSchema,
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  preparationTimeMinutes: z.number().int().min(0).max(600).nullable().optional(),
})

// ─── Settings Schema ───

export const updateSettingsSchema = z.object({
  deliveryEnabled: z.boolean().optional(),
  pickupEnabled: z.boolean().optional(),
  isOpen: z.boolean().optional(),
  customerMessage: z.string().trim().max(1000).nullable().optional(),
  averagePrepMinutes: z.number().int().min(1).max(600).optional(),
  minimumOrderAmount: z.number().min(0).max(10000).optional(),
  storePhone: z.string().trim().max(50).nullable().optional(),
  storeAddress: z.string().trim().max(500).nullable().optional(),
})

// ─── Opening Hours Schema ───

export const openingHoursItemSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openTime: hhMmSchema,
  closeTime: hhMmSchema,
  isClosed: z.boolean().optional(),
}).refine(
  (data) => {
    // If closed, times can be null
    if (data.isClosed) return true
    // If not closed, both times must be present
    if (!data.openTime || !data.closeTime) return false
    // openTime < closeTime OR closeTime < openTime (overnight interval)
    // Both are valid; we just need them to be different
    return data.openTime !== data.closeTime
  },
  { message: 'Časy otvorenia a zatvorenia musia byť rôzne (alebo označte ako zatvorené).' }
)

export const updateOpeningHoursSchema = z.array(openingHoursItemSchema)

// ─── Kitchen estimate schemas ───

export const kitchenEstimateSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('MINUTES'),
    minutes: z
      .number()
      .int('Počet minút musí byť celé číslo')
      .min(5, 'Minimálny čas prípravy je 5 minút')
      .max(180, 'Maximálny čas prípravy je 180 minút'),
    source: z
      .enum(['KITCHEN_MANUAL', 'KITCHEN_QUICK_PRESET', 'SYSTEM_DEFAULT'])
      .optional(),
    reason: z.string().trim().max(500).optional(),
    expectedVersion: z.number().int().min(0).optional(),
  }),
  z.object({
    mode: z.literal('EXACT_TIME'),
    exactTime: z.string().min(1, 'Chýba presný čas'),
    source: z
      .enum(['KITCHEN_MANUAL', 'KITCHEN_QUICK_PRESET', 'SYSTEM_DEFAULT'])
      .optional(),
    reason: z.string().trim().max(500).optional(),
    expectedVersion: z.number().int().min(0).optional(),
  }),
  z.object({
    mode: z.literal('DELAY'),
    additionalMinutes: z
      .number()
      .int('Počet minút musí byť celé číslo')
      .min(1, 'Oneskorenie musí byť aspoň 1 minúta')
      .max(180, 'Oneskorenie môže byť najviac 180 minút'),
    delayReason: z.enum(
      [
        'HIGH_DEMAND',
        'COMPLEX_ORDER',
        'INGREDIENT_DELAY',
        'COURIER_DELAY',
        'TRAFFIC',
        'OTHER',
      ],
      { error: 'Neplatný dôvod oneskorenia' }
    ),
    reason: z.string().trim().max(500).optional(),
    expectedVersion: z.number().int().min(0).optional(),
  }),
])

export const kitchenAcceptSchema = z.object({
  prepMinutes: z
    .number()
    .int('Počet minút musí byť celé číslo')
    .min(5, 'Minimálny čas prípravy je 5 minút')
    .max(180, 'Maximálny čas prípravy je 180 minút'),
  source: z
    .enum(['KITCHEN_MANUAL', 'KITCHEN_QUICK_PRESET', 'SYSTEM_DEFAULT'])
    .optional(),
  reason: z.string().trim().max(500).optional(),
  expectedStatus: z.enum(['NEW']).optional(),
  expectedEstimateVersion: z.number().int().min(0).optional(),
})

// ─── Helper ───

import { NextResponse } from 'next/server'
import { ZodError } from 'zod/v4'

export function validateBody<T>(schema: z.ZodType<T>, data: unknown): { data: T } | { error: NextResponse } {
  try {
    const parsed = schema.parse(data)
    return { data: parsed }
  } catch (err) {
    if (err instanceof ZodError) {
      const firstError = err.issues[0]
      return {
        error: NextResponse.json(
          {
            code: 'INVALID_REQUEST',
            message: firstError?.message || 'Neplatné údaje',
            details: { issues: err.issues.map((i) => ({ path: i.path, message: i.message })) },
          },
          { status: 400, headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
        ),
      }
    }
    return {
      error: NextResponse.json(
        { code: 'INVALID_REQUEST', message: 'Neplatné údaje' },
        { status: 400, headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
      ),
    }
  }
}

import { z } from 'zod/v4'

// ─── Auth Schemas ───

export const loginSchema = z.object({
  email: z.email('Neplatný email'),
  password: z.string().min(1, 'Heslo je povinné'),
})

// ─── Order Schemas ───

export const createOrderSchema = z.object({
  customerName: z.string().min(1, 'Meno je povinné'),
  customerPhone: z.string().min(1, 'Telefón je povinný'),
  customerEmail: z.email('Neplatný email').optional().or(z.literal('')),
  orderType: z.enum(['DELIVERY', 'PICKUP', 'SCHEDULED_DELIVERY', 'SCHEDULED_PICKUP']).optional(),
  paymentMethod: z.enum(['CASH', 'CARD_ON_DELIVERY', 'CARD_ON_PICKUP', 'ONLINE_CARD']).optional(),
  deliveryZoneId: z.string().optional(),
  deliveryAddressLine1: z.string().optional(),
  deliveryCity: z.string().optional(),
  deliveryNote: z.string().optional(),
  kitchenNote: z.string().optional(),
  items: z.array(z.object({
    menuItemId: z.string().min(1, 'ID položky menu je povinné'),
    quantity: z.number().int().min(1, 'Množstvo musí byť aspoň 1'),
    selectedSize: z.string().optional().nullable(),
    selectedOptions: z.array(z.string()).optional().nullable(),
    kitchenNote: z.string().optional().nullable(),
  })).min(1, 'Objednávka musí obsahovať aspoň jednu položku'),
})

export const updateOrderStatusSchema = z.object({
  status: z.enum([
    'NEW', 'ACCEPTED', 'IN_KITCHEN', 'PREPARING', 'READY',
    'WAITING_FOR_COURIER', 'ASSIGNED_TO_COURIER', 'PICKED_UP',
    'ON_THE_WAY', 'DELIVERED', 'CANCELLED', 'REFUNDED',
  ], { error: 'Neplatný stav' }),
  changedByUserId: z.string().optional(),
  reason: z.string().optional(),
})

// ─── Dispatch Schema ───

export const dispatchSchema = z.object({
  orderId: z.string().min(1, 'ID objednávky je povinné'),
  courierId: z.string().min(1, 'ID kuriéra je povinné'),
  assignedByUserId: z.string().optional(),
})

// ─── Courier Schemas ───

export const updateCourierStatusSchema = z.object({
  courierId: z.string().min(1, 'ID kuriéra je povinné'),
  status: z.enum(['OFFLINE', 'AVAILABLE', 'ASSIGNED', 'PICKING_UP', 'DELIVERING', 'BREAK'], {
    error: 'Neplatný stav kuriéra',
  }),
})

export const createCourierSchema = z.object({
  displayName: z.string().min(1, 'Meno kuriéra je povinné'),
  email: z.email('Neplatný email').optional().nullable().or(z.literal('')),
  phone: z.string().optional().nullable(),
  password: z.string().min(6, 'Heslo musí mať aspoň 6 znakov'),
  vehicleType: z.enum(['BICYCLE', 'SCOOTER', 'CAR']).optional(),
  profilePhotoUrl: z.string().optional().nullable(),
  licensePlate: z.string().optional().nullable(),
  status: z.enum(['OFFLINE', 'AVAILABLE', 'ASSIGNED', 'PICKING_UP', 'DELIVERING', 'BREAK']).optional(),
  isActive: z.boolean().optional(),
})

export const updateCourierSchema = z.object({
  courierId: z.string().min(1, 'ID kuriéra je povinné'),
  displayName: z.string().min(1, 'Meno kuriéra je povinné').optional(),
  email: z.email('Neplatný email').optional().nullable().or(z.literal('')),
  phone: z.string().optional().nullable(),
  password: z.string().min(6, 'Heslo musí mať aspoň 6 znakov').optional().or(z.literal('')),
  vehicleType: z.enum(['BICYCLE', 'SCOOTER', 'CAR']).optional(),
  profilePhotoUrl: z.string().optional().nullable(),
  licensePlate: z.string().optional().nullable(),
  status: z.enum(['OFFLINE', 'AVAILABLE', 'ASSIGNED', 'PICKING_UP', 'DELIVERING', 'BREAK']).optional(),
  isActive: z.boolean().optional(),
})

// ─── Menu / Category Schemas ───

export const createCategorySchema = z.object({
  slug: z.string().min(1, 'Slug je povinný'),
  name: z.string().min(1, 'Názov je povinný'),
  description: z.string().optional().nullable(),
  sortOrder: z.number().int().optional(),
  isActive: z.boolean().optional(),
  isDailyMenu: z.boolean().optional(),
  imageUrl: z.string().optional().nullable(),
})

export const createMenuItemSchema = z.object({
  categoryId: z.string().min(1, 'ID kategórie je povinné'),
  slug: z.string().min(1, 'Slug je povinný'),
  name: z.string().min(1, 'Názov je povinný'),
  description: z.string().optional().nullable(),
  basePrice: z.number().min(0, 'Cena musí byť nezáporná'),
  imageUrl: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  preparationTimeMinutes: z.number().int().min(0).optional().nullable(),
})

export const updateMenuItemSchema = z.object({
  id: z.string().min(1, 'ID je povinné'),
  categoryId: z.string().optional(),
  slug: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional().nullable(),
  basePrice: z.number().min(0, 'Cena musí byť nezáporná').optional(),
  imageUrl: z.string().optional().nullable(),
  isActive: z.boolean().optional(),
  isFeatured: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  preparationTimeMinutes: z.number().int().min(0).optional().nullable(),
})

// ─── Settings Schema ───

export const updateSettingsSchema = z.object({
  deliveryEnabled: z.boolean().optional(),
  pickupEnabled: z.boolean().optional(),
  isOpen: z.boolean().optional(),
  customerMessage: z.string().optional().nullable(),
  averagePrepMinutes: z.number().int().min(1).optional(),
  minimumOrderAmount: z.number().min(0).optional(),
  storePhone: z.string().optional().nullable(),
  storeAddress: z.string().optional().nullable(),
})

// ─── Opening Hours Schema ───

export const openingHoursItemSchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  openTime: z.string().optional().nullable(),
  closeTime: z.string().optional().nullable(),
  isClosed: z.boolean().optional(),
})

export const updateOpeningHoursSchema = z.array(openingHoursItemSchema)

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
          { error: firstError?.message || 'Neplatné údaje', details: err.issues.map(i => i.message) },
          { status: 400 }
        ),
      }
    }
    return {
      error: NextResponse.json(
        { error: 'Neplatné údaje' },
        { status: 400 }
      ),
    }
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { OrderStatus } from '@prisma/client'
import { requireRole, authenticateRequest } from '@/lib/auth'
import { createOrderSchema, validateBody } from '@/lib/validations'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { getRestaurantAvailability, isValidPaymentForOrderType } from '@/lib/restaurant-availability'
import { toBratislava } from '@/lib/timezone'
import crypto from 'crypto'

function createOrderNumber(): string {
  const timestamp = Date.now().toString(36).toUpperCase()
  const suffix = crypto.randomBytes(2).toString('hex').toUpperCase()
  return `JAS-${timestamp}-${suffix}`
}

/**
 * Generate a cryptographically random tracking token (32 bytes).
 * Returns the raw token; the caller stores only its SHA-256 hash.
 */
function generateTrackingToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

function hashTrackingToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

const MAX_ITEM_QUANTITY = 50

/**
 * GET /api/orders
 * Staff-only endpoint for viewing order lists.
 * - ADMIN/OWNER/KITCHEN: see all orders (kitchen sees kitchen-scoped fields)
 * - COURIER: see only orders with their own active assignment
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRole(request, ['ADMIN', 'KITCHEN', 'COURIER', 'OWNER'])
  if ('error' in authResult) return authResult.error

  const { searchParams } = new URL(request.url)
  const status = searchParams.get('status')
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '50', 10) || 50, 100)
  const cursor = searchParams.get('cursor')

  const where: Record<string, unknown> = {}
  if (status) {
    where.status = status as OrderStatus
  }

  // Resource-level filter: couriers only see their own assigned orders
  if (authResult.user.role === 'COURIER') {
    const courier = await db.courier.findUnique({
      where: { userId: authResult.user.id },
      select: { id: true },
    })
    if (!courier) return NextResponse.json([])
    where.assignments = { some: { courierId: courier.id } }
  }

  const orders = await db.order.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit + 1,
    ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    include: {
      items: true,
      statusHistory: { orderBy: { createdAt: 'asc' } },
      deliveryZone: true,
      customer: { include: { user: { select: { id: true, email: true, phone: true } } } },
      assignments: {
        include: { courier: { include: { user: { select: { id: true, email: true } } } } },
      },
    },
  })

  const hasMore = orders.length > limit
  const items = hasMore ? orders.slice(0, limit) : orders
  const nextCursor = hasMore ? items[items.length - 1].id : null

  return NextResponse.json(
    { orders: items, nextCursor, hasMore },
    { headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
  )
})

/**
 * POST /api/orders
 * Public endpoint — customers place orders.
 *
 * Server is the single source of truth for pricing:
 * - Client sends only menuItemId, quantity, option IDs, contact info, orderType, paymentMethod
 * - Server loads menu items, validates isActive + isAvailable + category active
 * - Server validates each optionId belongs to the item and is active
 * - Server validates required option groups (e.g. SIZE) are satisfied
 * - Server validates no duplicate option IDs
 * - Server validates zone (DELIVERY) — exists, active, min order amount
 * - Server validates restaurant is open + deliveryEnabled/pickupEnabled
 * - Server validates payment method is compatible with orderType
 * - Server computes all prices; client prices are ignored
 * - Server stores snapshot of name + price + selected options
 * - Server generates tracking token (raw returned only here; hash stored)
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_REQUEST', 'Neplatný JSON body')
  }

  const validation = validateBody(createOrderSchema, body)
  if ('error' in validation) return validation.error

  const data = validation.data

  // ─── 1. Restaurant availability check ───
  const settings = await db.restaurantSettings.findFirst()
  if (!settings) {
    return apiError('BUSINESS_RULE_VIOLATION', 'Reštaurácia nie je nastavená.')
  }
  const openingHours = await db.openingHours.findMany()
  const availability = getRestaurantAvailability(new Date(), settings, openingHours)

  if (!availability.open) {
    return apiError('BUSINESS_RULE_VIOLATION', availability.reason ?? 'Reštaurácia je zatvorená.')
  }

  if (data.orderType === 'DELIVERY' && !availability.deliveryAvailable) {
    return apiError('BUSINESS_RULE_VIOLATION', 'Doručovanie je momentálne vypnuté.')
  }
  if (data.orderType === 'PICKUP' && !availability.pickupAvailable) {
    return apiError('BUSINESS_RULE_VIOLATION', 'Osobný odber je momentálne vypnutý.')
  }

  // ─── 2. Payment method validation ───
  if (!isValidPaymentForOrderType(data.orderType, data.paymentMethod)) {
    return apiError(
      'INVALID_REQUEST',
      `Platobná metóda ${data.paymentMethod} nie je povolená pre ${data.orderType}.`
    )
  }

  // ─── 3. Zone validation (DELIVERY only) ───
  let deliveryFee = 0
  let zone: { id: string; deliveryFee: number; minimumOrderAmount: number; isActive: boolean } | null = null

  if (data.orderType === 'DELIVERY') {
    zone = await db.deliveryZone.findUnique({
      where: { id: data.deliveryZoneId },
      select: { id: true, deliveryFee: true, minimumOrderAmount: true, isActive: true },
    })
    if (!zone) {
      return apiError('INVALID_REQUEST', 'Vybraná zóna doručenia neexistuje.')
    }
    if (!zone.isActive) {
      return apiError('INVALID_REQUEST', 'Vybraná zóna doručenia nie je aktívna.')
    }
    deliveryFee = Number(zone.deliveryFee)
  }

  // ─── 4. Load menu items + validate ───
  const menuItemIds = data.items.map((item) => item.menuItemId)
  const menuItems = await db.menuItem.findMany({
    where: { id: { in: menuItemIds } },
    include: {
      category: { select: { isActive: true } },
      options: { where: { isActive: true } },
    },
  })

  const menuItemMap = new Map(menuItems.map((mi) => [mi.id, mi]))

  // Validate each item
  let subtotalAmount = 0
  const orderItemsData: Array<{
    menuItemId: string
    menuItemNameSnapshot: string
    quantity: number
    basePriceSnapshot: number
    unitTotalSnapshot: number
    lineTotal: number
    selectedSize: string | null
    selectedOptions: string | null
    kitchenNote: string | null
  }> = []

  for (const item of data.items) {
    const menuItem = menuItemMap.get(item.menuItemId)
    if (!menuItem) {
      return apiError('INVALID_REQUEST', `Položka menu nenájdená: ${item.menuItemId}`)
    }
    if (!menuItem.isActive) {
      return apiError('INVALID_REQUEST', `Položka "${menuItem.name}" nie je aktívna.`)
    }
    if (!menuItem.isAvailable) {
      return apiError('INVALID_REQUEST', `Položka "${menuItem.name}" momentálne nie je dostupná.`)
    }
    if (!menuItem.category?.isActive) {
      return apiError('INVALID_REQUEST', `Kategória položky "${menuItem.name}" nie je aktívna.`)
    }

    const basePrice = Number(menuItem.basePrice)
    let unitTotal = basePrice

    // Validate SIZE option (required group)
    const sizeOptions = menuItem.options.filter((o) => o.optionType === 'SIZE')
    if (sizeOptions.length > 0) {
      // If item has size options, one must be selected
      if (!item.selectedSize) {
        return apiError('INVALID_REQUEST', `Položka "${menuItem.name}" vyžaduje výber veľkosti.`)
      }
      // Find by ID (not by name — client sends option ID)
      const sizeOption = menuItem.options.find((o) => o.id === item.selectedSize || o.name === item.selectedSize)
      if (!sizeOption || sizeOption.optionType !== 'SIZE') {
        return apiError('INVALID_REQUEST', `Neplatná veľkosť pre položku "${menuItem.name}".`)
      }
      unitTotal += Number(sizeOption.priceDelta)
    }

    // Validate selected options (EXTRA + REMOVE)
    const selectedOptionSnapshot: Array<{ id: string; name: string; priceDelta: number }> = []
    if (item.selectedOptions && Array.isArray(item.selectedOptions)) {
      // Check for duplicate option IDs
      const seenIds = new Set<string>()
      for (const optId of item.selectedOptions) {
        if (seenIds.has(optId)) {
          return apiError('INVALID_REQUEST', `Duplicitná voľba v položke "${menuItem.name}".`)
        }
        seenIds.add(optId)

        // Find by ID (must belong to THIS menu item)
        const option = menuItem.options.find((o) => o.id === optId)
        if (!option) {
          return apiError(
            'INVALID_REQUEST',
            `Voľba "${optId}" nepatrí položke "${menuItem.name}".`
          )
        }
        if (!option.isActive) {
          return apiError('INVALID_REQUEST', `Voľba "${option.name}" nie je aktívna.`)
        }
        unitTotal += Number(option.priceDelta)
        selectedOptionSnapshot.push({
          id: option.id,
          name: option.name,
          priceDelta: Number(option.priceDelta),
        })
      }
    }

    const lineTotal = unitTotal * item.quantity
    subtotalAmount += lineTotal

    orderItemsData.push({
      menuItemId: item.menuItemId,
      menuItemNameSnapshot: menuItem.name,
      quantity: item.quantity,
      basePriceSnapshot: basePrice,
      unitTotalSnapshot: unitTotal,
      lineTotal,
      selectedSize: item.selectedSize || null,
      selectedOptions: selectedOptionSnapshot.length > 0
        ? JSON.stringify(selectedOptionSnapshot)
        : null,
      kitchenNote: item.kitchenNote || null,
    })
  }

  // ─── 5. Minimum order check (DELIVERY) ───
  if (data.orderType === 'DELIVERY' && zone) {
    const minOrder = Number(zone.minimumOrderAmount)
    if (subtotalAmount < minOrder) {
      return apiError(
        'BUSINESS_RULE_VIOLATION',
        `Minimálna objednávka pre túto zónu je ${minOrder.toFixed(2)} €. Chýba ${(minOrder - subtotalAmount).toFixed(2)} €.`,
        { minimumOrderAmount: minOrder, currentSubtotal: subtotalAmount }
      )
    }
  }

  const totalAmount = subtotalAmount + deliveryFee

  // ─── 6. Optional: detect price mismatch with client (if client sent prices) ───
  // Client prices are IGNORED for security. If client sent a different total,
  // we don't error — we just use the server-computed price. The response includes
  // the server price so the UI can display the correct amount.

  // ─── 7. Generate tracking token ───
  const trackingToken = generateTrackingToken()
  const trackingTokenHash = hashTrackingToken(trackingToken)

  // ─── 8. Create order in transaction ───
  const order = await db.$transaction(async (tx) => {
    const orderNumber = createOrderNumber()

    return tx.order.create({
      data: {
        orderNumber,
        customerName: data.customerName,
        customerPhone: data.customerPhone,
        customerEmail: data.customerEmail || null,
        orderType: data.orderType,
        paymentMethod: data.paymentMethod,
        deliveryZoneId: data.orderType === 'DELIVERY' ? data.deliveryZoneId : null,
        deliveryAddressLine1: data.orderType === 'DELIVERY' ? data.deliveryAddressLine1 : null,
        deliveryCity: data.orderType === 'DELIVERY' ? data.deliveryCity : null,
        deliveryNote: data.orderType === 'DELIVERY' ? data.deliveryNote : null,
        kitchenNote: data.kitchenNote || null,
        subtotalAmount,
        deliveryFee,
        totalAmount,
        trackingTokenHash,
        items: { create: orderItemsData },
        statusHistory: { create: { status: 'NEW' } },
      },
      include: {
        items: true,
        statusHistory: { orderBy: { createdAt: 'asc' } },
        deliveryZone: true,
      },
    })
  })

  // Return the order with the raw tracking token (only available at creation time).
  // The hash is stored in the DB; subsequent tracking uses the token.
  return NextResponse.json(
    {
      ...order,
      trackingToken, // raw — client should store this for tracking
    },
    {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    }
  )
})

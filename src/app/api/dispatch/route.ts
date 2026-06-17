import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { dispatchSchema, validateBody } from '@/lib/validations'
import { apiError, withErrorHandler } from '@/lib/api-errors'

/**
 * Default max active orders per courier (configurable per courier in future).
 */
const DEFAULT_MAX_ACTIVE_ORDERS = 3

/**
 * POST /api/dispatch
 *
 * Assigns a courier to a delivery order. Hardened with:
 * - Order must exist, be DELIVERY type, in READY or WAITING_FOR_COURIER state
 * - Order must NOT have an existing active assignment
 * - Courier must exist, be active (Courier.isActive + User.isActive)
 * - Courier must be AVAILABLE
 * - Courier activeOrderCount must be under capacity
 * - Courier vehicleType must be allowed in the delivery zone
 * - Atomic transaction with optimistic concurrency on order status
 * - Actor identity from session (assignedByUserId never from client)
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
  if ('error' in authResult) return authResult.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_REQUEST', 'Neplatný JSON body')
  }

  const validation = validateBody(dispatchSchema, body)
  if ('error' in validation) return validation.error

  const data = validation.data

  // ─── Pre-flight validation (non-transactional reads) ───
  const order = await db.order.findUnique({
    where: { id: data.orderId },
    select: {
      id: true,
      orderType: true,
      status: true,
      deliveryZoneId: true,
      assignments: {
        where: { status: { in: ['PENDING', 'ASSIGNED', 'ACCEPTED', 'PICKED_UP'] } },
        select: { id: true },
      },
    },
  })

  if (!order) {
    return apiError('NOT_FOUND', 'Objednávka nenájdená')
  }

  if (order.orderType !== 'DELIVERY') {
    return apiError('BUSINESS_RULE_VIOLATION', 'Priradiť kuriéra možno iba doručovacie objednávky.')
  }

  if (!['READY', 'WAITING_FOR_COURIER'].includes(order.status)) {
    return apiError(
      'BUSINESS_RULE_VIOLATION',
      `Objednávka musí byť v stave READY alebo WAITING_FOR_COURIER (aktuálne: ${order.status}).`
    )
  }

  if (order.assignments.length > 0) {
    return apiError('CONFLICT', 'Objednávka už má aktívne priradenie kuriéra.')
  }

  const courier = await db.courier.findUnique({
    where: { id: data.courierId },
    include: {
      user: { select: { isActive: true } },
    },
  })

  if (!courier) {
    return apiError('NOT_FOUND', 'Kuriér nenájdený')
  }
  if (!courier.isActive || !courier.user.isActive) {
    return apiError('BUSINESS_RULE_VIOLATION', 'Kuriér nie je aktívny.')
  }
  if (courier.status !== 'AVAILABLE') {
    return apiError('BUSINESS_RULE_VIOLATION', `Kuriér nie je dostupný (stav: ${courier.status}).`)
  }

  // Capacity check
  if (courier.activeOrderCount >= DEFAULT_MAX_ACTIVE_ORDERS) {
    return apiError(
      'BUSINESS_RULE_VIOLATION',
      `Kuriér dosiahol maximálny počet aktívnych objednávok (${DEFAULT_MAX_ACTIVE_ORDERS}).`
    )
  }

  // Vehicle/zone compatibility check
  if (order.deliveryZoneId) {
    const zone = await db.deliveryZone.findUnique({
      where: { id: order.deliveryZoneId },
      select: { allowedVehicleTypes: true, name: true },
    })
    if (zone) {
      const allowed = zone.allowedVehicleTypes.split(',').map((v) => v.trim())
      if (!allowed.includes(courier.vehicleType)) {
        return apiError(
          'BUSINESS_RULE_VIOLATION',
          `Vozidlo kuriéra (${courier.vehicleType}) nie je povolené v zóne "${zone.name}".`
        )
      }
    }
  }

  // ─── Atomic transaction with concurrency protection ───
  const now = new Date()
  try {
    const result = await db.$transaction(async (tx) => {
      // Optimistic concurrency: only update if status is still READY or WAITING_FOR_COURIER
      // AND no active assignment exists (re-check inside transaction)
      const updateResult = await tx.order.updateMany({
        where: {
          id: data.orderId,
          status: { in: ['READY', 'WAITING_FOR_COURIER'] },
        },
        data: {
          status: 'ASSIGNED_TO_COURIER',
        },
      })

      if (updateResult.count !== 1) {
        throw new Error('STATUS_CONFLICT')
      }

      // Re-check no active assignment exists (race condition guard)
      const existingAssignment = await tx.deliveryAssignment.findFirst({
        where: {
          orderId: data.orderId,
          status: { in: ['PENDING', 'ASSIGNED', 'ACCEPTED', 'PICKED_UP'] },
        },
        select: { id: true },
      })
      if (existingAssignment) {
        throw new Error('ALREADY_ASSIGNED')
      }

      // Create the assignment (actor from session)
      const assignment = await tx.deliveryAssignment.create({
        data: {
          orderId: data.orderId,
          courierId: data.courierId,
          zoneId: order.deliveryZoneId || null,
          assignedByUserId: authResult.user.id,
          status: 'ASSIGNED',
        },
      })

      // Create status history (actor from session)
      await tx.orderStatusHistory.create({
        data: {
          orderId: data.orderId,
          status: 'ASSIGNED_TO_COURIER',
          changedByUserId: authResult.user.id,
          reason: `Priradený kuriér: ${courier.displayName}`,
        },
      })

      // Increment courier active order count
      await tx.courier.update({
        where: { id: data.courierId },
        data: {
          activeOrderCount: { increment: 1 },
          status: 'ASSIGNED',
        },
      })

      return assignment
    })

    return NextResponse.json(result, {
      status: 201,
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (err) {
    if (err instanceof Error && err.message === 'STATUS_CONFLICT') {
      return apiError('CONFLICT', 'Objednávku medzičasom zmenil iný používateľ.')
    }
    if (err instanceof Error && err.message === 'ALREADY_ASSIGNED') {
      return apiError('CONFLICT', 'Objednávka už má aktívne priradenie kuriéra.')
    }
    throw err
  }
})

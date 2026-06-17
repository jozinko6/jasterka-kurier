/**
 * Order authorization layer.
 *
 * Centralizes all order-level authorization checks:
 * - getAuthenticatedCourier(): load courier profile for the session user
 * - canReadOrder(): role + ownership check for reading
 * - requireAssignedCourierForOrder(): ownership guard for mutations
 * - toPublicOrderTrackingDTO(): sanitize to public-safe fields
 *
 * Never accept actor identity from the client — always use authResult.user.id.
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateRequest, type AuthUser } from '@/lib/auth'
import { apiError } from '@/lib/api-errors'
import type { OrderStatus, OrderType } from '@prisma/client'

export interface OrderAuthResult {
  user: AuthUser
}

export interface CourierProfile {
  id: string
  userId: string
  displayName: string
  vehicleType: string
  status: string
  isActive: boolean
}

/**
 * Authenticate and load the courier profile for the current session.
 * Returns 401 if not authenticated, 403 if not a courier role,
 * 404 if no courier profile exists.
 */
export async function getAuthenticatedCourier(
  request: NextRequest
): Promise<{ data: { user: AuthUser; courier: CourierProfile } } | { error: ReturnType<typeof apiError> }> {
  const authResult = await authenticateRequest(request)
  if ('error' in authResult) {
    return { error: apiError('UNAUTHENTICATED', 'Neautorizovaný prístup. Prihláste sa.') }
  }

  if (authResult.user.role !== 'COURIER' && authResult.user.role !== 'ADMIN' && authResult.user.role !== 'OWNER') {
    return { error: apiError('FORBIDDEN', 'Táto sekcia je dostupná iba kuriérom.') }
  }

  const courier = await db.courier.findUnique({
    where: { userId: authResult.user.id },
    select: {
      id: true,
      userId: true,
      displayName: true,
      vehicleType: true,
      status: true,
      isActive: true,
    },
  })

  if (!courier) {
    return { error: apiError('NOT_FOUND', 'Kuriérsky profil nebol nájdený.') }
  }

  if (!courier.isActive) {
    return { error: apiError('FORBIDDEN', 'Váš kuriérsky profil nie je aktívny.') }
  }

  return { data: { user: authResult.user, courier } }
}

/**
 * Determine if a user can read a given order.
 *
 * - ADMIN/OWNER: full detail of any order
 * - KITCHEN: kitchen-relevant fields only (no customer contact, no courier internals)
 * - COURIER: full detail only if they have an active assignment; otherwise 403
 * - CUSTOMER (if session): only their own order
 * - Anonymous: only the PublicOrderTrackingDTO (use toPublicOrderTrackingDTO instead)
 */
export async function canReadOrder(
  user: AuthUser,
  orderId: string
): Promise<{ allowed: boolean; scope: 'full' | 'kitchen' | 'own' | 'none'; courierOwned?: boolean }> {
  if (user.role === 'ADMIN' || user.role === 'OWNER') {
    return { allowed: true, scope: 'full' }
  }

  if (user.role === 'KITCHEN') {
    return { allowed: true, scope: 'kitchen' }
  }

  if (user.role === 'COURIER') {
    // Check if courier has an active assignment to this order
    const courier = await db.courier.findUnique({
      where: { userId: user.id },
      select: { id: true },
    })
    if (!courier) return { allowed: false, scope: 'none' }

    const assignment = await db.deliveryAssignment.findFirst({
      where: {
        orderId,
        courierId: courier.id,
        status: { in: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP', 'DELIVERED'] },
      },
      select: { id: true },
    })

    if (assignment) {
      return { allowed: true, scope: 'full', courierOwned: true }
    }
    return { allowed: false, scope: 'none' }
  }

  if (user.role === 'CUSTOMER') {
    // Customer can read their own order (matched by customerId via their Customer profile)
    const customer = await db.customer.findUnique({
      where: { userId: user.id },
      select: { id: true },
    })
    if (!customer) return { allowed: false, scope: 'none' }

    const order = await db.order.findUnique({
      where: { id: orderId },
      select: { customerId: true },
    })
    if (!order) return { allowed: false, scope: 'none' }

    if (order.customerId === customer.id) {
      return { allowed: true, scope: 'own' }
    }
    return { allowed: false, scope: 'none' }
  }

  return { allowed: false, scope: 'none' }
}

/**
 * Guard for mutations: the requesting courier must have an active assignment
 * to the order. Returns the assignment ID if owned, otherwise an error response.
 */
export async function requireAssignedCourierForOrder(
  courierId: string,
  orderId: string
): Promise<{ data: { assignmentId: string } } | { error: ReturnType<typeof apiError> }> {
  const assignment = await db.deliveryAssignment.findFirst({
    where: {
      orderId,
      courierId,
      status: { in: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP'] },
    },
    select: { id: true, courierId: true },
  })

  if (!assignment) {
    return {
      error: apiError('FORBIDDEN', 'Nemáte priradenú túto objednávku.', { orderId }),
    }
  }

  return { data: { assignmentId: assignment.id } }
}

// ─── Public tracking DTO ───

export interface PublicOrderTrackingDTO {
  orderNumber: string
  status: OrderStatus
  orderType: OrderType
  paymentMethod: string
  totalAmount: number
  createdAt: string
  acceptedAt: string | null
  readyAt: string | null
  pickedUpAt: string | null
  deliveredAt: string | null
  // ── ETA fields (kitchen-set estimate + delivery window) ──
  estimatedReadyAt: string | null
  estimatedDeliveryFrom: string | null
  estimatedDeliveryTo: string | null
  estimateStatus: string | null
  estimateUpdatedAt: string | null
  publicDelayReason: string | null
  items: Array<{
    id: string
    menuItemNameSnapshot: string
    quantity: number
    lineTotal: number
    selectedSize: string | null
    selectedOptions: string | null
  }>
  /**
   * Sanitized courier info — only displayName, vehicle type, and profile photo.
   * Never includes phone, email, license plate, or user ID.
   */
  courier: {
    displayName: string
    vehicleType: string
    profilePhotoUrl: string | null
  } | null
  /** Tracking steps for UI (order depends on orderType + cancelled/refunded). */
  trackingSteps: OrderStatus[]
}

/**
 * Convert a Prisma Order (with relations loaded) to a public-safe tracking DTO.
 *
 * This strips:
 * - customerName, customerPhone, customerEmail
 * - deliveryAddressLine1/2, deliveryCity, deliveryNote
 * - kitchenNote
 * - customerId, deliveryZoneId
 * - internal assignment IDs, courier phone/email, licensePlate
 * - user IDs
 *
 * Includes ETA fields (estimatedReadyAt, estimatedDeliveryFrom/To,
 * estimateStatus, estimateUpdatedAt, publicDelayReason) so the customer
 * tracking UI can render the live "ready at" / "delivery window" widget
 * without exposing any kitchen internals.
 */
export function toPublicOrderTrackingDTO(order: {
  orderNumber: string
  status: OrderStatus
  orderType: OrderType
  paymentMethod: string
  totalAmount: number
  createdAt: Date
  acceptedAt: Date | null
  readyAt: Date | null
  pickedUpAt: Date | null
  deliveredAt: Date | null
  // ETA fields — optional so older callers don't break, but populated when present
  estimatedReadyAt?: Date | null
  estimatedDeliveryFrom?: Date | null
  estimatedDeliveryTo?: Date | null
  estimateStatus?: string | null
  estimateUpdatedAt?: Date | null
  publicDelayReason?: string | null
  items: Array<{
    id: string
    menuItemNameSnapshot: string
    quantity: number
    lineTotal: number
    selectedSize: string | null
    selectedOptions: string | null
  }>
  assignments?: Array<{
    status: string
    courier?: {
      displayName: string
      vehicleType: string
      profilePhotoUrl: string | null
    } | null
  }>
}): PublicOrderTrackingDTO {
  // Find the active courier assignment (if any)
  const activeAssignment = order.assignments?.find((a) =>
    ['ASSIGNED', 'ACCEPTED', 'PICKED_UP'].includes(a.status)
  )

  const isCancelled = order.status === 'CANCELLED'
  const isRefunded = order.status === 'REFUNDED'

  // Import getTrackingSteps lazily to avoid circular dependency at module load
  // We inline the step logic here for the DTO to keep it self-contained.
  let trackingSteps: OrderStatus[]
  if (isCancelled) {
    trackingSteps = ['CANCELLED']
  } else if (isRefunded) {
    trackingSteps = ['REFUNDED']
  } else if (order.orderType === 'PICKUP') {
    trackingSteps = ['NEW', 'ACCEPTED', 'IN_KITCHEN', 'PREPARING', 'READY', 'DELIVERED']
  } else {
    trackingSteps = [
      'NEW', 'ACCEPTED', 'IN_KITCHEN', 'PREPARING', 'READY',
      'WAITING_FOR_COURIER', 'ASSIGNED_TO_COURIER', 'PICKED_UP', 'ON_THE_WAY', 'DELIVERED',
    ]
  }

  return {
    orderNumber: order.orderNumber,
    status: order.status,
    orderType: order.orderType,
    paymentMethod: order.paymentMethod,
    totalAmount: order.totalAmount,
    createdAt: order.createdAt.toISOString(),
    acceptedAt: order.acceptedAt?.toISOString() ?? null,
    readyAt: order.readyAt?.toISOString() ?? null,
    pickedUpAt: order.pickedUpAt?.toISOString() ?? null,
    deliveredAt: order.deliveredAt?.toISOString() ?? null,
    // ETA fields — always present in the DTO (null when kitchen hasn't set estimate)
    estimatedReadyAt: order.estimatedReadyAt?.toISOString() ?? null,
    estimatedDeliveryFrom: order.estimatedDeliveryFrom?.toISOString() ?? null,
    estimatedDeliveryTo: order.estimatedDeliveryTo?.toISOString() ?? null,
    estimateStatus: order.estimateStatus ?? null,
    estimateUpdatedAt: order.estimateUpdatedAt?.toISOString() ?? null,
    publicDelayReason: order.publicDelayReason ?? null,
    items: order.items,
    courier: activeAssignment?.courier
      ? {
          displayName: activeAssignment.courier.displayName,
          vehicleType: activeAssignment.courier.vehicleType,
          profilePhotoUrl: activeAssignment.courier.profilePhotoUrl,
        }
      : null,
    trackingSteps,
  }
}

/**
 * Kitchen-scoped order DTO — includes items and status but strips
 * customer contact info and courier internals.
 */
export function toKitchenOrderDTO(order: {
  id: string
  orderNumber: string
  status: OrderStatus
  orderType: OrderType
  paymentMethod: string
  kitchenNote: string | null
  createdAt: Date
  items: Array<{
    id: string
    menuItemNameSnapshot: string
    quantity: number
    selectedSize: string | null
    selectedOptions: string | null
    kitchenNote: string | null
  }>
}): typeof order {
  // Kitchen sees the same shape but the caller should not include customer fields
  // in the initial Prisma select. This function is a marker for the scope.
  return order
}

/**
 * Role-specific order transition policy.
 *
 * Replaces the single global ALLOWED_TRANSITIONS map with rules that depend on:
 * - role (ADMIN/OWNER/KITCHEN/COURIER)
 * - orderType (DELIVERY/PICKUP)
 * - current status
 * - whether the courier has an active assignment to this order
 *
 * PICKUP orders use a simplified flow without courier states:
 *   NEW → ACCEPTED → IN_KITCHEN → PREPARING → READY → DELIVERED
 *
 * SCHEDULED_* order types are not in the public create-order schema — they
 * were removed to avoid promising unimplemented functionality.
 */

import type { OrderStatus, OrderType, UserRole } from '@prisma/client'

export interface TransitionContext {
  role: UserRole
  orderType: OrderType
  currentStatus: OrderStatus
  /** True if the requesting courier has an active assignment to this order. */
  courierAssigned: boolean
}

export interface TransitionResult {
  allowed: boolean
  reason?: string
}

// ─── KITCHEN transitions (DELIVERY + PICKUP share the prep flow) ───

const KITCHEN_TRANSITIONS: Record<string, OrderStatus[]> = {
  NEW: ['ACCEPTED'],
  ACCEPTED: ['IN_KITCHEN'],
  IN_KITCHEN: ['PREPARING'],
  PREPARING: ['READY'],
  READY: ['WAITING_FOR_COURIER'], // only for DELIVERY; for PICKUP, admin marks DELIVERED
}

// ─── ADMIN/OWNER transitions ───
// Admins can do everything kitchen can, plus cancel, plus the pickup → DELIVERED,
// plus force-skip (only with explicit force flag — enforced separately).

const ADMIN_TRANSITIONS_DELIVERY: Record<string, OrderStatus[]> = {
  NEW: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['IN_KITCHEN', 'CANCELLED'],
  IN_KITCHEN: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['WAITING_FOR_COURIER', 'CANCELLED'],
  WAITING_FOR_COURIER: ['ASSIGNED_TO_COURIER', 'CANCELLED'],
  // Admin cannot skip ASSIGNED_TO_COURIER → DELIVERED; courier must drive the flow
  ASSIGNED_TO_COURIER: ['CANCELLED'],
  PICKED_UP: ['CANCELLED'],
  ON_THE_WAY: ['CANCELLED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
}

const ADMIN_TRANSITIONS_PICKUP: Record<string, OrderStatus[]> = {
  NEW: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['IN_KITCHEN', 'CANCELLED'],
  IN_KITCHEN: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
}

// ─── COURIER transitions (DELIVERY only, only on own assigned order) ───

const COURIER_TRANSITIONS: Record<string, OrderStatus[]> = {
  ASSIGNED_TO_COURIER: ['PICKED_UP'],
  PICKED_UP: ['ON_THE_WAY'],
  ON_THE_WAY: ['DELIVERED'],
}

/**
 * Determine if a status transition is allowed given the full context.
 *
 * Rules:
 * - KITCHEN can only do prep-flow transitions (NEW→ACCEPTED→...→READY).
 *   For DELIVERY, READY→WAITING_FOR_COURIER is allowed.
 *   KITCHEN CANNOT mark anything as DELIVERED, CANCELLED, or do courier transitions.
 * - COURIER can only do ASSIGNED_TO_COURIER→PICKED_UP→ON_THE_WAY→DELIVERED,
 *   and ONLY if they have an active assignment to this order.
 * - ADMIN/OWNER can do all prep transitions + controlled cancellation.
 *   They CANNOT skip states (e.g. NEW→DELIVERED) without an explicit force flag.
 */
export function canTransitionOrder(ctx: TransitionContext, target: OrderStatus): TransitionResult {
  const { role, orderType, currentStatus, courierAssigned } = ctx

  // Terminal states — no transitions out (except admin REFUNDED on DELIVERED)
  if (currentStatus === 'CANCELLED') {
    return { allowed: false, reason: 'Zrušenú objednávku nemožno zmeniť.' }
  }
  if (currentStatus === 'REFUNDED') {
    return { allowed: false, reason: 'Vrátenú objednávku nemožno zmeniť.' }
  }

  if (role === 'KITCHEN') {
    const allowed = KITCHEN_TRANSITIONS[currentStatus]
    if (!allowed || !allowed.includes(target)) {
      return {
        allowed: false,
        reason: `Kuchyňa nemôže zmeniť stav z ${currentStatus} na ${target}.`,
      }
    }
    // For PICKUP, kitchen cannot do READY→WAITING_FOR_COURIER (that's delivery-only)
    if (orderType === 'PICKUP' && target === 'WAITING_FOR_COURIER') {
      return {
        allowed: false,
        reason: 'Pre osobný odber nie je kuriér potrebný.',
      }
    }
    return { allowed: true }
  }

  if (role === 'COURIER') {
    // Couriers can only do courier transitions, and only on their own assigned order
    if (!courierAssigned) {
      return {
        allowed: false,
        reason: 'Nemáte priradenú túto objednávku.',
      }
    }
    if (orderType !== 'DELIVERY') {
      return {
        allowed: false,
        reason: 'Kuriér môže meniť iba doručovacie objednávky.',
      }
    }
    const allowed = COURIER_TRANSITIONS[currentStatus]
    if (!allowed || !allowed.includes(target)) {
      return {
        allowed: false,
        reason: `Kuriér nemôže zmeniť stav z ${currentStatus} na ${target}.`,
      }
    }
    return { allowed: true }
  }

  if (role === 'ADMIN' || role === 'OWNER') {
    const map = orderType === 'PICKUP' ? ADMIN_TRANSITIONS_PICKUP : ADMIN_TRANSITIONS_DELIVERY
    const allowed = map[currentStatus]
    if (!allowed || !allowed.includes(target)) {
      return {
        allowed: false,
        reason: `Prechod z ${currentStatus} na ${target} nie je povolený.`,
      }
    }
    return { allowed: true }
  }

  // CUSTOMER and other roles cannot transition orders
  return { allowed: false, reason: 'Nemáte oprávnenie meniť stav objednávky.' }
}

/**
 * Get the list of allowed target statuses for a given context.
 * Used by the API to return `allowedTransitions` to the admin UI.
 */
export function getAllowedTransitionsForContext(ctx: TransitionContext): OrderStatus[] {
  const { role, orderType, currentStatus, courierAssigned } = ctx

  if (currentStatus === 'CANCELLED' || currentStatus === 'REFUNDED') {
    return []
  }

  if (role === 'KITCHEN') {
    const allowed = KITCHEN_TRANSITIONS[currentStatus] ?? []
    if (orderType === 'PICKUP') {
      return allowed.filter((s) => s !== 'WAITING_FOR_COURIER')
    }
    return allowed
  }

  if (role === 'COURIER') {
    if (!courierAssigned || orderType !== 'DELIVERY') return []
    return COURIER_TRANSITIONS[currentStatus] ?? []
  }

  if (role === 'ADMIN' || role === 'OWNER') {
    const map = orderType === 'PICKUP' ? ADMIN_TRANSITIONS_PICKUP : ADMIN_TRANSITIONS_DELIVERY
    return map[currentStatus] ?? []
  }

  return []
}

/**
 * Get the ordered list of status steps for tracking UI.
 * Different for DELIVERY vs PICKUP.
 */
export function getTrackingSteps(orderType: OrderType, isCancelled: boolean, isRefunded: boolean): OrderStatus[] {
  if (isCancelled) return ['CANCELLED']
  if (isRefunded) return ['REFUNDED']

  if (orderType === 'PICKUP') {
    return ['NEW', 'ACCEPTED', 'IN_KITCHEN', 'PREPARING', 'READY', 'DELIVERED']
  }

  return [
    'NEW', 'ACCEPTED', 'IN_KITCHEN', 'PREPARING', 'READY',
    'WAITING_FOR_COURIER', 'ASSIGNED_TO_COURIER', 'PICKED_UP', 'ON_THE_WAY', 'DELIVERED',
  ]
}

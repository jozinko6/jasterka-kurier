import { describe, it, expect } from 'vitest'
import { canTransitionOrder, getAllowedTransitionsForContext, getTrackingSteps } from '@/lib/order-policy'
import type { OrderStatus, OrderType, UserRole } from '@prisma/client'

describe('role-specific order transition policy', () => {
  const ctx = (
    role: UserRole,
    orderType: OrderType,
    currentStatus: OrderStatus,
    courierAssigned = false
  ) => ({ role, orderType, currentStatus, courierAssigned })

  // ─── KITCHEN transitions ───

  describe('KITCHEN role', () => {
    it('allows NEW -> ACCEPTED', () => {
      const r = canTransitionOrder(ctx('KITCHEN', 'DELIVERY', 'NEW'), 'ACCEPTED')
      expect(r.allowed).toBe(true)
    })

    it('allows ACCEPTED -> IN_KITCHEN', () => {
      const r = canTransitionOrder(ctx('KITCHEN', 'DELIVERY', 'ACCEPTED'), 'IN_KITCHEN')
      expect(r.allowed).toBe(true)
    })

    it('allows READY -> WAITING_FOR_COURIER (DELIVERY)', () => {
      const r = canTransitionOrder(ctx('KITCHEN', 'DELIVERY', 'READY'), 'WAITING_FOR_COURIER')
      expect(r.allowed).toBe(true)
    })

    it('forbids READY -> WAITING_FOR_COURIER (PICKUP)', () => {
      const r = canTransitionOrder(ctx('KITCHEN', 'PICKUP', 'READY'), 'WAITING_FOR_COURIER')
      expect(r.allowed).toBe(false)
      expect(r.reason).toContain('osobný odber')
    })

    it('forbids READY -> DELIVERED (kitchen cannot mark delivered)', () => {
      const r = canTransitionOrder(ctx('KITCHEN', 'DELIVERY', 'READY'), 'DELIVERED')
      expect(r.allowed).toBe(false)
    })

    it('forbids CANCELLED', () => {
      const r = canTransitionOrder(ctx('KITCHEN', 'DELIVERY', 'NEW'), 'CANCELLED')
      expect(r.allowed).toBe(false)
    })

    it('forbids courier transitions (ASSIGNED_TO_COURIER -> PICKED_UP)', () => {
      const r = canTransitionOrder(ctx('KITCHEN', 'DELIVERY', 'ASSIGNED_TO_COURIER'), 'PICKED_UP')
      expect(r.allowed).toBe(false)
    })
  })

  // ─── COURIER transitions ───

  describe('COURIER role', () => {
    it('allows ASSIGNED_TO_COURIER -> PICKED_UP when assigned', () => {
      const r = canTransitionOrder(ctx('COURIER', 'DELIVERY', 'ASSIGNED_TO_COURIER', true), 'PICKED_UP')
      expect(r.allowed).toBe(true)
    })

    it('forbids ASSIGNED_TO_COURIER -> PICKED_UP when NOT assigned', () => {
      const r = canTransitionOrder(ctx('COURIER', 'DELIVERY', 'ASSIGNED_TO_COURIER', false), 'PICKED_UP')
      expect(r.allowed).toBe(false)
      expect(r.reason).toContain('priradenú')
    })

    it('allows PICKED_UP -> ON_THE_WAY when assigned', () => {
      const r = canTransitionOrder(ctx('COURIER', 'DELIVERY', 'PICKED_UP', true), 'ON_THE_WAY')
      expect(r.allowed).toBe(true)
    })

    it('allows ON_THE_WAY -> DELIVERED when assigned', () => {
      const r = canTransitionOrder(ctx('COURIER', 'DELIVERY', 'ON_THE_WAY', true), 'DELIVERED')
      expect(r.allowed).toBe(true)
    })

    it('forbids NEW -> ACCEPTED (courier cannot accept new orders)', () => {
      const r = canTransitionOrder(ctx('COURIER', 'DELIVERY', 'NEW', true), 'ACCEPTED')
      expect(r.allowed).toBe(false)
    })

    it('forbids DELIVERED -> REFUNDED (courier cannot refund)', () => {
      const r = canTransitionOrder(ctx('COURIER', 'DELIVERY', 'DELIVERED', true), 'REFUNDED')
      expect(r.allowed).toBe(false)
    })

    it('forbids PICKUP order transitions (courier only handles DELIVERY)', () => {
      const r = canTransitionOrder(ctx('COURIER', 'PICKUP', 'READY', true), 'DELIVERED')
      expect(r.allowed).toBe(false)
      // Message contains "doručovacie" (with Slovak diacritics)
      expect(r.reason).toMatch(/doru.{1}ovacie/i)
    })
  })

  // ─── ADMIN transitions ───

  describe('ADMIN role', () => {
    it('allows NEW -> CANCELLED', () => {
      const r = canTransitionOrder(ctx('ADMIN', 'DELIVERY', 'NEW'), 'CANCELLED')
      expect(r.allowed).toBe(true)
    })

    it('allows READY -> DELIVERED (PICKUP)', () => {
      const r = canTransitionOrder(ctx('ADMIN', 'PICKUP', 'READY'), 'DELIVERED')
      expect(r.allowed).toBe(true)
    })

    it('forbids NEW -> DELIVERED (no state skipping)', () => {
      const r = canTransitionOrder(ctx('ADMIN', 'DELIVERY', 'NEW'), 'DELIVERED')
      expect(r.allowed).toBe(false)
    })

    it('forbids ASSIGNED_TO_COURIER -> DELIVERED (courier must drive flow)', () => {
      const r = canTransitionOrder(ctx('ADMIN', 'DELIVERY', 'ASSIGNED_TO_COURIER'), 'DELIVERED')
      expect(r.allowed).toBe(false)
    })

    it('allows DELIVERED -> REFUNDED', () => {
      const r = canTransitionOrder(ctx('ADMIN', 'DELIVERY', 'DELIVERED'), 'REFUNDED')
      expect(r.allowed).toBe(true)
    })
  })

  // ─── Terminal states ───

  describe('terminal states', () => {
    it('forbids any transition from CANCELLED', () => {
      const r = canTransitionOrder(ctx('ADMIN', 'DELIVERY', 'CANCELLED'), 'NEW')
      expect(r.allowed).toBe(false)
    })

    it('forbids any transition from REFUNDED', () => {
      const r = canTransitionOrder(ctx('ADMIN', 'DELIVERY', 'REFUNDED'), 'DELIVERED')
      expect(r.allowed).toBe(false)
    })
  })

  // ─── CUSTOMER role ───

  describe('CUSTOMER role', () => {
    it('forbids all transitions', () => {
      const r = canTransitionOrder(ctx('CUSTOMER', 'DELIVERY', 'NEW'), 'ACCEPTED')
      expect(r.allowed).toBe(false)
    })
  })
})

describe('getAllowedTransitionsForContext', () => {
  it('returns kitchen transitions for KITCHEN', () => {
    const t = getAllowedTransitionsForContext({
      role: 'KITCHEN',
      orderType: 'DELIVERY',
      currentStatus: 'NEW',
      courierAssigned: false,
    })
    expect(t).toEqual(['ACCEPTED'])
  })

  it('returns courier transitions for COURIER (assigned)', () => {
    const t = getAllowedTransitionsForContext({
      role: 'COURIER',
      orderType: 'DELIVERY',
      currentStatus: 'PICKED_UP',
      courierAssigned: true,
    })
    expect(t).toEqual(['ON_THE_WAY'])
  })

  it('returns empty for COURIER (not assigned)', () => {
    const t = getAllowedTransitionsForContext({
      role: 'COURIER',
      orderType: 'DELIVERY',
      currentStatus: 'PICKED_UP',
      courierAssigned: false,
    })
    expect(t).toEqual([])
  })

  it('returns admin transitions for ADMIN', () => {
    const t = getAllowedTransitionsForContext({
      role: 'ADMIN',
      orderType: 'DELIVERY',
      currentStatus: 'NEW',
      courierAssigned: false,
    })
    expect(t).toContain('ACCEPTED')
    expect(t).toContain('CANCELLED')
  })

  it('returns empty for terminal states', () => {
    const t = getAllowedTransitionsForContext({
      role: 'ADMIN',
      orderType: 'DELIVERY',
      currentStatus: 'CANCELLED',
      courierAssigned: false,
    })
    expect(t).toEqual([])
  })
})

describe('getTrackingSteps', () => {
  it('returns delivery steps for DELIVERY', () => {
    const steps = getTrackingSteps('DELIVERY', false, false)
    expect(steps).toContain('WAITING_FOR_COURIER')
    expect(steps).toContain('ASSIGNED_TO_COURIER')
    expect(steps).toContain('PICKED_UP')
    expect(steps).toContain('ON_THE_WAY')
    expect(steps[steps.length - 1]).toBe('DELIVERED')
  })

  it('returns pickup steps (no courier states) for PICKUP', () => {
    const steps = getTrackingSteps('PICKUP', false, false)
    expect(steps).not.toContain('WAITING_FOR_COURIER')
    expect(steps).not.toContain('ASSIGNED_TO_COURIER')
    expect(steps[steps.length - 1]).toBe('DELIVERED')
  })

  it('returns only CANCELLED for cancelled orders', () => {
    const steps = getTrackingSteps('DELIVERY', true, false)
    expect(steps).toEqual(['CANCELLED'])
  })

  it('returns only REFUNDED for refunded orders', () => {
    const steps = getTrackingSteps('DELIVERY', false, true)
    expect(steps).toEqual(['REFUNDED'])
  })
})

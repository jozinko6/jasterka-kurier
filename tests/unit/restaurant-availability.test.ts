import { describe, it, expect } from 'vitest'
import {
  getRestaurantAvailability,
  isValidPaymentForOrderType,
} from '@/lib/restaurant-availability'

const baseSettings = {
  isOpen: true,
  deliveryEnabled: true,
  pickupEnabled: true,
}

const weekHours = [
  { dayOfWeek: 1, openTime: '10:00', closeTime: '21:00', isClosed: false }, // Mon
  { dayOfWeek: 2, openTime: '10:00', closeTime: '21:00', isClosed: false }, // Tue
  { dayOfWeek: 3, openTime: '10:00', closeTime: '21:00', isClosed: false }, // Wed
  { dayOfWeek: 4, openTime: '10:00', closeTime: '21:00', isClosed: false }, // Thu
  { dayOfWeek: 5, openTime: '10:00', closeTime: '22:00', isClosed: false }, // Fri
  { dayOfWeek: 6, openTime: '11:00', closeTime: '22:00', isClosed: false }, // Sat
  { dayOfWeek: 0, openTime: '11:00', closeTime: '20:00', isClosed: false }, // Sun
]

describe('getRestaurantAvailability', () => {
  it('returns open=true when within opening hours', () => {
    // Wednesday 12:00 UTC = 14:00 Bratislava (CEST, UTC+2)
    const wednesdayNoon = new Date('2025-06-18T12:00:00Z')
    const r = getRestaurantAvailability(wednesdayNoon, baseSettings, weekHours)
    expect(r.open).toBe(true)
    expect(r.deliveryAvailable).toBe(true)
    expect(r.pickupAvailable).toBe(true)
  })

  it('returns open=false when outside opening hours', () => {
    // Wednesday 21:00 UTC = 23:00 Bratislava — after close (21:00)
    const wednesdayLate = new Date('2025-06-18T21:00:00Z')
    const r = getRestaurantAvailability(wednesdayLate, baseSettings, weekHours)
    expect(r.open).toBe(false)
  })

  it('returns open=false when isOpen kill switch is off', () => {
    const wednesdayNoon = new Date('2025-06-18T12:00:00Z')
    const r = getRestaurantAvailability(wednesdayNoon, { ...baseSettings, isOpen: false }, weekHours)
    expect(r.open).toBe(false)
    expect(r.reason).toContain('zatvorená')
  })

  it('returns deliveryAvailable=false when deliveryEnabled is off', () => {
    const wednesdayNoon = new Date('2025-06-18T12:00:00Z')
    const r = getRestaurantAvailability(wednesdayNoon, { ...baseSettings, deliveryEnabled: false }, weekHours)
    expect(r.open).toBe(true)
    expect(r.deliveryAvailable).toBe(false)
    expect(r.pickupAvailable).toBe(true)
  })

  it('returns open=false on a closed day', () => {
    const closedDayHours = [
      { dayOfWeek: 2, openTime: null, closeTime: null, isClosed: true }, // Tue closed
    ]
    // Tuesday 12:00 UTC = 14:00 Bratislava
    const tuesday = new Date('2025-06-17T12:00:00Z')
    const r = getRestaurantAvailability(tuesday, baseSettings, closedDayHours)
    expect(r.open).toBe(false)
  })

  it('handles overnight intervals (22:00–02:00)', () => {
    const overnightHours = [
      { dayOfWeek: 5, openTime: '22:00', closeTime: '02:00', isClosed: false }, // Fri overnight
    ]
    // Friday 22:00 UTC = Saturday 00:00 Bratislava — within overnight
    const fridayLate = new Date('2025-06-20T22:00:00Z')
    const r = getRestaurantAvailability(fridayLate, baseSettings, overnightHours)
    expect(r.open).toBe(true)
  })

  it('handles overnight intervals in the early morning (after midnight)', () => {
    const overnightHours = [
      { dayOfWeek: 5, openTime: '22:00', closeTime: '02:00', isClosed: false }, // Fri overnight
    ]
    // Saturday 00:30 UTC = 02:30 Bratislava — still within overnight (closes at 02:00)
    // Actually 00:30 UTC = 02:30 Bratislava — after close
    // Let's use 23:30 UTC Friday = 01:30 Saturday Bratislava — within overnight
    const earlyMorning = new Date('2025-06-20T23:30:00Z')
    const r = getRestaurantAvailability(earlyMorning, baseSettings, overnightHours)
    expect(r.open).toBe(true)
  })
})

describe('isValidPaymentForOrderType', () => {
  it('allows CASH for DELIVERY', () => {
    expect(isValidPaymentForOrderType('DELIVERY', 'CASH')).toBe(true)
  })

  it('allows CARD_ON_DELIVERY for DELIVERY', () => {
    expect(isValidPaymentForOrderType('DELIVERY', 'CARD_ON_DELIVERY')).toBe(true)
  })

  it('forbids CARD_ON_PICKUP for DELIVERY', () => {
    expect(isValidPaymentForOrderType('DELIVERY', 'CARD_ON_PICKUP')).toBe(false)
  })

  it('allows CASH for PICKUP', () => {
    expect(isValidPaymentForOrderType('PICKUP', 'CASH')).toBe(true)
  })

  it('allows CARD_ON_PICKUP for PICKUP', () => {
    expect(isValidPaymentForOrderType('PICKUP', 'CARD_ON_PICKUP')).toBe(true)
  })

  it('forbids CARD_ON_DELIVERY for PICKUP', () => {
    expect(isValidPaymentForOrderType('PICKUP', 'CARD_ON_DELIVERY')).toBe(false)
  })

  it('forbids ONLINE_CARD (not implemented)', () => {
    expect(isValidPaymentForOrderType('DELIVERY', 'ONLINE_CARD')).toBe(false)
    expect(isValidPaymentForOrderType('PICKUP', 'ONLINE_CARD')).toBe(false)
  })
})

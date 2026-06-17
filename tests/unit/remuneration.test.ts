import { describe, it, expect } from 'vitest'
import {
  calculateOrderRemuneration,
  isPeakNow,
  isWeekend,
  isSlovakHoliday,
  type RemunerationPlanSnapshot,
  type OrderCompensationInput,
} from '@/lib/remuneration'

const basePlan: RemunerationPlanSnapshot = {
  planId: 'plan-1',
  planName: 'Test Plan',
  versionNumber: 1,
  currency: 'EUR',
  rules: [
    { ruleType: 'DELIVERY_BASE', valueType: 'FIXED_CENTS', valueCents: 150, valueBasisPoints: 0, priority: 1 },
    { ruleType: 'PICKUP_FEE', valueType: 'FIXED_CENTS', valueCents: 50, valueBasisPoints: 0, priority: 1 },
    { ruleType: 'DROPOFF_FEE', valueType: 'FIXED_CENTS', valueCents: 50, valueBasisPoints: 0, priority: 1 },
    { ruleType: 'PER_KILOMETER', valueType: 'PER_KILOMETER_CENTS', valueCents: 20, valueBasisPoints: 0, priority: 1 },
    { ruleType: 'MINIMUM_PER_ORDER', valueType: 'FIXED_CENTS', valueCents: 200, valueBasisPoints: 0, priority: 1 },
    { ruleType: 'WEEKEND_BONUS', valueType: 'FIXED_CENTS', valueCents: 100, valueBasisPoints: 0, priority: 1 },
    { ruleType: 'HOLIDAY_BONUS', valueType: 'FIXED_CENTS', valueCents: 200, valueBasisPoints: 0, priority: 1 },
    { ruleType: 'CANCELLATION_COMPENSATION', valueType: 'FIXED_CENTS', valueCents: 100, valueBasisPoints: 0, priority: 1 },
  ],
  zoneRules: [
    { zoneId: 'zone-1', zoneName: 'Centrum', bonusCents: 30 },
  ],
  peakRules: [
    { dayOfWeek: 5, startTime: '17:00', endTime: '21:00', bonusCents: 150 },
    { dayOfWeek: 6, startTime: '17:00', endTime: '21:00', bonusCents: 150 },
  ],
}

const baseInput: OrderCompensationInput = {
  orderId: 'order-1',
  orderNumber: 'JAS-001',
  courierId: 'courier-1',
  zoneId: 'zone-1',
  occurredAt: new Date('2025-06-18T12:00:00Z'), // Wednesday noon
}

describe('remuneration calculation engine', () => {
  it('computes delivery base + pickup + dropoff', () => {
    const result = calculateOrderRemuneration(basePlan, baseInput)
    const types = result.components.map((c) => c.type)
    expect(types).toContain('DELIVERY_BASE')
    expect(types).toContain('PICKUP_FEE')
    expect(types).toContain('DROPOFF_FEE')
    const base = result.components.find((c) => c.type === 'DELIVERY_BASE')
    expect(base?.amountCents).toBe(150)
  })

  it('includes zone bonus when zone matches', () => {
    const result = calculateOrderRemuneration(basePlan, baseInput)
    const zoneBonus = result.components.find((c) => c.type === 'ZONE_BONUS')
    expect(zoneBonus).toBeDefined()
    expect(zoneBonus?.amountCents).toBe(30)
  })

  it('computes per-kilometer fee based on total distance', () => {
    const result = calculateOrderRemuneration(basePlan, {
      ...baseInput,
      totalDistanceMeters: 5000, // 5 km
    })
    const distComponent = result.components.find((c) => c.type === 'DELIVERY_DISTANCE')
    expect(distComponent).toBeDefined()
    expect(distComponent?.amountCents).toBe(100) // 5 * 20
  })

  it('applies weekend bonus on Saturday', () => {
    const saturday = new Date('2025-06-21T12:00:00Z')
    const result = calculateOrderRemuneration(basePlan, {
      ...baseInput,
      occurredAt: saturday,
    })
    const weekendBonus = result.components.find((c) => c.type === 'WEEKEND_BONUS')
    expect(weekendBonus).toBeDefined()
    expect(weekendBonus?.amountCents).toBe(100)
  })

  it('applies peak bonus during Friday 17:00-21:00 Bratislava time', () => {
    // Bratislava is UTC+2 in summer, so 15:30 UTC = 17:30 local on Friday
    const fridayEvening = new Date('2025-06-20T15:30:00Z')
    const result = calculateOrderRemuneration(basePlan, {
      ...baseInput,
      occurredAt: fridayEvening,
    })
    const peakBonus = result.components.find((c) => c.type === 'PEAK_BONUS')
    expect(peakBonus).toBeDefined()
    expect(peakBonus?.amountCents).toBe(150)
  })

  it('does not apply peak bonus outside peak hours', () => {
    // Friday 10:00 UTC = 12:00 Bratislava — outside peak (17:00-21:00)
    const fridayNoon = new Date('2025-06-20T10:00:00Z')
    const result = calculateOrderRemuneration(basePlan, {
      ...baseInput,
      occurredAt: fridayNoon,
    })
    const peakBonus = result.components.find((c) => c.type === 'PEAK_BONUS')
    expect(peakBonus).toBeUndefined()
  })

  it('includes tip when provided', () => {
    const result = calculateOrderRemuneration(basePlan, {
      ...baseInput,
      tipCents: 200,
    })
    const tip = result.components.find((c) => c.type === 'TIP')
    expect(tip).toBeDefined()
    expect(tip?.amountCents).toBe(200)
  })

  it('applies minimum per order guarantee', () => {
    const minimalPlan: RemunerationPlanSnapshot = {
      ...basePlan,
      rules: [
        { ruleType: 'DELIVERY_BASE', valueType: 'FIXED_CENTS', valueCents: 50, valueBasisPoints: 0, priority: 1 },
        { ruleType: 'MINIMUM_PER_ORDER', valueType: 'FIXED_CENTS', valueCents: 200, valueBasisPoints: 0, priority: 1 },
      ],
      zoneRules: [],
      peakRules: [],
    }
    const result = calculateOrderRemuneration(minimalPlan, {
      ...baseInput,
      zoneId: undefined,
    })
    // Base = 50, minimum = 200, so top-up = 150
    const total = result.totalCents
    expect(total).toBe(200)
  })

  it('applies cancellation compensation for cancelled orders', () => {
    const result = calculateOrderRemuneration(basePlan, {
      ...baseInput,
      isCancelled: true,
    })
    const cancelComp = result.components.find((c) => c.type === 'CANCELLATION_COMPENSATION')
    expect(cancelComp).toBeDefined()
    expect(cancelComp?.amountCents).toBe(100)
  })

  it('applies multi-order bonus for stacked deliveries', () => {
    const multiPlan: RemunerationPlanSnapshot = {
      ...basePlan,
      rules: [
        ...basePlan.rules,
        { ruleType: 'MULTI_ORDER_BONUS', valueType: 'FIXED_CENTS', valueCents: 50, valueBasisPoints: 0, priority: 1 },
      ],
    }
    const result = calculateOrderRemuneration(multiPlan, {
      ...baseInput,
      multiOrderCount: 3, // 2 extra orders
    })
    const multiBonus = result.components.find((c) => c.type === 'MULTI_ORDER_BONUS')
    expect(multiBonus).toBeDefined()
    expect(multiBonus?.amountCents).toBe(100) // 50 * 2 extra
  })

  it('returns correct total as sum of all components', () => {
    const result = calculateOrderRemuneration(basePlan, baseInput)
    const componentSum = result.components.reduce((s, c) => s + c.amountCents, 0)
    expect(result.totalCents).toBe(componentSum)
  })

  it('uses courier overrides when provided', () => {
    const result = calculateOrderRemuneration(basePlan, {
      ...baseInput,
      courierOverrides: [
        { ruleType: 'DELIVERY_BASE', valueType: 'FIXED_CENTS', valueCents: 300, valueBasisPoints: 0 },
      ],
    })
    const base = result.components.find((c) => c.type === 'DELIVERY_BASE')
    expect(base?.amountCents).toBe(300) // override, not 150
  })
})

describe('isPeakNow', () => {
  it('detects peak during active hours', () => {
    // Friday 15:00 UTC = 17:00 Bratislava — start of peak
    const friday = new Date('2025-06-20T15:00:00Z')
    const peak = isPeakNow(friday, basePlan.peakRules)
    expect(peak).toBeDefined()
  })

  it('handles overnight intervals', () => {
    const overnightRules = [
      { dayOfWeek: 5, startTime: '22:00', endTime: '02:00', bonusCents: 100 },
    ]
    // Friday 20:30 UTC = 22:30 Bratislava — within overnight peak
    const fridayLate = new Date('2025-06-20T20:30:00Z')
    const peak = isPeakNow(fridayLate, overnightRules)
    expect(peak).toBeDefined()
  })
})

describe('isWeekend', () => {
  it('returns true for Saturday', () => {
    const saturday = new Date('2025-06-21T12:00:00Z')
    expect(isWeekend(saturday)).toBe(true)
  })

  it('returns true for Sunday', () => {
    const sunday = new Date('2025-06-22T12:00:00Z')
    expect(isWeekend(sunday)).toBe(true)
  })

  it('returns false for Wednesday', () => {
    const wednesday = new Date('2025-06-18T12:00:00Z')
    expect(isWeekend(wednesday)).toBe(false)
  })
})

describe('isSlovakHoliday', () => {
  it('detects New Year', () => {
    expect(isSlovakHoliday(new Date('2025-01-01T12:00:00Z'))).toBe(true)
  })

  it('detects Christmas', () => {
    expect(isSlovakHoliday(new Date('2025-12-25T12:00:00Z'))).toBe(true)
    expect(isSlovakHoliday(new Date('2025-12-26T12:00:00Z'))).toBe(true)
  })

  it('detects Labour Day', () => {
    expect(isSlovakHoliday(new Date('2025-05-01T12:00:00Z'))).toBe(true)
  })

  it('detects Easter Monday 2025', () => {
    // Easter 2025: Easter Sunday April 20, Easter Monday April 21
    // In Bratislava (UTC+2 in summer), 2025-04-21T10:00Z = 12:00 local
    expect(isSlovakHoliday(new Date('2025-04-21T10:00:00Z'))).toBe(true)
  })

  it('returns false for a regular day', () => {
    expect(isSlovakHoliday(new Date('2025-06-18T12:00:00Z'))).toBe(false)
  })
})

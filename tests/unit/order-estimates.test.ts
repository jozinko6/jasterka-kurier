/**
 * Unit tests for order estimate calculations.
 *
 * Tests:
 * - Kitchen estimate + delivery zone → delivery window
 * - Buffer before and after
 * - PICKUP has no delivery window
 * - DELIVERY without zone
 * - READY uses actualReadyAt
 * - CANCELLED/DELIVERED states
 * - Time across midnight
 * - Validation (min 5 min, max 180 min)
 */

import { describe, it, expect } from 'vitest'
import {
  calculateCustomerEtaWindow,
  validateEstimateMinutes,
  getMinutesUntilReady,
  formatTime,
  QUICK_PRESET_MINUTES,
  PUBLIC_DELAY_LABELS,
} from '@/lib/order-estimates'

// Bratislava in summer (CEST) = UTC+2
const SUMMER_OFFSET = 2 * 60 * 60 * 1000

describe('calculateCustomerEtaWindow', () => {
  const baseInput = {
    orderType: 'DELIVERY' as const,
    orderStatus: 'ACCEPTED' as const,
    estimatedReadyAt: new Date('2025-06-18T16:35:00Z'), // 18:35 Bratislava summer
    actualReadyAt: null,
    zoneDeliveryMinutes: 20,
    beforeBufferMinutes: 5,
    afterBufferMinutes: 10,
    defaultPrepMinutes: 25,
    now: new Date('2025-06-18T15:00:00Z'), // 17:00 Bratislava
  }

  describe('DELIVERY with kitchen estimate', () => {
    it('computes delivery window from ready time + zone minutes ± buffer', () => {
      const result = calculateCustomerEtaWindow(baseInput)
      expect(result.estimatedReadyAt).toEqual(new Date('2025-06-18T16:35:00Z'))
      // 16:35 UTC + 20 min = 16:55 UTC (estimated delivery)
      // 16:55 - 5 min = 16:50 UTC (deliveryFrom)
      // 16:55 + 10 min = 17:05 UTC (deliveryTo)
      expect(result.deliveryFrom).toEqual(new Date('2025-06-18T16:50:00Z'))
      expect(result.deliveryTo).toEqual(new Date('2025-06-18T17:05:00Z'))
      expect(result.status).toBe('ESTIMATED')
    })

    it('returns ready label and delivery label in Bratislava time', () => {
      const result = calculateCustomerEtaWindow(baseInput)
      // 16:35 UTC = 18:35 Bratislava (CEST, UTC+2)
      expect(result.readyLabel).toBe('18:35')
      // 16:50 UTC = 18:50, 17:05 UTC = 19:05
      expect(result.deliveryLabel).toBe('18:50 – 19:05')
    })
  })

  describe('PICKUP (no delivery window)', () => {
    it('returns ready time but no delivery window', () => {
      const result = calculateCustomerEtaWindow({
        ...baseInput,
        orderType: 'PICKUP',
      })
      expect(result.estimatedReadyAt).not.toBeNull()
      expect(result.deliveryFrom).toBeNull()
      expect(result.deliveryTo).toBeNull()
      expect(result.deliveryLabel).toBeNull()
      expect(result.readyLabel).toBe('18:35')
    })
  })

  describe('DELIVERY without zone', () => {
    it('uses default 30 min delivery time when zone is null', () => {
      const result = calculateCustomerEtaWindow({
        ...baseInput,
        zoneDeliveryMinutes: null,
      })
      // 16:35 + 30 min = 17:05 UTC
      // 17:05 - 5 = 17:00, 17:05 + 10 = 17:15
      expect(result.deliveryFrom).toEqual(new Date('2025-06-18T17:00:00Z'))
      expect(result.deliveryTo).toEqual(new Date('2025-06-18T17:15:00Z'))
    })
  })

  describe('READY state', () => {
    it('uses actualReadyAt when available', () => {
      const result = calculateCustomerEtaWindow({
        ...baseInput,
        orderStatus: 'READY',
        actualReadyAt: new Date('2025-06-18T16:30:00Z'), // 18:30 — 5 min earlier
      })
      expect(result.estimatedReadyAt).toEqual(new Date('2025-06-18T16:30:00Z'))
      expect(result.status).toBe('READY')
      // 16:30 + 20 = 16:50, 16:50 - 5 = 16:45, 16:50 + 10 = 17:00
      expect(result.deliveryFrom).toEqual(new Date('2025-06-18T16:45:00Z'))
      expect(result.deliveryTo).toEqual(new Date('2025-06-18T17:00:00Z'))
    })
  })

  describe('ON_THE_WAY state', () => {
    it('uses courier update source', () => {
      const result = calculateCustomerEtaWindow({
        ...baseInput,
        orderStatus: 'ON_THE_WAY',
        actualReadyAt: new Date('2025-06-18T16:30:00Z'),
      })
      expect(result.status).toBe('ON_THE_WAY')
      expect(result.source).toBe('COURIER_UPDATE')
    })
  })

  describe('CANCELLED state', () => {
    it('returns null for all times', () => {
      const result = calculateCustomerEtaWindow({
        ...baseInput,
        orderStatus: 'CANCELLED',
      })
      expect(result.estimatedReadyAt).toBeNull()
      expect(result.deliveryFrom).toBeNull()
      expect(result.deliveryTo).toBeNull()
      expect(result.status).toBe('CANCELLED')
    })
  })

  describe('DELIVERED state', () => {
    it('uses actualReadyAt and no delivery window', () => {
      const result = calculateCustomerEtaWindow({
        ...baseInput,
        orderStatus: 'DELIVERED',
        actualReadyAt: new Date('2025-06-18T16:30:00Z'),
      })
      expect(result.estimatedReadyAt).toEqual(new Date('2025-06-18T16:30:00Z'))
      expect(result.deliveryFrom).toBeNull()
      expect(result.deliveryTo).toBeNull()
      expect(result.status).toBe('COMPLETED')
    })
  })

  describe('NEW state without estimate', () => {
    it('returns WAITING_FOR_KITCHEN', () => {
      const result = calculateCustomerEtaWindow({
        ...baseInput,
        orderStatus: 'NEW',
        estimatedReadyAt: null,
      })
      expect(result.estimatedReadyAt).toBeNull()
      expect(result.status).toBe('WAITING_FOR_KITCHEN')
      expect(result.readyLabel).toBeNull()
    })
  })

  describe('Time across midnight', () => {
    it('handles ready time near midnight', () => {
      const result = calculateCustomerEtaWindow({
        ...baseInput,
        estimatedReadyAt: new Date('2025-06-18T21:55:00Z'), // 23:55 Bratislava
        zoneDeliveryMinutes: 20,
      })
      // 21:55 + 20 = 22:15 UTC = 00:15 next day Bratislava
      // 22:15 - 5 = 22:10 UTC = 00:10
      // 22:15 + 10 = 22:25 UTC = 00:25
      expect(result.readyLabel).toBe('23:55')
      expect(result.deliveryLabel).toBe('00:10 – 00:25')
    })
  })

  describe('Delay (+15 min)', () => {
    it('changing estimate by +15 min updates delivery window', () => {
      const original = calculateCustomerEtaWindow(baseInput)
      const delayed = calculateCustomerEtaWindow({
        ...baseInput,
        estimatedReadyAt: new Date('2025-06-18T16:50:00Z'), // +15 min
      })
      // Original delivery: 18:50 – 19:05
      // Delayed delivery: 19:05 – 19:20
      expect(delayed.readyLabel).toBe('18:50')
      expect(delayed.deliveryLabel).toBe('19:05 – 19:20')
      expect(delayed.deliveryFrom!.getTime()).toBeGreaterThan(original.deliveryFrom!.getTime())
    })
  })
})

describe('validateEstimateMinutes', () => {
  it('accepts valid minutes (5-180)', () => {
    expect(validateEstimateMinutes(5)).toBeNull()
    expect(validateEstimateMinutes(25)).toBeNull()
    expect(validateEstimateMinutes(180)).toBeNull()
  })

  it('rejects less than 5 minutes', () => {
    expect(validateEstimateMinutes(4)).toContain('5 minút')
    expect(validateEstimateMinutes(0)).toContain('5 minút')
  })

  it('rejects more than max minutes', () => {
    expect(validateEstimateMinutes(181)).toContain('180 minút')
    expect(validateEstimateMinutes(999)).toContain('180 minút')
  })

  it('rejects non-finite values', () => {
    expect(validateEstimateMinutes(NaN)).toContain('Neplatný')
    expect(validateEstimateMinutes(Infinity)).toContain('Neplatný')
  })

  it('accepts custom max', () => {
    expect(validateEstimateMinutes(60, 60)).toBeNull()
    expect(validateEstimateMinutes(61, 60)).toContain('60 minút')
  })
})

describe('getMinutesUntilReady', () => {
  it('returns positive minutes when ready is in future', () => {
    const now = new Date('2025-06-18T15:00:00Z')
    const ready = new Date('2025-06-18T15:17:00Z')
    expect(getMinutesUntilReady(ready, now)).toBe(17)
  })

  it('returns negative minutes when overdue', () => {
    const now = new Date('2025-06-18T15:10:00Z')
    const ready = new Date('2025-06-18T15:05:00Z')
    expect(getMinutesUntilReady(ready, now)).toBe(-5)
  })

  it('returns null when no estimatedReadyAt', () => {
    expect(getMinutesUntilReady(null, new Date())).toBeNull()
  })
})

describe('formatTime', () => {
  it('formats UTC time as Bratislava local time', () => {
    // 16:35 UTC = 18:35 Bratislava (CEST, UTC+2)
    const date = new Date('2025-06-18T16:35:00Z')
    expect(formatTime(date)).toBe('18:35')
  })

  it('handles midnight', () => {
    const date = new Date('2025-06-18T22:00:00Z') // 00:00 Bratislava
    expect(formatTime(date)).toBe('00:00')
  })
})

describe('QUICK_PRESET_MINUTES', () => {
  it('contains expected presets', () => {
    expect(QUICK_PRESET_MINUTES).toContain(10)
    expect(QUICK_PRESET_MINUTES).toContain(15)
    expect(QUICK_PRESET_MINUTES).toContain(25)
    expect(QUICK_PRESET_MINUTES).toContain(60)
  })
})

describe('PUBLIC_DELAY_LABELS', () => {
  it('has Slovak labels for all delay reasons', () => {
    expect(PUBLIC_DELAY_LABELS.HIGH_DEMAND).toBe('zvýšený počet objednávok')
    expect(PUBLIC_DELAY_LABELS.TRAFFIC).toBe('aktuálna dopravná situácia')
    expect(PUBLIC_DELAY_LABELS.OTHER).toBe('neočakávané zdržanie')
  })
})

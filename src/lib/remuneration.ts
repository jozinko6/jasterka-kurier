/**
 * Remuneration calculation engine.
 *
 * Pure domain functions that compute earning components for a single delivery
 * based on a snapshot of remuneration rules. All inputs are plain data — no
 * database access — so the engine is trivially unit-testable.
 *
 * All monetary values are integer cents. Percentage values use basis points
 * (1 bp = 0.01%, so 100% = 10000 bp) to avoid float drift.
 */

import type {
  EarningEntryType,
  RemunerationRuleType,
  RuleValueType,
} from '@prisma/client'

// ─── Types ───

export interface RemunerationRuleSnapshot {
  ruleType: RemunerationRuleType
  valueType: RuleValueType
  valueCents: number
  valueBasisPoints: number
  conditionJson?: string | null
  priority: number
}

export interface ZoneCompensationSnapshot {
  zoneId: string
  zoneName: string
  bonusCents: number
}

export interface PeakPeriodSnapshot {
  dayOfWeek: number // 0=Sun ... 6=Sat
  startTime: string // HH:mm
  endTime: string // HH:mm (can be < startTime for overnight)
  bonusCents: number
}

export interface CourierRateOverrideSnapshot {
  ruleType: RemunerationRuleType
  valueType: RuleValueType
  valueCents: number
  valueBasisPoints: number
}

export interface RemunerationPlanSnapshot {
  planId: string
  planName: string
  versionNumber: number
  currency: string
  rules: RemunerationRuleSnapshot[]
  zoneRules: ZoneCompensationSnapshot[]
  peakRules: PeakPeriodSnapshot[]
}

export interface OrderCompensationInput {
  orderId: string
  orderNumber: string
  courierId: string
  zoneId?: string | null
  /** Distance from courier's last known position to the store, in meters. */
  courierToStoreMeters?: number
  /** Distance from store to customer, in meters. */
  storeToCustomerMeters?: number
  /** Total delivery distance in meters (courier→store→customer). */
  totalDistanceMeters?: number
  /** Number of orders in the same route (stacked delivery). */
  multiOrderCount?: number
  /** ISO timestamp of pickup (for waiting time). */
  pickedUpAt?: Date | string
  /** ISO timestamp of delivery (for waiting time). */
  deliveredAt?: Date | string
  /** Whether the order was cancelled (for cancellation compensation). */
  isCancelled?: boolean
  /** Whether the weather was bad (manually flagged). */
  isBadWeather?: boolean
  /** Tip amount in cents (entered by customer, not computed). */
  tipCents?: number
  /** When the delivery occurred (for peak/weekend/holiday detection). */
  occurredAt: Date
  /** Override rules for this specific courier (applied on top of plan). */
  courierOverrides?: CourierRateOverrideSnapshot[]
}

export interface EarningComponent {
  type: EarningEntryType
  amountCents: number
  description: string
  metadata?: Record<string, unknown>
}

export interface RemunerationCalculationResult {
  components: EarningComponent[]
  totalCents: number
  planSnapshot: RemunerationPlanSnapshot
}

// ─── Helpers ───

/** Find the active rule for a given type from the snapshot, respecting priority. */
function findRule(
  snapshot: RemunerationPlanSnapshot,
  ruleType: RemunerationRuleType,
  overrides?: CourierRateOverrideSnapshot[]
): RemunerationRuleSnapshot | CourierRateOverrideSnapshot | null {
  // Individual override takes precedence over plan rule.
  const override = overrides?.find((r) => r.ruleType === ruleType)
  if (override) return override

  const rules = snapshot.rules
    .filter((r) => r.ruleType === ruleType)
    .sort((a, b) => b.priority - a.priority)
  return rules[0] ?? null
}

/** Get the fixed-cent value from a rule (regardless of override or plan rule). */
function fixedCents(
  rule: RemunerationRuleSnapshot | CourierRateOverrideSnapshot | null
): number {
  if (!rule) return 0
  return rule.valueType === 'FIXED_CENTS' ? rule.valueCents : 0
}

/** Apply a percentage (in basis points) to a base amount in cents. */
function applyBasisPoints(baseCents: number, basisPoints: number): number {
  // Integer-safe: (baseCents * basisPoints + 5000) / 10000 with rounding
  return Math.round((baseCents * basisPoints) / 10000)
}

/** Check if a date falls inside a peak period (handles overnight intervals). */
export function isPeakNow(
  date: Date,
  peakRules: PeakPeriodSnapshot[]
): PeakPeriodSnapshot | null {
  // Convert to Bratislava wall-clock time
  const local = new Date(date.getTime() + getBratislavaOffsetMs(date))
  const day = local.getUTCDay() // 0=Sun ... 6=Sat
  const hh = local.getUTCHours().toString().padStart(2, '0')
  const mm = local.getUTCMinutes().toString().padStart(2, '0')
  const nowMinutes = parseInt(hh) * 60 + parseInt(mm)

  for (const peak of peakRules) {
    if (peak.dayOfWeek !== day) continue
    if (peak.bonusCents === 0) continue
    const [startH, startM] = peak.startTime.split(':').map(Number)
    const [endH, endM] = peak.endTime.split(':').map(Number)
    const startMinutes = startH * 60 + startM
    const endMinutes = endH * 60 + endM
    if (endMinutes >= startMinutes) {
      if (nowMinutes >= startMinutes && nowMinutes < endMinutes) return peak
    } else {
      // Overnight: e.g. 22:00–02:00
      if (nowMinutes >= startMinutes || nowMinutes < endMinutes) return peak
    }
  }
  return null
}

/** Check if a date is a weekend day (Saturday or Sunday) in Bratislava timezone. */
export function isWeekend(date: Date): boolean {
  // Convert to Bratislava wall-clock time to get the correct day of week
  const local = new Date(date.getTime() + getBratislavaOffsetMs(date))
  const day = local.getUTCDay()
  return day === 0 || day === 6
}

/**
 * Check if a date is a Slovak public holiday.
 * Fixed-date holidays + Easter (computed via Gauss's algorithm).
 * Uses Bratislava timezone to determine the calendar date.
 */
export function isSlovakHoliday(date: Date): boolean {
  const local = new Date(date.getTime() + getBratislavaOffsetMs(date))
  const month = local.getUTCMonth() + 1
  const day = local.getUTCDate()
  // Fixed holidays
  const fixed: Array<[number, number]> = [
    [1, 1], // Nový rok / Deň vzniku SR
    [1, 6], // Zjavenie Pána / Traja králi
    [5, 1], // Sviatok práce
    [5, 8], // Deň víťazstva nad fašizmom
    [7, 5], // Sviatok svätého Cyrila a Metoda
    [8, 29], // Výročie SNP
    [9, 1], // Ústava SR
    [9, 15], // Sviatok Panny Márie Sedembolestnej
    [11, 1], // Sviatok všetkých svätých
    [11, 17], // Deň boja za slobodu a demokraciu
    [12, 24], // Štedrý deň
    [12, 25], // Prvý sviatok vianočný
    [12, 26], // Druhý sviatok vianočný
  ]
  for (const [m, d] of fixed) {
    if (m === month && d === day) return true
  }
  // Easter Monday (Veľkonočný pondelok) = Easter Sunday + 1
  const year = local.getUTCFullYear()
  const easter = computeEaster(year)
  // computeEaster returns Easter Sunday; Easter Monday is the next day
  const easterMondayDay = easter.day + 1
  const easterMondayMonth = easter.month
  // Handle day overflow (e.g. Easter March 31 → Easter Monday April 1)
  const daysInEasterMonth = new Date(Date.UTC(year, easter.month, 0)).getUTCDate()
  let actualMondayDay = easterMondayDay
  let actualMondayMonth = easterMondayMonth
  if (easterMondayDay > daysInEasterMonth) {
    actualMondayDay = 1
    actualMondayMonth = easter.month + 1
  }
  if (actualMondayMonth === month && actualMondayDay === day) return true

  // Good Friday (Veľký piatok) = Easter - 2
  const goodFridayDay = easter.day - 2
  const goodFridayMonth = easter.month
  // Handle day underflow (e.g. Easter April 1 → Good Friday March 30)
  if (goodFridayDay < 1) {
    const prevMonthDays = new Date(Date.UTC(year, easter.month - 1, 0)).getUTCDate()
    if (goodFridayMonth - 1 === month && prevMonthDays + goodFridayDay === day) {
      return true
    }
  } else if (goodFridayMonth === month && goodFridayDay === day) {
    return true
  }
  return false
}

/**
 * Get the Bratislava timezone offset in milliseconds for a given date.
 * Handles DST: CET (UTC+1) in winter, CEST (UTC+2) in summer.
 */
function getBratislavaOffsetMs(date: Date): number {
  // Use Intl API to get the offset for Europe/Bratislava
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Bratislava',
    timeZoneName: 'shortOffset',
  })
  const parts = formatter.formatToParts(date)
  const offsetPart = parts.find((p) => p.type === 'timeZoneName')
  if (offsetPart) {
    const match = offsetPart.value.match(/GMT([+-])(\d{1,2}):?(\d{2})?/)
    if (match) {
      const sign = match[1] === '+' ? 1 : -1
      const hours = parseInt(match[2], 10)
      const minutes = match[3] ? parseInt(match[3], 10) : 0
      return sign * (hours * 60 + minutes) * 60 * 1000
    }
  }
  // Fallback: UTC+1 (CET) — should not happen in practice
  return 60 * 60 * 1000
}

/** Compute Easter Sunday for a given year using Gauss's algorithm. */
function computeEaster(year: number): { month: number; day: number } {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return { month, day }
}

// ─── Main calculation ───

/**
 * Compute all earning components for a single order based on a remuneration
 * plan snapshot. This is a PURE function — it does not touch the database.
 *
 * The caller is responsible for:
 * 1. Loading the correct plan version (effective at order time).
 * 2. Storing the result immutably in EarningLedgerEntry.
 * 3. Ensuring idempotency (one set of entries per order).
 */
export function calculateOrderRemuneration(
  plan: RemunerationPlanSnapshot,
  input: OrderCompensationInput
): RemunerationCalculationResult {
  const components: EarningComponent[] = []
  const overrides = input.courierOverrides ?? []
  const occurredAt = new Date(input.occurredAt)

  // 1. Delivery base fee
  const deliveryBaseRule = findRule(plan, 'DELIVERY_BASE', overrides)
  const deliveryBaseCents = fixedCents(deliveryBaseRule)
  if (deliveryBaseCents > 0) {
    components.push({
      type: 'DELIVERY_BASE',
      amountCents: deliveryBaseCents,
      description: 'Základná odmena za doručenie',
      metadata: { ruleType: 'DELIVERY_BASE' },
    })
  }

  // 2. Pickup fee
  const pickupRule = findRule(plan, 'PICKUP_FEE', overrides)
  const pickupCents = fixedCents(pickupRule)
  if (pickupCents > 0) {
    components.push({
      type: 'PICKUP_FEE',
      amountCents: pickupCents,
      description: 'Odmena za vyzdvihnutie',
    })
  }

  // 3. Dropoff fee
  const dropoffRule = findRule(plan, 'DROPOFF_FEE', overrides)
  const dropoffCents = fixedCents(dropoffRule)
  if (dropoffCents > 0) {
    components.push({
      type: 'DROPOFF_FEE',
      amountCents: dropoffCents,
      description: 'Odmena za odovzdanie',
    })
  }

  // 4. Per-kilometer fee (based on total distance)
  const perKmRule = findRule(plan, 'PER_KILOMETER', overrides)
  if (perKmRule && perKmRule.valueType === 'PER_KILOMETER_CENTS' && input.totalDistanceMeters) {
    const km = input.totalDistanceMeters / 1000
    const perKmCents = perKmRule.valueCents
    const distanceCents = Math.round(perKmCents * km)
    if (distanceCents > 0) {
      components.push({
        type: 'DELIVERY_DISTANCE',
        amountCents: distanceCents,
        description: `Odmena za vzdialenosť (${km.toFixed(2)} km)`,
        metadata: { km: km.toFixed(2), perKmCents },
      })
    }
  }

  // 5. Courier-to-store distance
  const c2sRule = findRule(plan, 'COURIER_TO_STORE_DISTANCE', overrides)
  if (c2sRule && c2sRule.valueType === 'PER_KILOMETER_CENTS' && input.courierToStoreMeters) {
    const km = input.courierToStoreMeters / 1000
    const c2sCents = Math.round(c2sRule.valueCents * km)
    if (c2sCents > 0) {
      components.push({
        type: 'PICKUP_DISTANCE',
        amountCents: c2sCents,
        description: `Vzdialenosť k prevádzke (${km.toFixed(2)} km)`,
        metadata: { km: km.toFixed(2) },
      })
    }
  }

  // 6. Store-to-customer distance
  const s2cRule = findRule(plan, 'STORE_TO_CUSTOMER_DISTANCE', overrides)
  if (s2cRule && s2cRule.valueType === 'PER_KILOMETER_CENTS' && input.storeToCustomerMeters) {
    const km = input.storeToCustomerMeters / 1000
    const s2cCents = Math.round(s2cRule.valueCents * km)
    if (s2cCents > 0) {
      components.push({
        type: 'DELIVERY_DISTANCE',
        amountCents: s2cCents,
        description: `Vzdialenosť k zákazníkovi (${km.toFixed(2)} km)`,
        metadata: { km: km.toFixed(2) },
      })
    }
  }

  // 7. Zone bonus
  if (input.zoneId) {
    const zoneRule = plan.zoneRules.find((z) => z.zoneId === input.zoneId && z.bonusCents > 0)
    if (zoneRule) {
      components.push({
        type: 'ZONE_BONUS',
        amountCents: zoneRule.bonusCents,
        description: `Bonus za zónu: ${zoneRule.zoneName}`,
        metadata: { zoneId: zoneRule.zoneId },
      })
    }
  }

  // 8. Peak bonus
  const peak = isPeakNow(occurredAt, plan.peakRules)
  if (peak) {
    components.push({
      type: 'PEAK_BONUS',
      amountCents: peak.bonusCents,
      description: `Bonus za špičku (${peak.startTime}–${peak.endTime})`,
      metadata: { dayOfWeek: peak.dayOfWeek },
    })
  }

  // 9. Weekend bonus
  const weekendRule = findRule(plan, 'WEEKEND_BONUS', overrides)
  const weekendCents = fixedCents(weekendRule)
  if (weekendCents > 0 && isWeekend(occurredAt)) {
    components.push({
      type: 'WEEKEND_BONUS',
      amountCents: weekendCents,
      description: 'Víkendový bonus',
    })
  }

  // 10. Holiday bonus
  const holidayRule = findRule(plan, 'HOLIDAY_BONUS', overrides)
  const holidayCents = fixedCents(holidayRule)
  if (holidayCents > 0 && isSlovakHoliday(occurredAt)) {
    components.push({
      type: 'HOLIDAY_BONUS',
      amountCents: holidayCents,
      description: 'Sviatočný bonus',
    })
  }

  // 11. Weather bonus
  const weatherRule = findRule(plan, 'WEATHER_BONUS', overrides)
  const weatherCents = fixedCents(weatherRule)
  if (weatherCents > 0 && input.isBadWeather) {
    components.push({
      type: 'WEATHER_BONUS',
      amountCents: weatherCents,
      description: 'Bonus za zlé počasie',
    })
  }

  // 12. Multi-order bonus
  const multiRule = findRule(plan, 'MULTI_ORDER_BONUS', overrides)
  const multiCents = fixedCents(multiRule)
  if (multiCents > 0 && (input.multiOrderCount ?? 0) > 1) {
    const extraOrders = (input.multiOrderCount ?? 1) - 1
    const totalMulti = multiCents * extraOrders
    components.push({
      type: 'MULTI_ORDER_BONUS',
      amountCents: totalMulti,
      description: `Bonus za viac objednávok v trase (${extraOrders} extra)`,
      metadata: { extraOrders, perOrder: multiCents },
    })
  }

  // 13. Cancellation compensation
  if (input.isCancelled) {
    const cancelRule = findRule(plan, 'CANCELLATION_COMPENSATION', overrides)
    const cancelCents = fixedCents(cancelRule)
    if (cancelCents > 0) {
      components.push({
        type: 'CANCELLATION_COMPENSATION',
        amountCents: cancelCents,
        description: 'Kompenzácia za zrušenú objednávku',
      })
    }
  }

  // 14. Tip (passed through, not computed from rules)
  if ((input.tipCents ?? 0) > 0) {
    components.push({
      type: 'TIP',
      amountCents: input.tipCents!,
      description: 'Prepitné od zákazníka',
    })
  }

  // 15. Minimum per order guarantee
  const minRule = findRule(plan, 'MINIMUM_PER_ORDER', overrides)
  const minCents = fixedCents(minRule)
  if (minCents > 0) {
    const sumSoFar = components.reduce((s, c) => s + c.amountCents, 0)
    if (sumSoFar < minCents) {
      const topUp = minCents - sumSoFar
      components.push({
        type: 'DELIVERY_BASE',
        amountCents: topUp,
        description: `Doplnenie na minimálnu odmenu`,
        metadata: { minimumCents: minCents, sumBefore: sumSoFar },
      })
    }
  }

  const totalCents = components.reduce((s, c) => s + c.amountCents, 0)

  return {
    components,
    totalCents,
    planSnapshot: plan,
  }
}

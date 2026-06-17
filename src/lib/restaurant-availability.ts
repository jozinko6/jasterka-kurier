/**
 * Restaurant availability domain function.
 *
 * Pure, testable function that determines whether the restaurant is currently
 * accepting orders, based on:
 * - RestaurantSettings.isOpen (manual kill switch)
 * - deliveryEnabled / pickupEnabled (channel toggles)
 * - OpeningHours for the current day in Europe/Bratislava
 * - Overnight intervals (close time < open time → spans midnight)
 *
 * All time comparisons use Europe/Bratislava wall-clock time.
 */

import { toBratislava } from '@/lib/timezone'

export interface RestaurantSettingsInput {
  isOpen: boolean
  deliveryEnabled: boolean
  pickupEnabled: boolean
}

export interface OpeningHoursInput {
  dayOfWeek: number // 0=Sun ... 6=Sat
  openTime: string | null // HH:mm
  closeTime: string | null // HH:mm
  isClosed: boolean
}

export interface AvailabilityResult {
  open: boolean
  reason?: string
  deliveryAvailable: boolean
  pickupAvailable: boolean
  /** Current day's opening hours (in Bratislava time). */
  todayHours: OpeningHoursInput | null
  /** If currently in an overnight interval, the hours entry that opened it. */
  activeHoursEntry: OpeningHoursInput | null
}

/**
 * Determine if the restaurant is open at `now`, and whether delivery/pickup
 * channels are available.
 *
 * Handles overnight intervals: if closeTime <= openTime, the interval spans
 * midnight (e.g. 22:00–02:00). In that case, the restaurant is also considered
 * open during the early hours of the next day.
 */
export function getRestaurantAvailability(
  now: Date,
  settings: RestaurantSettingsInput,
  openingHours: OpeningHoursInput[]
): AvailabilityResult {
  // Manual kill switch
  if (!settings.isOpen) {
    return {
      open: false,
      reason: 'Reštaurácia je momentálne zatvorená.',
      deliveryAvailable: false,
      pickupAvailable: false,
      todayHours: null,
      activeHoursEntry: null,
    }
  }

  const local = toBratislava(now)
  const todayDow = local.getUTCDay()
  const hh = local.getUTCHours().toString().padStart(2, '0')
  const mm = local.getUTCMinutes().toString().padStart(2, '0')
  const nowMinutes = parseInt(hh) * 60 + parseInt(mm)

  const todayHours = openingHours.find((o) => o.dayOfWeek === todayDow) ?? null

  // Check if currently within an open interval.
  // Two cases:
  // 1. Today's hours with openTime <= closeTime (same-day interval)
  // 2. Today's hours with openTime > closeTime (overnight — we're in the early
  //    part of the next day, so check YESTERDAY's hours)
  let activeHoursEntry: OpeningHoursInput | null = null

  // Case 1: today's regular interval
  if (todayHours && !todayHours.isClosed && todayHours.openTime && todayHours.closeTime) {
    const [oH, oM] = todayHours.openTime.split(':').map(Number)
    const [cH, cM] = todayHours.closeTime.split(':').map(Number)
    const openMin = oH * 60 + oM
    const closeMin = cH * 60 + cM
    if (closeMin > openMin) {
      // Same-day interval
      if (nowMinutes >= openMin && nowMinutes < closeMin) {
        activeHoursEntry = todayHours
      }
    }
    // Overnight intervals handled in case 2 (we check yesterday's entry)
  }

  // Case 2: overnight — check yesterday's entry
  if (!activeHoursEntry) {
    const yesterdayDow = (todayDow + 6) % 7
    const yesterdayHours = openingHours.find((o) => o.dayOfWeek === yesterdayDow) ?? null
    if (yesterdayHours && !yesterdayHours.isClosed && yesterdayHours.openTime && yesterdayHours.closeTime) {
      const [oH, oM] = yesterdayHours.openTime.split(':').map(Number)
      const [cH, cM] = yesterdayHours.closeTime.split(':').map(Number)
      const openMin = oH * 60 + oM
      const closeMin = cH * 60 + cM
      if (closeMin <= openMin) {
        // Overnight: open from yesterday's openTime through today's closeMin
        if (nowMinutes < closeMin) {
          activeHoursEntry = yesterdayHours
        }
      }
    }
  }

  if (!activeHoursEntry) {
    return {
      open: false,
      reason: 'Mimo otváracích hodín.',
      deliveryAvailable: false,
      pickupAvailable: false,
      todayHours,
      activeHoursEntry: null,
    }
  }

  return {
    open: true,
    deliveryAvailable: settings.deliveryEnabled,
    pickupAvailable: settings.pickupEnabled,
    todayHours,
    activeHoursEntry,
  }
}

/**
 * Payment method validation matrix.
 *
 * - DELIVERY: CASH, CARD_ON_DELIVERY
 * - PICKUP: CASH, CARD_ON_PICKUP
 * - ONLINE_CARD: NOT implemented end-to-end; rejected for both order types.
 *
 * Returns true if the combination is valid.
 */
export function isValidPaymentForOrderType(
  orderType: 'DELIVERY' | 'PICKUP',
  paymentMethod: string
): boolean {
  if (paymentMethod === 'ONLINE_CARD') {
    // Not implemented end-to-end — reject to avoid promising unsupported payment
    return false
  }
  if (orderType === 'DELIVERY') {
    return paymentMethod === 'CASH' || paymentMethod === 'CARD_ON_DELIVERY'
  }
  if (orderType === 'PICKUP') {
    return paymentMethod === 'CASH' || paymentMethod === 'CARD_ON_PICKUP'
  }
  return false
}

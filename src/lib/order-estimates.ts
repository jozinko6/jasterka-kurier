/**
 * Order estimate and ETA calculation.
 *
 * Centralized function for computing customer-facing ETA windows.
 * All dates are stored as UTC; UI display uses Europe/Bratislava.
 *
 * Priority of ETA sources:
 * 1. Real courier ETA (future — not yet implemented)
 * 2. ON_THE_WAY + zone estimated delivery minutes
 * 3. Actual readyAt + zone estimated delivery minutes
 * 4. Kitchen estimatedReadyAt + zone estimated delivery minutes
 * 5. System default (settings.defaultKitchenPrepMinutes)
 */

import type { EstimateStatus, EstimateSource, OrderStatus, OrderType, PublicDelayReason } from '@prisma/client'

export interface CustomerEtaInput {
  orderType: OrderType
  orderStatus: OrderStatus
  estimatedReadyAt: Date | null
  actualReadyAt: Date | null
  zoneDeliveryMinutes: number | null
  beforeBufferMinutes: number
  afterBufferMinutes: number
  defaultPrepMinutes: number
  /** Future: real courier ETA (not yet implemented) */
  courierEtaAt?: Date | null
  now?: Date
}

export interface CustomerEtaResult {
  estimatedReadyAt: Date | null
  deliveryFrom: Date | null
  deliveryTo: Date | null
  status: EstimateStatus
  source: EstimateSource
  /** Human-readable Slovak labels for UI */
  readyLabel: string | null
  deliveryLabel: string | null
}

/**
 * Calculate the customer-facing ETA window.
 *
 * For PICKUP: no delivery window — only ready time.
 * For DELIVERY: ready time + zone delivery time ± buffer.
 */
export function calculateCustomerEtaWindow(input: CustomerEtaInput): CustomerEtaResult {
  const now = input.now ?? new Date()

  // Terminal states — no ETA
  if (input.orderStatus === 'CANCELLED' || input.orderStatus === 'REFUNDED') {
    return {
      estimatedReadyAt: null,
      deliveryFrom: null,
      deliveryTo: null,
      status: 'CANCELLED',
      source: 'SYSTEM_DEFAULT',
      readyLabel: null,
      deliveryLabel: null,
    }
  }

  if (input.orderStatus === 'DELIVERED') {
    return {
      estimatedReadyAt: input.actualReadyAt,
      deliveryFrom: null,
      deliveryTo: null,
      status: 'COMPLETED',
      source: 'SYSTEM_DEFAULT',
      readyLabel: input.actualReadyAt ? formatTime(input.actualReadyAt) : null,
      deliveryLabel: null,
    }
  }

  // READY — use actual readyAt
  if (input.orderStatus === 'READY' || input.orderStatus === 'WAITING_FOR_COURIER') {
    const readyAt = input.actualReadyAt ?? input.estimatedReadyAt
    const result = buildDeliveryWindow(
      readyAt,
      input,
      'READY',
      input.actualReadyAt ? 'SYSTEM_RECALCULATION' : 'KITCHEN_MANUAL'
    )
    return result
  }

  // Courier has picked up or is on the way
  if (input.orderStatus === 'PICKED_UP' || input.orderStatus === 'ON_THE_WAY') {
    const readyAt = input.actualReadyAt ?? input.estimatedReadyAt
    const result = buildDeliveryWindow(
      readyAt,
      input,
      'ON_THE_WAY',
      'COURIER_UPDATE'
    )
    return result
  }

  // ASSIGNED_TO_COURIER — courier assigned, waiting for pickup
  if (input.orderStatus === 'ASSIGNED_TO_COURIER') {
    const readyAt = input.actualReadyAt ?? input.estimatedReadyAt
    const result = buildDeliveryWindow(
      readyAt,
      input,
      'CONFIRMED',
      input.actualReadyAt ? 'SYSTEM_RECALCULATION' : 'KITCHEN_MANUAL'
    )
    return result
  }

  // Kitchen states: NEW, ACCEPTED, IN_KITCHEN, PREPARING
  if (input.estimatedReadyAt) {
    // Kitchen has set an estimate
    const status: EstimateStatus = input.orderStatus === 'NEW' ? 'ESTIMATED' : 'ESTIMATED'
    const result = buildDeliveryWindow(
      input.estimatedReadyAt,
      input,
      status,
      'KITCHEN_MANUAL'
    )
    return result
  }

  // No estimate set yet — waiting for kitchen
  return {
    estimatedReadyAt: null,
    deliveryFrom: null,
    deliveryTo: null,
    status: 'WAITING_FOR_KITCHEN',
    source: 'SYSTEM_DEFAULT',
    readyLabel: null,
    deliveryLabel: null,
  }
}

function buildDeliveryWindow(
  readyAt: Date | null,
  input: CustomerEtaInput,
  status: EstimateStatus,
  source: EstimateSource
): CustomerEtaResult {
  if (!readyAt) {
    return {
      estimatedReadyAt: null,
      deliveryFrom: null,
      deliveryTo: null,
      status,
      source,
      readyLabel: null,
      deliveryLabel: null,
    }
  }

  // PICKUP — no delivery window
  if (input.orderType === 'PICKUP') {
    return {
      estimatedReadyAt: readyAt,
      deliveryFrom: null,
      deliveryTo: null,
      status,
      source,
      readyLabel: formatTime(readyAt),
      deliveryLabel: null,
    }
  }

  // DELIVERY — compute window
  const zoneMinutes = input.zoneDeliveryMinutes ?? 30
  const estimatedDelivery = new Date(readyAt.getTime() + zoneMinutes * 60 * 1000)

  const deliveryFrom = new Date(estimatedDelivery.getTime() - input.beforeBufferMinutes * 60 * 1000)
  const deliveryTo = new Date(estimatedDelivery.getTime() + input.afterBufferMinutes * 60 * 1000)

  return {
    estimatedReadyAt: readyAt,
    deliveryFrom,
    deliveryTo,
    status,
    source,
    readyLabel: formatTime(readyAt),
    deliveryLabel: `${formatTime(deliveryFrom)} – ${formatTime(deliveryTo)}`,
  }
}

/**
 * Format a UTC Date as Bratislava wall-clock time (HH:mm).
 */
export function formatTime(date: Date): string {
  const bratislava = new Date(date.getTime() + getBratislavaOffsetMs(date))
  const h = bratislava.getUTCHours().toString().padStart(2, '0')
  const m = bratislava.getUTCMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

/**
 * Format a UTC Date as Bratislava wall-clock date + time (dd.MM HH:mm).
 */
export function formatDateTime(date: Date): string {
  const bratislava = new Date(date.getTime() + getBratislavaOffsetMs(date))
  const d = bratislava.getUTCDate().toString().padStart(2, '0')
  const mo = (bratislava.getUTCMonth() + 1).toString().padStart(2, '0')
  const h = bratislava.getUTCHours().toString().padStart(2, '0')
  const m = bratislava.getUTCMinutes().toString().padStart(2, '0')
  return `${d}.${mo}. ${h}:${m}`
}

/**
 * Calculate remaining minutes until ready (can be negative if overdue).
 */
export function getMinutesUntilReady(estimatedReadyAt: Date | null, now: Date = new Date()): number | null {
  if (!estimatedReadyAt) return null
  return Math.round((estimatedReadyAt.getTime() - now.getTime()) / 60000)
}

/**
 * Slovak labels for delay reasons (public-facing, user-friendly).
 */
export const PUBLIC_DELAY_LABELS: Record<PublicDelayReason, string> = {
  HIGH_DEMAND: 'zvýšený počet objednávok',
  COMPLEX_ORDER: 'náročnejšia príprava objednávky',
  INGREDIENT_DELAY: 'krátke zdržanie pri príprave',
  COURIER_DELAY: 'čakanie na kuriéra',
  TRAFFIC: 'aktuálna dopravná situácia',
  OTHER: 'neočakávané zdržanie',
}

/**
 * Slovak labels for estimate status.
 */
export const ESTIMATE_STATUS_LABELS: Record<EstimateStatus, string> = {
  WAITING_FOR_KITCHEN: 'Čakáme na potvrdenie času kuchyňou',
  ESTIMATED: 'Čas bol nastavený',
  CONFIRMED: 'Potvrdené',
  DELAYED: 'Meškanie',
  READY: 'Pripravené',
  ON_THE_WAY: 'Na ceste',
  COMPLETED: 'Dokončené',
  CANCELLED: 'Zrušené',
}

/**
 * Quick preset minutes for kitchen UI.
 */
export const QUICK_PRESET_MINUTES = [10, 15, 20, 25, 30, 40, 45, 60] as const

/**
 * Validate estimate minutes.
 * Returns null if valid, or an error message in Slovak.
 */
export function validateEstimateMinutes(
  minutes: number,
  maxMinutes: number = 180
): string | null {
  if (!Number.isFinite(minutes)) return 'Neplatný počet minút'
  if (minutes < 5) return 'Minimálny čas prípravy je 5 minút'
  if (minutes > maxMinutes) return `Maximálny čas prípravy je ${maxMinutes} minút`
  return null
}

/**
 * Get the Bratislava timezone offset in milliseconds for a given date.
 * Handles DST: CET (UTC+1) in winter, CEST (UTC+2) in summer.
 */
function getBratislavaOffsetMs(date: Date): number {
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
  return 60 * 60 * 1000 // Fallback: UTC+1 (CET)
}

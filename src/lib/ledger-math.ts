/**
 * Centralized ledger mathematics.
 *
 * Single source of truth for computing net ledger totals. Used by:
 * - courier dashboard
 * - earnings endpoint
 * - payout period calculation
 * - self-billing invoice
 * - agreement statement
 * - admin dashboard
 *
 * NEVER compute ledger totals with ad-hoc `status: 'CONFIRMED', type: { not: 'REVERSAL' }`
 * filters — always use these functions.
 *
 * Accounting model:
 * - Original confirmed entry stays in the accounting sum
 * - Reversal is a new negative confirmed entry
 * - Reversed entries (status = 'REVERSED') are EXCLUDED from the net sum
 *   because they have been offset by a REVERSAL entry
 * - Net = sum of (CONFIRMED entries that are not REVERSED) + (REVERSAL entries)
 *   = sum of all CONFIRMED entries excluding those with status REVERSED
 *
 * This means:
 * - Original +200 (CONFIRMED) → net = +200
 * - Reversal −200 (CONFIRMED, type=REVERSAL) → original stays CONFIRMED but
 *   we mark it REVERSED, so net = 0 (original excluded, reversal excluded)
 *   OR: original stays CONFIRMED, reversal is CONFIRMED → net = +200 + (−200) = 0
 *
 * We use the second model: REVERSAL entries are CONFIRMED and negative.
 * Originals stay CONFIRMED. Net = sum of ALL CONFIRMED entries.
 * The `status = 'REVERSED'` flag is just a marker — it does NOT exclude from sum.
 */

import { db } from '@/lib/db'
import type { Prisma } from '@prisma/client'

export interface LedgerTotals {
  grossEarningsCents: number
  bonusesCents: number
  adjustmentsCents: number
  tipsCents: number
  payableCents: number
  entryCount: number
}

/**
 * Compute net ledger totals for a courier within a date range.
 *
 * This is the SINGLE function that should be used for all earnings calculations.
 * It includes:
 * - All CONFIRMED entries (including REVERSAL type, which are negative)
 * - Excludes PENDING and REVERSED entries
 *
 * The net sum = sum of all CONFIRMED entries (originals + reversals).
 */
export async function calculateLedgerTotals(
  courierId: string,
  from: Date,
  to: Date
): Promise<LedgerTotals> {
  const entries = await db.earningLedgerEntry.findMany({
    where: {
      courierId,
      occurredAt: { gte: from, lt: to },
      status: 'CONFIRMED',
    },
    select: {
      type: true,
      amountCents: true,
    },
  })

  return computeTotalsFromEntries(entries)
}

/**
 * Compute net ledger totals for a payout period.
 * Uses the period's start/end dates.
 */
export async function calculateLedgerTotalsForPeriod(
  payoutPeriodId: string
): Promise<LedgerTotals> {
  const period = await db.payoutPeriod.findUnique({
    where: { id: payoutPeriodId },
    select: { periodStart: true, periodEnd: true, courierId: true },
  })
  if (!period) {
    return {
      grossEarningsCents: 0,
      bonusesCents: 0,
      adjustmentsCents: 0,
      tipsCents: 0,
      payableCents: 0,
      entryCount: 0,
    }
  }

  return calculateLedgerTotals(period.courierId, period.periodStart, period.periodEnd)
}

/**
 * Compute totals from a list of entries (pure function, testable).
 */
export function computeTotalsFromEntries(
  entries: Array<{ type: string; amountCents: number }>
): LedgerTotals {
  let grossEarningsCents = 0
  let bonusesCents = 0
  let adjustmentsCents = 0
  let tipsCents = 0

  const BONUS_TYPES = new Set([
    'ZONE_BONUS', 'PEAK_BONUS', 'WEEKEND_BONUS', 'HOLIDAY_BONUS',
    'WEATHER_BONUS', 'MULTI_ORDER_BONUS', 'MANUAL_BONUS',
  ])

  for (const entry of entries) {
    const amount = entry.amountCents

    if (entry.type === 'MANUAL_ADJUSTMENT') {
      adjustmentsCents += amount
    } else if (entry.type === 'TIP') {
      tipsCents += amount
    } else if (entry.type === 'REVERSAL') {
      // Reversal entries are negative — they reduce the relevant category
      // We add them to adjustments for simplicity
      adjustmentsCents += amount
    } else if (BONUS_TYPES.has(entry.type)) {
      bonusesCents += amount
      grossEarningsCents += amount
    } else {
      // Base earnings (DELIVERY_BASE, PICKUP_FEE, DROPOFF_FEE, distance, etc.)
      grossEarningsCents += amount
    }
  }

  const payableCents = grossEarningsCents + adjustmentsCents + tipsCents

  return {
    grossEarningsCents,
    bonusesCents,
    adjustmentsCents,
    tipsCents,
    payableCents,
    entryCount: entries.length,
  }
}

/**
 * Get all net ledger entries for a courier within a date range.
 * Returns CONFIRMED entries (including REVERSAL type).
 */
export async function getNetLedgerEntries(
  courierId: string,
  from: Date,
  to: Date
): Promise<Array<{
  id: string
  type: string
  amountCents: number
  description: string | null
  occurredAt: Date
  orderId: string | null
  sourceEntryId: string | null
}>> {
  return db.earningLedgerEntry.findMany({
    where: {
      courierId,
      occurredAt: { gte: from, lt: to },
      status: 'CONFIRMED',
    },
    orderBy: { occurredAt: 'desc' },
    select: {
      id: true,
      type: true,
      amountCents: true,
      description: true,
      occurredAt: true,
      orderId: true,
      sourceEntryId: true,
    },
  })
}

/**
 * Compute today's earnings for a courier (Europe/Bratislava timezone).
 */
export async function calculateTodaysEarnings(
  courierId: string,
  todayStart: Date,
  todayEnd: Date
): Promise<{ totalCents: number; deliveryCount: number }> {
  const entries = await db.earningLedgerEntry.findMany({
    where: {
      courierId,
      occurredAt: { gte: todayStart, lt: todayEnd },
      status: 'CONFIRMED',
    },
    select: { type: true, amountCents: true },
  })

  const totalCents = entries.reduce((s, e) => s + e.amountCents, 0)
  const deliveryCount = entries.filter((e) => e.type === 'DELIVERY_BASE').length

  return { totalCents, deliveryCount }
}

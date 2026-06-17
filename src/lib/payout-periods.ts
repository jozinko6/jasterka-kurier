/**
 * Payout period boundary computation.
 *
 * Wraps the timezone utilities to compute period boundaries based on a
 * courier's compensation profile frequency. This module is the single source
 * of truth for "which period does this timestamp belong to?"
 */

import type { PayoutFrequency } from '@prisma/client'
import {
  getWeeklyPeriod,
  getBiweeklyPeriod,
  getMonthlyPeriod,
  type PeriodRange,
} from '@/lib/timezone'

export interface PeriodRangeWithDue extends PeriodRange {
  dueDate: Date
}

export interface PeriodConfig {
  frequency: PayoutFrequency
  payoutWeekday?: number // 0=Sun..6=Sat, default 4 (Thursday)
  monthlyPayoutDay?: number // 1..31, default 15
  anchorDate?: Date // for biweekly
}

/**
 * Get the payout period boundaries that contain `date` for the given config.
 */
export function getBratislavaPeriodForDate(
  date: Date,
  config: PeriodConfig
): PeriodRangeWithDue {
  switch (config.frequency) {
    case 'WEEKLY':
      return getWeeklyPeriod(date, config.payoutWeekday ?? 4, 12)
    case 'BIWEEKLY':
      if (!config.anchorDate) {
        // Default anchor: 2024-01-01 (a Monday)
        return getBiweeklyPeriod(date, new Date('2024-01-01'), config.payoutWeekday ?? 4, 12)
      }
      return getBiweeklyPeriod(date, config.anchorDate, config.payoutWeekday ?? 4, 12)
    case 'MONTHLY':
      return getMonthlyPeriod(date, config.monthlyPayoutDay ?? 15, 12, true)
    default:
      return getWeeklyPeriod(date, config.payoutWeekday ?? 4, 12)
  }
}

/**
 * Generate all payout periods for a courier between `from` and `to` dates.
 * Useful for backfilling or pre-generating periods.
 */
export function generatePeriodsInRange(
  courierId: string,
  from: Date,
  to: Date,
  config: PeriodConfig
): Array<{
  courierId: string
  frequency: PayoutFrequency
  periodStart: Date
  periodEnd: Date
  payoutDueDate: Date
  status: 'OPEN'
}> {
  const periods: Array<{
    courierId: string
    frequency: PayoutFrequency
    periodStart: Date
    periodEnd: Date
    payoutDueDate: Date
    status: 'OPEN'
  }> = []

  let cursor = new Date(from)
  // Safety limit to prevent infinite loops
  let iterations = 0
  const maxIterations = 1000

  while (cursor < to && iterations < maxIterations) {
    iterations++
    const range = getBratislavaPeriodForDate(cursor, config)
    periods.push({
      courierId,
      frequency: config.frequency,
      periodStart: range.start,
      periodEnd: range.end,
      payoutDueDate: range.dueDate,
      status: 'OPEN',
    })
    cursor = new Date(range.end)
  }

  return periods
}

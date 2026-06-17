/**
 * Timezone and payout period utilities.
 *
 * All payout period calculations are done in the Europe/Bratislava timezone.
 * This module wraps date-fns-tz to provide clean, testable functions for
 * computing period boundaries.
 */

import { format, toZonedTime, fromZonedTime } from 'date-fns-tz'

export const BRATISLAVA_TZ = 'Europe/Bratislava'

/**
 * Convert a UTC Date to a Date that represents local Bratislava wall-clock
 * time (for extracting year/month/day/hour components).
 */
export function toBratislava(date: Date): Date {
  return toZonedTime(date, BRATISLAVA_TZ)
}

/**
 * Convert a Bratislava wall-clock time to a UTC Date.
 * `wallClock` should be a Date whose components (y/m/d/h/m/s) are in
 * Bratislava local time, e.g. created via `new Date(2024, 0, 1, 0, 0, 0)`.
 */
export function fromBratislava(wallClock: Date): Date {
  return fromZonedTime(wallClock, BRATISLAVA_TZ)
}

/** Format a date in Bratislava timezone using a date-fns format string. */
export function formatInBratislava(date: Date, fmt: string): string {
  return format(toBratislava(date), fmt)
}

export interface PeriodRange {
  start: Date // UTC, inclusive
  end: Date // UTC, exclusive (i.e. start of next period)
}

/**
 * Compute the weekly payout period that contains `now`.
 * Weeks run Monday 00:00 to Sunday 23:59:59.999 in Bratislava time.
 * `payoutWeekday` (0=Sun..6=Sat) and `payoutHour` determine the due date.
 */
export function getWeeklyPeriod(now: Date, payoutWeekday: number = 4, payoutHour: number = 12): PeriodRange & { dueDate: Date } {
  // Work entirely in Bratislava wall-clock time using UTC getters/setters
  const local = toBratislava(now)
  const dayOfWeek = local.getUTCDay()
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const startWall = new Date(Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate() - daysSinceMonday,
    0, 0, 0, 0
  ))
  const endWall = new Date(startWall)
  endWall.setUTCDate(endWall.getUTCDate() + 7)

  // Due date: next occurrence of payoutWeekday after endWall
  const dueWall = new Date(endWall)
  const daysToAdd = payoutWeekday === 0 ? 6 : payoutWeekday - 1
  dueWall.setUTCDate(endWall.getUTCDate() + daysToAdd)
  dueWall.setUTCHours(payoutHour, 0, 0, 0)

  return {
    start: fromBratislava(startWall),
    end: fromBratislava(endWall),
    dueDate: fromBratislava(dueWall),
  }
}

/**
 * Compute the biweekly (14-day) payout period containing `now`, anchored to
 * `anchorDate`. The period always starts at anchorDate + N*14 days for some
 * integer N, such that the period contains `now`.
 */
export function getBiweeklyPeriod(
  now: Date,
  anchorDate: Date,
  payoutWeekday: number = 4,
  payoutHour: number = 12
): PeriodRange & { dueDate: Date } {
  // Work entirely in Bratislava wall-clock time using UTC getters/setters
  // on the zoned representation. This avoids system-local-time interference.
  const local = toBratislava(now)
  const anchorLocal = toBratislava(anchorDate)

  // Normalize both to midnight (wall-clock) in Bratislava
  const anchorMidnightWall = new Date(Date.UTC(
    anchorLocal.getUTCFullYear(),
    anchorLocal.getUTCMonth(),
    anchorLocal.getUTCDate(),
    0, 0, 0, 0
  ))
  const nowMidnightWall = new Date(Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
    0, 0, 0, 0
  ))

  const diffMs = nowMidnightWall.getTime() - anchorMidnightWall.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))
  const periodIndex = Math.floor(diffDays / 14)

  const startWall = new Date(anchorMidnightWall)
  startWall.setUTCDate(startWall.getUTCDate() + periodIndex * 14)
  const endWall = new Date(startWall)
  endWall.setUTCDate(endWall.getUTCDate() + 14)

  // Due date: payoutWeekday after endWall
  const dueWall = new Date(endWall)
  const endDayOfWeek = dueWall.getUTCDay()
  let daysToAdd = (payoutWeekday - endDayOfWeek + 7) % 7
  if (daysToAdd === 0) daysToAdd = 7
  dueWall.setUTCDate(dueWall.getUTCDate() + daysToAdd)
  dueWall.setUTCHours(payoutHour, 0, 0, 0)

  // Convert wall-clock back to real UTC via fromBratislava
  return {
    start: fromBratislava(startWall),
    end: fromBratislava(endWall),
    dueDate: fromBratislava(dueWall),
  }
}

/**
 * Compute the monthly payout period containing `now`.
 * Periods are calendar months (1st 00:00 to 1st of next month 00:00).
 * `payoutDay` is the day of month for the payout (1..31). If the day doesn't
 * exist (e.g. day 31 in February), the last day of the month is used. If the
 * day falls on a weekend, the payout is moved to the next Monday (configurable
 * via `weekendRollForward`).
 */
export function getMonthlyPeriod(
  now: Date,
  payoutDay: number = 15,
  payoutHour: number = 12,
  weekendRollForward: boolean = true
): PeriodRange & { dueDate: Date } {
  // Work entirely in Bratislava wall-clock time using UTC getters/setters
  const local = toBratislava(now)
  const year = local.getUTCFullYear()
  const month = local.getUTCMonth() // 0-based

  const startWall = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0))
  const endWall = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0))

  // Compute payout day for the NEXT month (after period ends)
  const nextMonth = month + 1
  const nextMonthYear = nextMonth > 11 ? year + 1 : year
  const adjustedMonth = nextMonth % 12
  const daysInNextMonth = new Date(Date.UTC(nextMonthYear, adjustedMonth + 1, 0)).getUTCDate()
  const actualDay = Math.min(payoutDay, daysInNextMonth)

  const dueWall = new Date(Date.UTC(nextMonthYear, adjustedMonth, actualDay, payoutHour, 0, 0, 0))
  if (weekendRollForward) {
    const dueDay = dueWall.getUTCDay()
    if (dueDay === 0) dueWall.setUTCDate(dueWall.getUTCDate() + 1) // Sunday → Monday
    else if (dueDay === 6) dueWall.setUTCDate(dueWall.getUTCDate() + 2) // Saturday → Monday
  }

  return {
    start: fromBratislava(startWall),
    end: fromBratislava(endWall),
    dueDate: fromBratislava(dueWall),
  }
}

/** Get the start and end of "today" in Bratislava time. */
export function getTodayRange(now: Date = new Date()): PeriodRange {
  const local = toBratislava(now)
  const startWall = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), 0, 0, 0, 0))
  const endWall = new Date(startWall)
  endWall.setUTCDate(endWall.getUTCDate() + 1)
  return {
    start: fromBratislava(startWall),
    end: fromBratislava(endWall),
  }
}

/** Get the start and end of the current week (Mon-Sun) in Bratislava. */
export function getThisWeekRange(now: Date = new Date()): PeriodRange {
  const local = toBratislava(now)
  const dayOfWeek = local.getUTCDay()
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const startWall = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate() - daysSinceMonday, 0, 0, 0, 0))
  const endWall = new Date(startWall)
  endWall.setUTCDate(endWall.getUTCDate() + 7)
  return {
    start: fromBratislava(startWall),
    end: fromBratislava(endWall),
  }
}

/** Get the start and end of the current calendar month in Bratislava. */
export function getThisMonthRange(now: Date = new Date()): PeriodRange {
  const local = toBratislava(now)
  const startWall = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), 1, 0, 0, 0, 0))
  const endWall = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth() + 1, 1, 0, 0, 0, 0))
  return {
    start: fromBratislava(startWall),
    end: fromBratislava(endWall),
  }
}

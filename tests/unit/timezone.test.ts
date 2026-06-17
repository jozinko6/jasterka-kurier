import { describe, it, expect } from 'vitest'
import {
  getWeeklyPeriod,
  getBiweeklyPeriod,
  getMonthlyPeriod,
  getTodayRange,
  getThisWeekRange,
  toBratislava,
} from '@/lib/timezone'
import { getBratislavaPeriodForDate } from '@/lib/payout-periods'

// Helper: get day of week in Bratislava timezone
function getDayInBratislava(date: Date): number {
  return toBratislava(date).getDay()
}

// Helper: get date of month in Bratislava timezone
function getDateInBratislava(date: Date): number {
  return toBratislava(date).getDate()
}

// Helper: get month in Bratislava timezone
function getMonthInBratislava(date: Date): number {
  return toBratislava(date).getMonth()
}

describe('timezone utilities', () => {
  describe('getWeeklyPeriod', () => {
    it('returns Monday-Sunday period', () => {
      const wednesday = new Date('2025-06-18T12:00:00Z') // Wednesday June 18, 2025
      const period = getWeeklyPeriod(wednesday, 4, 12)
      // Period should start Monday June 16, end Monday June 23
      expect(getDayInBratislava(period.start)).toBe(1) // Monday
      expect(getDayInBratislava(period.end)).toBe(1) // Monday (next week)
      expect(period.end.getTime() - period.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
    })

    it('due date is on the specified weekday', () => {
      const wednesday = new Date('2025-06-18T12:00:00Z')
      const period = getWeeklyPeriod(wednesday, 4, 12) // Thursday payout
      expect(getDayInBratislava(period.dueDate)).toBe(4) // Thursday
    })
  })

  describe('getBiweeklyPeriod', () => {
    it('returns 14-day period anchored to anchor date', () => {
      const anchor = new Date('2025-01-06T00:00:00Z') // Monday Jan 6
      const testDate = new Date('2025-06-18T12:00:00Z') // Wednesday June 18
      const period = getBiweeklyPeriod(testDate, anchor, 4, 12)
      const periodLength = period.end.getTime() - period.start.getTime()
      expect(periodLength).toBe(14 * 24 * 60 * 60 * 1000)
    })

    it('period start is always a multiple of 14 days from anchor (wall-clock)', () => {
      const anchor = new Date('2025-01-06T00:00:00Z')
      const testDate = new Date('2025-06-18T12:00:00Z')
      const period = getBiweeklyPeriod(testDate, anchor, 4, 12)
      // Compare wall-clock dates (not UTC millis) to avoid timezone offset issues
      const startWall = toBratislava(period.start)
      const anchorWall = toBratislava(anchor)
      const startMidnight = Date.UTC(startWall.getUTCFullYear(), startWall.getUTCMonth(), startWall.getUTCDate())
      const anchorMidnight = Date.UTC(anchorWall.getUTCFullYear(), anchorWall.getUTCMonth(), anchorWall.getUTCDate())
      const daysFromAnchor = Math.floor(
        (startMidnight - anchorMidnight) / (24 * 60 * 60 * 1000)
      )
      expect(daysFromAnchor % 14).toBe(0)
    })
  })

  describe('getMonthlyPeriod', () => {
    it('returns calendar month period', () => {
      const june = new Date('2025-06-15T12:00:00Z')
      const period = getMonthlyPeriod(june, 15, 12)
      expect(getMonthInBratislava(period.start)).toBe(5) // June (0-based)
      expect(getMonthInBratislava(period.end)).toBe(6) // July
      expect(getDateInBratislava(period.end)).toBe(1) // 1st of July
    })

    it('due date is in the next month', () => {
      const june = new Date('2025-06-15T12:00:00Z')
      const period = getMonthlyPeriod(june, 15, 12)
      expect(getMonthInBratislava(period.dueDate)).toBe(6) // July
      expect(getDateInBratislava(period.dueDate)).toBe(15)
    })

    it('handles payout day 31 — uses March 31 when February period pays in March', () => {
      const february = new Date('2025-02-15T12:00:00Z')
      const period = getMonthlyPeriod(february, 31, 12)
      // February period pays in March, which has 31 days, so payout day 31 is valid
      expect(getMonthInBratislava(period.dueDate)).toBe(2) // March
      expect(getDateInBratislava(period.dueDate)).toBe(31)
    })

    it('clamps payout day 31 in March period (pays in April which has 30 days)', () => {
      const march = new Date('2025-03-15T12:00:00Z')
      const period = getMonthlyPeriod(march, 31, 12)
      // March period pays in April, which has 30 days, so 31 clamps to 30
      expect(getMonthInBratislava(period.dueDate)).toBe(3) // April
      expect(getDateInBratislava(period.dueDate)).toBe(30)
    })
  })

  describe('getTodayRange', () => {
    it('returns a 24-hour range', () => {
      const now = new Date('2025-06-18T15:00:00Z')
      const range = getTodayRange(now)
      expect(range.end.getTime() - range.start.getTime()).toBe(24 * 60 * 60 * 1000)
    })
  })

  describe('getThisWeekRange', () => {
    it('returns a 7-day range starting Monday', () => {
      const wednesday = new Date('2025-06-18T12:00:00Z')
      const range = getThisWeekRange(wednesday)
      expect(getDayInBratislava(range.start)).toBe(1) // Monday
      expect(range.end.getTime() - range.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
    })
  })
})

describe('getBratislavaPeriodForDate', () => {
  it('returns weekly period for WEEKLY frequency', () => {
    const date = new Date('2025-06-18T12:00:00Z')
    const period = getBratislavaPeriodForDate(date, {
      frequency: 'WEEKLY',
      payoutWeekday: 4,
    })
    expect(period.end.getTime() - period.start.getTime()).toBe(7 * 24 * 60 * 60 * 1000)
  })

  it('returns biweekly period for BIWEEKLY frequency', () => {
    const date = new Date('2025-06-18T12:00:00Z')
    const period = getBratislavaPeriodForDate(date, {
      frequency: 'BIWEEKLY',
      anchorDate: new Date('2025-01-06T00:00:00Z'),
    })
    expect(period.end.getTime() - period.start.getTime()).toBe(14 * 24 * 60 * 60 * 1000)
  })

  it('returns monthly period for MONTHLY frequency', () => {
    const date = new Date('2025-06-15T12:00:00Z')
    const period = getBratislavaPeriodForDate(date, {
      frequency: 'MONTHLY',
      monthlyPayoutDay: 15,
    })
    expect(getDateInBratislava(period.end)).toBe(1) // Next month start
  })
})

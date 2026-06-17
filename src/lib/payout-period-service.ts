/**
 * Payout period service.
 *
 * Handles the lifecycle of payout periods:
 * - OPEN: entries are being added
 * - CALCULATED: admin has triggered a recalculation
 * - LOCKED: no more entries can be added; corrections go to next period
 * - APPROVED: admin approved the payout
 * - PROCESSING: payment is being sent
 * - PAID: payment confirmed
 * - FAILED: payment failed
 * - CANCELLED: period cancelled
 *
 * After locking, late entries are moved to the next open period.
 * After paying, the period and its entries are immutable.
 */

import { db } from '@/lib/db'
import { recalculatePayoutPeriod } from '@/lib/earning-ledger-service'
import { getBratislavaPeriodForDate } from '@/lib/payout-periods'
import type { PayoutFrequency, PayoutPeriodStatus } from '@prisma/client'

export interface LockResult {
  periodId: string
  status: PayoutPeriodStatus
  lockedAt: Date
  grossEarningsCents: number
  bonusesCents: number
  adjustmentsCents: number
  payableCents: number
  movedEntryCount: number
}

/**
 * Lock a payout period. This:
 * 1. Recalculates totals from confirmed ledger entries
 * 2. Moves any entries that occurred before the period start to... actually
 *    entries after the period end are moved to the next open period
 * 3. Sets status to LOCKED
 * 4. Creates an audit log entry
 *
 * Once locked, new entries cannot be assigned to this period. Corrections
 * must go through reversal + new entry in the next period.
 */
export async function lockPayoutPeriod(
  periodId: string,
  actorUserId: string,
  reason?: string
): Promise<LockResult> {
  const period = await db.payoutPeriod.findUnique({
    where: { id: periodId },
    include: {
      courier: {
        include: {
          activeCompensationProfile: true,
        },
      },
    },
  })

  if (!period) {
    throw new PayoutPeriodError('NOT_FOUND', 'Výplatné obdobie nebolo nájdené')
  }

  if (period.status !== 'OPEN' && period.status !== 'CALCULATED') {
    throw new PayoutPeriodError(
      'INVALID_STATUS',
      `Obdobie nie je možné uzamknúť zo stavu ${period.status}`
    )
  }

  // Find entries that are after the period end (late entries)
  const lateEntries = await db.earningLedgerEntry.findMany({
    where: {
      courierId: period.courierId,
      payoutPeriodId: periodId,
      occurredAt: { gte: period.periodEnd },
    },
    select: { id: true },
  })

  // Get or create next period for late entries
  let nextPeriodId: string | null = null
  if (lateEntries.length > 0) {
    const profile = period.courier.activeCompensationProfile
    if (profile) {
      const nextRange = getBratislavaPeriodForDate(period.periodEnd, {
        frequency: profile.payoutFrequency as PayoutFrequency,
        payoutWeekday: profile.preferredPayoutWeekday ?? 4,
        monthlyPayoutDay: profile.monthlyPayoutDay ?? 15,
        anchorDate: profile.payoutAnchorDate ?? undefined,
      })

      const existing = await db.payoutPeriod.findUnique({
        where: {
          courierId_periodStart_periodEnd: {
            courierId: period.courierId,
            periodStart: nextRange.start,
            periodEnd: nextRange.end,
          },
        },
        select: { id: true },
      })

      if (existing) {
        nextPeriodId = existing.id
      } else {
        const created = await db.payoutPeriod.create({
          data: {
            courierId: period.courierId,
            frequency: profile.payoutFrequency,
            periodStart: nextRange.start,
            periodEnd: nextRange.end,
            payoutDueDate: nextRange.dueDate,
            status: 'OPEN',
          },
          select: { id: true },
        })
        nextPeriodId = created.id
      }

      // Move late entries to next period
      await db.earningLedgerEntry.updateMany({
        where: { id: { in: lateEntries.map((e) => e.id) } },
        data: { payoutPeriodId: nextPeriodId },
      })
    }
  }

  // Recalculate totals
  const totals = await recalculatePayoutPeriod(periodId)

  // Lock the period — conditional update (compare-and-swap on status)
  const now = new Date()
  await db.$transaction(async (tx) => {
    // Conditional update: only lock if status is OPEN or CALCULATED
    const lockResult = await tx.payoutPeriod.updateMany({
      where: {
        id: periodId,
        status: { in: ['OPEN', 'CALCULATED'] },
      },
      data: {
        status: 'LOCKED',
        lockedAt: now,
        ...totals,
      },
    })

    if (lockResult.count !== 1) {
      throw new PayoutPeriodError('CONFLICT', 'Obdobie bolo medzičasom zmenené iným používateľom.')
    }

    await tx.courierAuditLog.create({
      data: {
        courierId: period.courierId,
        action: 'PERIOD_LOCK',
        oldValueJson: JSON.stringify({ status: period.status }),
        newValueJson: JSON.stringify({ status: 'LOCKED', lockedAt: now }),
        reason: reason ?? 'Uzávierka obdobia',
        actorUserId,
      },
    })
  })

  return {
    periodId,
    status: 'LOCKED',
    lockedAt: now,
    ...totals,
    movedEntryCount: lateEntries.length,
  }
}

/**
 * Unlock a payout period. This is a controlled operation that requires
 * a reason and creates an audit log. Only LOCKED periods can be unlocked
 * (back to OPEN). APPROVED/PAID periods cannot be unlocked.
 */
export async function unlockPayoutPeriod(
  periodId: string,
  actorUserId: string,
  reason: string
): Promise<void> {
  if (!reason || reason.trim().length < 5) {
    throw new PayoutPeriodError('INVALID_REQUEST', 'Dôvod odomknutia je povinný (min 5 znakov)')
  }

  const period = await db.payoutPeriod.findUnique({
    where: { id: periodId },
    select: { id: true, status: true, courierId: true },
  })

  if (!period) {
    throw new PayoutPeriodError('NOT_FOUND', 'Výplatné obdobie nebolo nájdené')
  }

  if (period.status !== 'LOCKED') {
    throw new PayoutPeriodError(
      'INVALID_STATUS',
      `Iba uzamknuté obdobie možno odomknúť (aktuálny stav: ${period.status})`)
  }

  await db.$transaction(async (tx) => {
    await tx.payoutPeriod.update({
      where: { id: periodId },
      data: { status: 'OPEN', lockedAt: null },
    })

    await tx.courierAuditLog.create({
      data: {
        courierId: period.courierId,
        action: 'PERIOD_UNLOCK',
        oldValueJson: JSON.stringify({ status: 'LOCKED' }),
        newValueJson: JSON.stringify({ status: 'OPEN' }),
        reason,
        actorUserId,
      },
    })
  })
}

/**
 * Approve a locked payout period. This moves it to APPROVED status.
 * Only LOCKED periods can be approved.
 */
export async function approvePayoutPeriod(
  periodId: string,
  actorUserId: string,
  reason?: string
): Promise<void> {
  const period = await db.payoutPeriod.findUnique({
    where: { id: periodId },
    select: { id: true, status: true, courierId: true, payableCents: true },
  })

  if (!period) {
    throw new PayoutPeriodError('NOT_FOUND', 'Výplatné obdobie nebolo nájdené')
  }

  if (period.status !== 'LOCKED') {
    throw new PayoutPeriodError(
      'INVALID_STATUS',
      `Iba uzamknuté obdobie možno schváliť (aktuálny stav: ${period.status})`)
  }

  const now = new Date()
  await db.$transaction(async (tx) => {
    // Conditional update: only approve if status is LOCKED
    const approveResult = await tx.payoutPeriod.updateMany({
      where: {
        id: periodId,
        status: 'LOCKED',
      },
      data: {
        status: 'APPROVED',
        approvedAt: now,
        approvedByUserId: actorUserId,
      },
    })

    if (approveResult.count !== 1) {
      throw new PayoutPeriodError('CONFLICT', 'Obdobie bolo medzičasom zmenené.')
    }

    await tx.courierAuditLog.create({
      data: {
        courierId: period.courierId,
        action: 'PAYOUT_APPROVE',
        oldValueJson: JSON.stringify({ status: 'LOCKED' }),
        newValueJson: JSON.stringify({ status: 'APPROVED', approvedAt: now, payableCents: period.payableCents }),
        reason: reason ?? 'Schválenie výplaty',
        actorUserId,
      },
    })
  })
}

/**
 * Mark an approved payout period as paid. This is the final state — once
 * PAID, the period and its entries are immutable.
 */
export async function markPayoutPaid(
  periodId: string,
  actorUserId: string,
  paymentReference: string,
  paidAt?: Date
): Promise<void> {
  const period = await db.payoutPeriod.findUnique({
    where: { id: periodId },
    select: { id: true, status: true, courierId: true, payableCents: true },
  })

  if (!period) {
    throw new PayoutPeriodError('NOT_FOUND', 'Výplatné obdobie nebolo nájdené')
  }

  if (period.status !== 'APPROVED' && period.status !== 'PROCESSING') {
    throw new PayoutPeriodError(
      'INVALID_STATUS',
      `Iba schválené obdobie možno označiť ako zaplatené (aktuálny stav: ${period.status})`)
  }

  if (!paymentReference || paymentReference.trim().length < 3) {
    throw new PayoutPeriodError('INVALID_REQUEST', 'Referencia platby je povinná (min 3 znaky)')
  }

  const now = paidAt ?? new Date()
  await db.$transaction(async (tx) => {
    // Conditional update: only mark paid if status is APPROVED or PROCESSING
    const paidResult = await tx.payoutPeriod.updateMany({
      where: {
        id: periodId,
        status: { in: ['APPROVED', 'PROCESSING'] },
      },
      data: {
        status: 'PAID',
        paidAt: now,
        paymentReference,
      },
    })

    if (paidResult.count !== 1) {
      throw new PayoutPeriodError('CONFLICT', 'Obdobie bolo medzičasom zmenené.')
    }

    await tx.courierAuditLog.create({
      data: {
        courierId: period.courierId,
        action: 'PAYOUT_MARK_PAID',
        oldValueJson: JSON.stringify({ status: period.status }),
        newValueJson: JSON.stringify({ status: 'PAID', paidAt: now, paymentReference }),
        reason: `Platba ${paymentReference}`,
        actorUserId,
      },
    })
  })
}

/**
 * Generate payout periods for a courier for a date range.
 * Useful for backfilling or pre-generating periods.
 */
export async function generatePeriodsForCourier(
  courierId: string,
  from: Date,
  to: Date
): Promise<{ generated: number; skipped: number }> {
  const courier = await db.courier.findUnique({
    where: { id: courierId },
    include: { activeCompensationProfile: true },
  })

  if (!courier || !courier.activeCompensationProfile) {
    throw new PayoutPeriodError('INVALID_REQUEST', 'Kuriér nemá aktívny compensation profile')
  }

  const profile = courier.activeCompensationProfile
  const frequency = profile.payoutFrequency as PayoutFrequency
  const config = {
    frequency,
    payoutWeekday: profile.preferredPayoutWeekday ?? 4,
    monthlyPayoutDay: profile.monthlyPayoutDay ?? 15,
    anchorDate: profile.payoutAnchorDate ?? undefined,
  }

  // Generate period boundaries
  const periods: Array<{ start: Date; end: Date; dueDate: Date }> = []
  let cursor = new Date(from)
  let iterations = 0
  while (cursor < to && iterations < 100) {
    iterations++
    const range = getBratislavaPeriodForDate(cursor, config)
    periods.push({ start: range.start, end: range.end, dueDate: range.dueDate })
    cursor = new Date(range.end)
  }

  let generated = 0
  let skipped = 0

  for (const p of periods) {
    const existing = await db.payoutPeriod.findUnique({
      where: {
        courierId_periodStart_periodEnd: {
          courierId,
          periodStart: p.start,
          periodEnd: p.end,
        },
      },
      select: { id: true },
    })

    if (existing) {
      skipped++
      continue
    }

    await db.payoutPeriod.create({
      data: {
        courierId,
        frequency,
        periodStart: p.start,
        periodEnd: p.end,
        payoutDueDate: p.dueDate,
        status: 'OPEN',
      },
    })
    generated++
  }

  return { generated, skipped }
}

export class PayoutPeriodError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
    this.name = 'PayoutPeriodError'
  }
}

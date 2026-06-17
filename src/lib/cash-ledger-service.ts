/**
 * Cash ledger service.
 *
 * Tracks cash collected from customers (CASH payment method) separately from
 * courier earnings. The courier sees their cash balance (money they owe the
 * company) distinctly from their earnings.
 *
 * Key operations:
 * - recordCashCollected: when courier picks up a CASH order
 * - recordCashHandedOver: when courier returns cash to the company
 * - getCashBalance: current running balance for a courier
 */

import { db } from '@/lib/db'
import type { CashEntryType } from '@prisma/client'

export interface CashBalanceResult {
  courierId: string
  balanceCents: number
  lastEntryAt: Date | null
}

/**
 * Record that a courier collected cash from a customer.
 * Called automatically when a CASH order is marked as DELIVERED.
 */
export async function recordCashCollected(input: {
  courierId: string
  orderId: string
  amountCents: number
  occurredAt?: Date
}): Promise<{ entryId: string; balanceAfterCents: number }> {
  return recordCashEntry({
    ...input,
    type: 'CASH_COLLECTED',
    note: `Hotovosť od zákazníka za objednávku`,
  })
}

/**
 * Record that a courier handed cash over to the company.
 * Called by admin or via a "settle cash" action.
 */
export async function recordCashHandedOver(input: {
  courierId: string
  amountCents: number
  confirmedByUserId: string
  note?: string
  occurredAt?: Date
}): Promise<{ entryId: string; balanceAfterCents: number }> {
  return recordCashEntry({
    ...input,
    orderId: '', // not tied to a specific order
    type: 'CASH_HANDED_OVER',
    note: input.note ?? 'Odovzdaná hotovosť',
    confirmedByUserId: input.confirmedByUserId,
  })
}

/**
 * Apply a manual cash adjustment (correction).
 * Requires admin role and a reason.
 */
export async function recordCashAdjustment(input: {
  courierId: string
  amountCents: number // can be negative
  confirmedByUserId: string
  reason: string
  orderId?: string
}): Promise<{ entryId: string; balanceAfterCents: number }> {
  if (input.amountCents === 0) {
    throw new Error('Cash adjustment amount cannot be zero')
  }
  return recordCashEntry({
    courierId: input.courierId,
    orderId: input.orderId ?? '',
    type: 'CASH_ADJUSTMENT',
    amountCents: input.amountCents,
    confirmedByUserId: input.confirmedByUserId,
    note: `Úprava: ${input.reason}`,
  })
}

async function recordCashEntry(input: {
  courierId: string
  orderId: string
  type: CashEntryType
  amountCents: number
  note?: string
  confirmedByUserId?: string
  occurredAt?: Date
}): Promise<{ entryId: string; balanceAfterCents: number }> {
  const occurredAt = input.occurredAt ?? new Date()

  // Get current balance
  const lastEntry = await db.cashLedgerEntry.findFirst({
    where: { courierId: input.courierId },
    orderBy: { occurredAt: 'desc' },
    select: { balanceAfterCents: true },
  })
  const balanceBefore = lastEntry?.balanceAfterCents ?? 0
  const balanceAfter = balanceBefore + input.amountCents

  const entry = await db.cashLedgerEntry.create({
    data: {
      courierId: input.courierId,
      orderId: input.orderId || null,
      type: input.type,
      amountCents: input.amountCents,
      balanceAfterCents: balanceAfter,
      note: input.note,
      confirmedByUserId: input.confirmedByUserId ?? null,
      occurredAt,
    },
    select: { id: true },
  })

  return { entryId: entry.id, balanceAfterCents: balanceAfter }
}

/**
 * Get the current cash balance for a courier (money they're holding).
 */
export async function getCashBalance(courierId: string): Promise<CashBalanceResult> {
  const lastEntry = await db.cashLedgerEntry.findFirst({
    where: { courierId },
    orderBy: { occurredAt: 'desc' },
    select: { balanceAfterCents: true, occurredAt: true },
  })

  return {
    courierId,
    balanceCents: lastEntry?.balanceAfterCents ?? 0,
    lastEntryAt: lastEntry?.occurredAt ?? null,
  }
}

/**
 * Get cash balance for multiple couriers (admin dashboard).
 */
export async function getCashBalances(courierIds: string[]): Promise<Map<string, number>> {
  if (courierIds.length === 0) return new Map()

  const result = new Map<string, number>()

  // Get the latest entry for each courier
  const entries = await db.cashLedgerEntry.findMany({
    where: { courierId: { in: courierIds } },
    orderBy: { occurredAt: 'desc' },
    select: { courierId: true, balanceAfterCents: true },
  })

  const seen = new Set<string>()
  for (const entry of entries) {
    if (!seen.has(entry.courierId)) {
      result.set(entry.courierId, entry.balanceAfterCents)
      seen.add(entry.courierId)
    }
  }

  // Fill in zeros for couriers with no entries
  for (const id of courierIds) {
    if (!result.has(id)) result.set(id, 0)
  }

  return result
}

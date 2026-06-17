/**
 * Payout batch service.
 *
 * Handles bulk payout operations — grouping multiple approved payout periods
 * into a single batch for processing. This is useful when the admin wants
 * to pay all approved periods at once (e.g. end of week).
 *
 * The batch is created in DRAFT status, then moved to PROCESSING, and
 * finally to COMPLETED or FAILED based on the external payment result.
 */

import { db } from '@/lib/db'
import type { PayoutBatchStatus } from '@prisma/client'

export interface BatchSummary {
  batchId: string
  batchNumber: string
  status: PayoutBatchStatus
  totalCents: number
  periodCount: number
  periods: Array<{
    id: string
    courierId: string
    courierName: string
    payableCents: number
    paymentReference: string | null
  }>
}

/**
 * Create a payout batch from all APPROVED payout periods.
 * The admin can optionally filter by courier or date range.
 */
export async function createPayoutBatch(
  actorUserId: string,
  options?: { courierId?: string }
): Promise<BatchSummary> {
  const where: Record<string, unknown> = { status: 'APPROVED' }
  if (options?.courierId) where.courierId = options.courierId

  const periods = await db.payoutPeriod.findMany({
    where,
    include: {
      courier: { select: { id: true, displayName: true } },
    },
    orderBy: { payoutDueDate: 'asc' },
  })

  if (periods.length === 0) {
    throw new BatchError('NO_PERIODS', 'Žiadne schválené obdobia na výplatu')
  }

  const totalCents = periods.reduce((s, p) => s + p.payableCents, 0)
  const batchNumber = `PB-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`

  const batch = await db.$transaction(async (tx) => {
    const created = await tx.payoutBatch.create({
      data: {
        batchNumber,
        status: 'DRAFT',
        totalCents,
        periodCount: periods.length,
        createdByUserId: actorUserId,
      },
    })

    // Link all periods to the batch and set to PROCESSING
    for (const period of periods) {
      await tx.payoutPeriod.update({
        where: { id: period.id },
        data: {
          payoutBatchId: created.id,
          status: 'PROCESSING',
        },
      })
    }

    return created
  })

  return {
    batchId: batch.id,
    batchNumber: batch.batchNumber,
    status: 'DRAFT',
    totalCents,
    periodCount: periods.length,
    periods: periods.map((p) => ({
      id: p.id,
      courierId: p.courierId,
      courierName: p.courier.displayName,
      payableCents: p.payableCents,
      paymentReference: null,
    })),
  }
}

/**
 * Mark a batch as completed. All periods in the batch are marked as PAID.
 */
export async function completePayoutBatch(
  batchId: string,
  actorUserId: string,
  paymentReferences: Record<string, string>
): Promise<void> {
  const batch = await db.payoutBatch.findUnique({
    where: { id: batchId },
    include: { periods: { select: { id: true, courierId: true } } },
  })

  if (!batch) {
    throw new BatchError('NOT_FOUND', 'Dávka nebola nájdená')
  }

  if (batch.status !== 'DRAFT' && batch.status !== 'PROCESSING') {
    throw new BatchError('INVALID_STATUS', `Dávku v stave ${batch.status} nemožno dokončiť`)
  }

  const now = new Date()
  await db.$transaction(async (tx) => {
    // Mark each period as PAID
    for (const period of batch.periods) {
      const ref = paymentReferences[period.id]
      if (!ref) {
        throw new BatchError('MISSING_REFERENCE', `Chýba referencia pre obdobie ${period.id}`)
      }

      await tx.payoutPeriod.update({
        where: { id: period.id },
        data: {
          status: 'PAID',
          paidAt: now,
          paymentReference: ref,
        },
      })

      await tx.courierAuditLog.create({
        data: {
          courierId: period.courierId,
          action: 'PAYOUT_MARK_PAID',
          oldValueJson: JSON.stringify({ status: 'PROCESSING' }),
          newValueJson: JSON.stringify({ status: 'PAID', paidAt: now, paymentReference: ref }),
          reason: `Hromadná výplata ${batch.batchNumber}`,
          actorUserId,
        },
      })
    }

    await tx.payoutBatch.update({
      where: { id: batchId },
      data: {
        status: 'COMPLETED',
        processedAt: now,
      },
    })
  })
}

/**
 * Export a batch as CSV for bank import.
 * Format: IBAN;Amount;Currency;VariableSymbol;CourierName;PaymentReference
 */
export function batchToCsv(batch: BatchSummary, ibanByCourier: Record<string, string>): string {
  const headers = ['IBAN', 'Suma', 'Mena', 'VariabilnySymbol', 'Meno', 'Referencia']
  const rows = batch.periods.map((p) => {
    const iban = ibanByCourier[p.courierId] || ''
    const euros = (p.payableCents / 100).toFixed(2)
    const vs = p.id.slice(-10).toUpperCase()
    return [iban, euros, 'EUR', vs, p.courierName, p.paymentReference ?? '']
  })

  return [headers, ...rows].map((row) => row.join(';')).join('\n')
}

export class BatchError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
    this.name = 'BatchError'
  }
}

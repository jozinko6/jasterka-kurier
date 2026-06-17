import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireCourier } from '@/lib/courier-auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { centsToEuros } from '@/lib/money'

/**
 * GET /api/courier/payout-periods/[id]
 *
 * Returns detailed info about a single payout period, including:
 * - period metadata
 * - all earning ledger entries in the period
 * - linked document (invoice or statement) if any
 */
export const GET = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  const authResult = await requireCourier(request)
  if ('error' in authResult) return authResult.error

  const { courier } = authResult.data

  const period = await db.payoutPeriod.findFirst({
    where: { id, courierId: courier.id },
    include: {
      selfBillingInvoice: {
        select: {
          id: true,
          invoiceNumber: true,
          status: true,
          totalAmountCents: true,
          pdfStorageKey: true,
          issueDate: true,
        },
      },
      agreementStatement: {
        select: {
          id: true,
          statementNumber: true,
          status: true,
          grossEarningsCents: true,
          netPaidCents: true,
          pdfStorageKey: true,
        },
      },
    },
  })

  if (!period) {
    return apiError('NOT_FOUND', 'Výplatné obdobie nebolo nájdené')
  }

  // Load all entries in this period
  const entries = await db.earningLedgerEntry.findMany({
    where: {
      courierId: courier.id,
      occurredAt: { gte: period.periodStart, lt: period.periodEnd },
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
      calculationMetadataJson: true,
    },
  })

  // Compute live totals
  const liveTotal = entries.reduce((s, e) => e.type === 'REVERSAL' ? s : s + e.amountCents, 0)

  return Response.json({
    period: {
      ...period,
      payableEuros: centsToEuros(period.payableCents),
      grossEarningsEuros: centsToEuros(period.grossEarningsCents),
      bonusesEuros: centsToEuros(period.bonusesCents),
      adjustmentsEuros: centsToEuros(period.adjustmentsCents),
      livePayableCents: liveTotal,
      livePayableEuros: centsToEuros(liveTotal),
    },
    entries: entries.map((e) => ({
      id: e.id,
      type: e.type,
      amountCents: e.amountCents,
      amountEuros: centsToEuros(e.amountCents),
      description: e.description,
      occurredAt: e.occurredAt,
      orderId: e.orderId,
      metadata: e.calculationMetadataJson ? JSON.parse(e.calculationMetadataJson) : null,
    })),
    document: period.selfBillingInvoice
      ? { type: 'invoice', ...period.selfBillingInvoice }
      : period.agreementStatement
        ? { type: 'statement', ...period.agreementStatement }
        : null,
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireCourier } from '@/lib/courier-auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { acceptInvoice, rejectInvoice, InvoiceError } from '@/lib/self-billing-invoice-service'
import { z } from 'zod/v4'

/**
 * GET /api/courier/documents
 *
 * Returns the courier's documents: invoices (self-employed) or statements (agreement).
 */
export const GET = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireCourier(request)
  if ('error' in authResult) return authResult.error

  const { courier } = authResult.data

  const [invoices, statements] = await Promise.all([
    db.selfBillingInvoice.findMany({
      where: { courierId: courier.id },
      orderBy: { issueDate: 'desc' },
      select: {
        id: true,
        invoiceNumber: true,
        issueDate: true,
        supplyDate: true,
        dueDate: true,
        amountExVatCents: true,
        vatAmountCents: true,
        totalAmountCents: true,
        status: true,
        pdfStorageKey: true,
        payoutPeriodId: true,
      },
    }),
    db.agreementEarningsStatement.findMany({
      where: { courierId: courier.id },
      orderBy: { periodStart: 'desc' },
      select: {
        id: true,
        statementNumber: true,
        periodStart: true,
        periodEnd: true,
        deliveryCount: true,
        grossEarningsCents: true,
        netPaidCents: true,
        paidAt: true,
        status: true,
        pdfStorageKey: true,
        payoutPeriodId: true,
      },
    }),
  ])

  return Response.json({
    invoices: invoices.map((i) => ({
      ...i,
      amountExVatEuros: i.amountExVatCents / 100,
      vatAmountEuros: i.vatAmountCents / 100,
      totalAmountEuros: i.totalAmountCents / 100,
    })),
    statements: statements.map((s) => ({
      ...s,
      grossEarningsEuros: s.grossEarningsCents / 100,
      netPaidEuros: s.netPaidCents ? s.netPaidCents / 100 : null,
    })),
  }, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

const rejectSchema = z.object({
  reason: z.string().min(5, 'Dôvod odmietnutia je povinný (min 5 znakov)').max(500),
})

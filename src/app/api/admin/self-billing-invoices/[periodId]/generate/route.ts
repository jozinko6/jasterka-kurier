import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { requireRole } from '@/lib/auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { generateSelfBillingInvoice, InvoiceError } from '@/lib/self-billing-invoice-service'
import { centsToEuros } from '@/lib/money'

/**
 * POST /api/admin/self-billing-invoices/[periodId]/generate
 *
 * Generates a self-billing invoice for a locked/approved payout period.
 * Only works for SELF_EMPLOYED couriers with a valid self-billing agreement.
 */
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ periodId: string }> }
) => {
  const { periodId } = await params
  const authResult = await requireRole(request, ['ADMIN', 'OWNER'])
  if ('error' in authResult) return authResult.error

  try {
    const invoice = await generateSelfBillingInvoice(periodId, authResult.user.id)
    return Response.json({
      ...invoice,
      amountExVatEuros: centsToEuros(invoice.amountExVatCents),
      vatAmountEuros: centsToEuros(invoice.vatAmountCents),
      totalAmountEuros: centsToEuros(invoice.totalAmountCents),
    }, { status: 201 })
  } catch (err) {
    if (err instanceof InvoiceError) {
      const codeMap: Record<string, 'NOT_FOUND' | 'FORBIDDEN' | 'BUSINESS_RULE_VIOLATION' | 'INVALID_REQUEST'> = {
        NOT_FOUND: 'NOT_FOUND',
        FORBIDDEN: 'FORBIDDEN',
        INVALID_CONTRACT_TYPE: 'BUSINESS_RULE_VIOLATION',
        MISSING_BUSINESS_PROFILE: 'BUSINESS_RULE_VIOLATION',
        INCOMPLETE_BUSINESS_PROFILE: 'BUSINESS_RULE_VIOLATION',
        NO_SELF_BILLING_AGREEMENT: 'BUSINESS_RULE_VIOLATION',
        SELF_BILLING_DISABLED: 'BUSINESS_RULE_VIOLATION',
        INVALID_STATUS: 'BUSINESS_RULE_VIOLATION',
        INVALID_REQUEST: 'INVALID_REQUEST',
      }
      return apiError(codeMap[err.code] ?? 'BUSINESS_RULE_VIOLATION', err.message)
    }
    throw err
  }
})

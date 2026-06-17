import { NextRequest } from 'next/server'
import { requireCourier } from '@/lib/courier-auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { acceptInvoice, InvoiceError } from '@/lib/self-billing-invoice-service'

/**
 * POST /api/courier/invoices/[id]/accept
 *
 * Courier accepts a delivered self-billing invoice.
 */
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  const authResult = await requireCourier(request)
  if ('error' in authResult) return authResult.error

  try {
    await acceptInvoice(id, authResult.data.user.id)
    return Response.json({ invoiceId: id, status: 'ACCEPTED' }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (err) {
    if (err instanceof InvoiceError) {
      const codeMap: Record<string, 'NOT_FOUND' | 'FORBIDDEN' | 'BUSINESS_RULE_VIOLATION'> = {
        NOT_FOUND: 'NOT_FOUND',
        FORBIDDEN: 'FORBIDDEN',
        INVALID_STATUS: 'BUSINESS_RULE_VIOLATION',
      }
      return apiError(codeMap[err.code] ?? 'BUSINESS_RULE_VIOLATION', err.message)
    }
    throw err
  }
})

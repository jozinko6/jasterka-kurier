import { NextRequest } from 'next/server'
import { requireCourier } from '@/lib/courier-auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { rejectInvoice, InvoiceError } from '@/lib/self-billing-invoice-service'
import { z } from 'zod/v4'

const rejectSchema = z.object({
  reason: z.string().min(5, 'Dôvod odmietnutia je povinný (min 5 znakov)').max(500),
})

/**
 * POST /api/courier/invoices/[id]/reject
 *
 * Courier rejects a delivered self-billing invoice with a reason.
 */
export const POST = withErrorHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) => {
  const { id } = await params
  const authResult = await requireCourier(request)
  if ('error' in authResult) return authResult.error

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_REQUEST', 'Neplatný JSON body')
  }

  const validation = rejectSchema.safeParse(body)
  if (!validation.success) {
    return apiError('INVALID_REQUEST', 'Neplatné parametre', { errors: validation.error.issues })
  }

  try {
    await rejectInvoice(id, authResult.data.user.id, validation.data.reason)
    return Response.json({ invoiceId: id, status: 'REJECTED', reason: validation.data.reason }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (err) {
    if (err instanceof InvoiceError) {
      const codeMap: Record<string, 'NOT_FOUND' | 'FORBIDDEN' | 'BUSINESS_RULE_VIOLATION' | 'INVALID_REQUEST'> = {
        NOT_FOUND: 'NOT_FOUND',
        FORBIDDEN: 'FORBIDDEN',
        INVALID_STATUS: 'BUSINESS_RULE_VIOLATION',
        INVALID_REQUEST: 'INVALID_REQUEST',
      }
      return apiError(codeMap[err.code] ?? 'BUSINESS_RULE_VIOLATION', err.message)
    }
    throw err
  }
})

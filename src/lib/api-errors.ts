import { NextResponse } from 'next/server'

/**
 * Standardized API error codes.
 *
 * Frontend can rely on `code` for branching while `message` stays in Slovak
 * for direct user-facing display. `details` carries structured context when
 * useful (zod issues, allowed transitions, …).
 */
export type ApiErrorCode =
  | 'INVALID_REQUEST'
  | 'UNAUTHENTICATED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'BUSINESS_RULE_VIOLATION'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'

export interface ApiErrorBody {
  code: ApiErrorCode
  message: string
  details?: Record<string, unknown>
}

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  INVALID_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  BUSINESS_RULE_VIOLATION: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
}

/**
 * Build a NextResponse carrying the standardized error envelope.
 *
 * The body is always JSON and includes Cache-Control: private, no-store so
 * that browsers and service workers never cache an error response that may
 * carry session-specific context.
 */
export function apiError(
  code: ApiErrorCode,
  message: string,
  details?: Record<string, unknown>
): NextResponse {
  const body: ApiErrorBody = { code, message }
  if (details) body.details = details
  return NextResponse.json(body, {
    status: STATUS_BY_CODE[code],
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
    },
  })
}

/** Convenience factory for validation errors coming from Zod. */
export function invalidRequest(message: string, details?: Record<string, unknown>): NextResponse {
  return apiError('INVALID_REQUEST', message, details)
}

/** Convenience factory for 404s with Slovak message. */
export function notFound(message = 'Položka nenájdená'): NextResponse {
  return apiError('NOT_FOUND', message)
}

/** Convenience factory for 409 conflicts (e.g. concurrent status change). */
export function conflict(message: string, details?: Record<string, unknown>): NextResponse {
  return apiError('CONFLICT', message, details)
}

/**
 * Wrap an async route handler so any thrown Error is converted into the
 * standardized envelope. Prisma errors are never leaked to the client; only
 * the safe Slovak message is returned.
 */
export function withErrorHandler<TArgs extends unknown[]>(
  handler: (...args: TArgs) => Promise<Response>
): (...args: TArgs) => Promise<Response> {
  return async (...args: TArgs) => {
    try {
      return await handler(...args)
    } catch (err) {
      // Errors that are already NextResponse (e.g. from apiError) pass through.
      if (err instanceof NextResponse) return err
      // Log full error server-side; never expose to client.
      console.error('[api] unhandled error', err)
      return apiError('INTERNAL_ERROR', 'Nastala neočakávaná chyba. Skúste to znova.')
    }
  }
}

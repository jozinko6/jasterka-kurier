/**
 * CSRF / Origin check for mutation requests.
 *
 * The app uses httpOnly cookie sessions. SameSite=Lax is NOT sufficient
 * protection because:
 * - Lax allows GET top-level navigations
 * - Some older browsers don't support SameSite
 * - A malicious site could still trigger a fetch with credentials
 *
 * This middleware checks that the Origin header matches the expected Host
 * for all mutation requests (POST/PUT/PATCH/DELETE). For same-origin requests
 * the browser always sends Origin; a missing Origin on a mutation is suspicious.
 *
 * Authorization Bearer token requests (QA/scripts) are exempt — they don't
 * use cookies and thus aren't vulnerable to CSRF.
 */

import { NextRequest, NextResponse } from 'next/server'

const MUTATION_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Allowed dev origins (for local development with different ports).
 * In production, only the configured NEXT_PUBLIC_APP_URL is allowed.
 */
const DEV_ORIGINS = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://21.0.2.248:3000',
]

export function checkOrigin(request: NextRequest): { ok: true } | { ok: false; response: NextResponse } {
  // Only check mutations
  if (!MUTATION_METHODS.has(request.method)) {
    return { ok: true }
  }

  // Bearer token requests are exempt (QA/API usage)
  const authHeader = request.headers.get('authorization')
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return { ok: true }
  }

  const origin = request.headers.get('origin')
  const host = request.headers.get('host')

  // If no Origin header on a mutation, it's either a same-origin request from
  // a non-browser client OR a CSRF attempt. For browser cookie-auth, we require Origin.
  // We allow missing Origin only if there's no session cookie (login/register endpoints).
  const hasSessionCookie = request.cookies.has('jasterka_session')
  if (!origin) {
    if (hasSessionCookie) {
      return {
        ok: false,
        response: NextResponse.json(
          { code: 'INVALID_REQUEST', message: 'Chýba Origin header.' },
          { status: 400, headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
        ),
      }
    }
    // No session cookie + no Origin = likely a non-browser client (curl, etc.)
    // Allow it to proceed (it will fail auth if it's not a public endpoint)
    return { ok: true }
  }

  // Validate Origin matches Host
  let allowedOrigins: string[]
  if (process.env.NODE_ENV === 'production') {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL
    allowedOrigins = appUrl ? [appUrl] : []
  } else {
    allowedOrigins = [...DEV_ORIGINS]
    if (host) {
      allowedOrigins.push(`http://${host}`)
      allowedOrigins.push(`https://${host}`)
    }
  }

  const isAllowed = allowedOrigins.some((allowed) => {
    if (origin === allowed) return true
    // Allow if origin starts with allowed (for trailing slash variations)
    try {
      const originUrl = new URL(origin)
      const allowedUrl = new URL(allowed)
      return originUrl.host === allowedUrl.host && originUrl.protocol === allowedUrl.protocol
    } catch {
      return false
    }
  })

  if (!isAllowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { code: 'INVALID_REQUEST', message: 'Origin nie je povolený.' },
        { status: 400, headers: { 'Cache-Control': 'private, no-store, max-age=0' } }
      ),
    }
  }

  return { ok: true }
}

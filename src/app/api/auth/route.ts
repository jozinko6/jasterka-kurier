import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import {
  verifyPassword,
  createSession,
  deleteSession,
  authenticateRequest,
  getRequestToken,
  SESSION_COOKIE_NAME,
} from '@/lib/auth'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { loginSchema, validateBody } from '@/lib/validations'
import { checkLoginRateLimit, recordFailedLogin, clearLoginRateLimit, getClientIp } from '@/lib/rate-limit'

const GENERIC_LOGIN_ERROR = 'Neplatné prihlasovacie údaje'

/**
 * POST /api/auth — Login
 *
 * Hardened:
 * - Email/identifier normalization (lowercase, trim)
 * - Reasonable max lengths (loginSchema)
 * - Rate limiting per IP (10/15min) and per identifier (5/15min)
 * - Generic error message (no user enumeration)
 * - Security event logging (no password, no token in logs)
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_REQUEST', 'Neplatný JSON body')
  }

  const validation = validateBody(loginSchema, body)
  if ('error' in validation) return validation.error

  const { email: rawIdentifier, password } = validation.data
  // Normalize identifier: lowercase + trim. Accept email or phone.
  const identifier = rawIdentifier.toLowerCase().trim()

  const ip = getClientIp(request)

  // Rate limit check
  const rateLimit = checkLoginRateLimit(ip, identifier)
  if (!rateLimit.allowed) {
    // Log rate limit hit (no password)
    console.log('[auth] rate limit hit', { ip, identifier, retryAfter: rateLimit.retryAfterSeconds })
    const response = apiError('RATE_LIMITED', rateLimit.reason ?? 'Príliš veľa pokusov.')
    response.headers.set('Retry-After', String(rateLimit.retryAfterSeconds))
    return response
  }

  // Find user by email OR phone
  const user = await db.user.findFirst({
    where: {
      OR: [
        { email: identifier },
        { phone: identifier },
      ],
    },
  })

  // Always return the same generic error to prevent user enumeration
  if (!user || !user.passwordHash) {
    recordFailedLogin(ip, identifier)
    console.log('[auth] failed login (user not found or no password)', { ip, identifier })
    return apiError('UNAUTHENTICATED', GENERIC_LOGIN_ERROR)
  }

  const isValid = await verifyPassword(password, user.passwordHash)
  if (!isValid) {
    recordFailedLogin(ip, identifier)
    console.log('[auth] failed login (bad password)', { ip, identifier, userId: user.id })
    return apiError('UNAUTHENTICATED', GENERIC_LOGIN_ERROR)
  }

  if (!user.isActive) {
    console.log('[auth] inactive account login attempt', { ip, identifier, userId: user.id })
    return apiError('FORBIDDEN', 'Účet nie je aktívny')
  }

  // Success — clear rate limit
  clearLoginRateLimit(ip, identifier)

  const token = await createSession(user.id, user.role)

  console.log('[auth] successful login', { ip, identifier, userId: user.id, role: user.role })

  const result = {
    user: {
      id: user.id,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
    },
  }

  const response = NextResponse.json(result)
  response.cookies.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 8 * 60 * 60,
  })
  return response
})

// GET /api/auth - Verify token and return current user
export async function GET(request: NextRequest) {
  try {
    const authResult = await authenticateRequest(request)
    if ('error' in authResult) {
      return authResult.error
    }
    return NextResponse.json({ user: authResult.user }, {
      headers: { 'Cache-Control': 'private, no-store, max-age=0' },
    })
  } catch (error) {
    console.error('Error verifying token:', error)
    return NextResponse.json(
      { error: 'Overenie zlyhalo' },
      { status: 500 }
    )
  }
}

// DELETE /api/auth - Logout (invalidate session + signal SW to purge caches)
export async function DELETE(request: NextRequest) {
  try {
    const token = getRequestToken(request)

    if (token) {
      await deleteSession(token)
    }
    const response = NextResponse.json({ message: 'Odhlasene' })
    response.cookies.set(SESSION_COOKIE_NAME, '', {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 0,
    })
    // Signal service workers to purge all caches so no personal data survives
    response.headers.set('X-Purge-Caches', '1')
    console.log('[auth] logout completed')
    return response
  } catch (error) {
    console.error('Error during logout:', error)
    return NextResponse.json(
      { error: 'Odhlásenie zlyhalo' },
      { status: 500 }
    )
  }
}

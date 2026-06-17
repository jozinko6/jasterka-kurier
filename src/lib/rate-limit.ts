/**
 * Rate limiting for login attempts.
 *
 * Simple in-memory rate limiter keyed by IP + identifier.
 * Limits:
 * - Per IP: max 10 failed attempts per 15 minutes
 * - Per identifier: max 5 failed attempts per 15 minutes
 *
 * After limit is hit, returns 429 with Retry-After header.
 *
 * In production with multiple server instances, replace with Redis or similar.
 */

interface RateLimitEntry {
  count: number
  firstAttemptAt: number
  backoffUntil: number | null
}

const WINDOW_MS = 15 * 60 * 1000 // 15 minutes
const MAX_IP_ATTEMPTS = 10
const MAX_IDENTIFIER_ATTEMPTS = 5
const BACKOFF_MS = 30 * 1000 // 30 seconds backoff after hitting identifier limit

const ipStore = new Map<string, RateLimitEntry>()
const identifierStore = new Map<string, RateLimitEntry>()

// Periodic cleanup (every 5 minutes)
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of ipStore) {
    if (now - entry.firstAttemptAt > WINDOW_MS) ipStore.delete(key)
  }
  for (const [key, entry] of identifierStore) {
    if (now - entry.firstAttemptAt > WINDOW_MS) identifierStore.delete(key)
  }
}, 5 * 60 * 1000)

export interface RateLimitResult {
  allowed: boolean
  retryAfterSeconds: number
  reason?: string
}

export function checkLoginRateLimit(ip: string, identifier: string): RateLimitResult {
  const now = Date.now()

  // Check IP limit
  const ipEntry = ipStore.get(ip)
  if (ipEntry) {
    if (ipEntry.backoffUntil && now < ipEntry.backoffUntil) {
      const retryAfter = Math.ceil((ipEntry.backoffUntil - now) / 1000)
      return {
        allowed: false,
        retryAfterSeconds: retryAfter,
        reason: 'Príliš veľa pokusov z vašej IP. Skúste to neskôr.',
      }
    }
    if (ipEntry.count >= MAX_IP_ATTEMPTS && now - ipEntry.firstAttemptAt < WINDOW_MS) {
      ipEntry.backoffUntil = now + BACKOFF_MS
      const retryAfter = Math.ceil(BACKOFF_MS / 1000)
      return {
        allowed: false,
        retryAfterSeconds: retryAfter,
        reason: 'Príliš veľa pokusov z vašej IP. Skúste to neskôr.',
      }
    }
  }

  // Check identifier limit
  const idEntry = identifierStore.get(identifier)
  if (idEntry) {
    if (idEntry.backoffUntil && now < idEntry.backoffUntil) {
      const retryAfter = Math.ceil((idEntry.backoffUntil - now) / 1000)
      return {
        allowed: false,
        retryAfterSeconds: retryAfter,
        reason: 'Príliš veľa neúspešných pokusov. Skúste to neskôr.',
      }
    }
    if (idEntry.count >= MAX_IDENTIFIER_ATTEMPTS && now - idEntry.firstAttemptAt < WINDOW_MS) {
      idEntry.backoffUntil = now + BACKOFF_MS
      const retryAfter = Math.ceil(BACKOFF_MS / 1000)
      return {
        allowed: false,
        retryAfterSeconds: retryAfter,
        reason: 'Príliš veľa neúspešných pokusov. Skúste to neskôr.',
      }
    }
  }

  return { allowed: true, retryAfterSeconds: 0 }
}

/**
 * Record a failed login attempt for rate limiting.
 */
export function recordFailedLogin(ip: string, identifier: string): void {
  const now = Date.now()

  const ipEntry = ipStore.get(ip) ?? { count: 0, firstAttemptAt: now, backoffUntil: null }
  ipEntry.count++
  ipStore.set(ip, ipEntry)

  const idEntry = identifierStore.get(identifier) ?? { count: 0, firstAttemptAt: now, backoffUntil: null }
  idEntry.count++
  identifierStore.set(identifier, idEntry)
}

/**
 * Clear rate limit entries after a successful login.
 */
export function clearLoginRateLimit(ip: string, identifier: string): void {
  ipStore.delete(ip)
  identifierStore.delete(identifier)
}

/**
 * Extract client IP from a Next.js request (behind Caddy proxy).
 */
export function getClientIp(request: { headers: { get: (name: string) => string | null } }): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri
  return 'unknown'
}

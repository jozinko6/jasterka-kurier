import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { UserRole } from '@prisma/client'

// ─── Types ───

export interface AuthUser {
  id: string
  email: string | null
  phone: string | null
  role: UserRole
  isActive: boolean
}

export interface AuthResult {
  user: AuthUser
}

// ─── Session Management ───

// Simple token-based session stored in memory
// In production, use NextAuth.js or a proper session store
interface Session {
  userId: string
  role: UserRole
  createdAt: number
  expiresAt: number
}

const sessions = new Map<string, Session>()
const SESSION_TTL = 8 * 60 * 60 * 1000 // 8 hours

// Clean expired sessions every 30 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now()
    for (const [token, session] of sessions) {
      if (session.expiresAt < now) {
        sessions.delete(token)
      }
    }
  }, 30 * 60 * 1000)
}

function generateToken(): string {
  const array = new Uint8Array(32)
  crypto.getRandomValues(array)
  return Array.from(array, (b) => b.toString(16).padStart(2, '0')).join('')
}

export function createSession(userId: string, role: UserRole): string {
  const token = generateToken()
  const now = Date.now()
  sessions.set(token, {
    userId,
    role,
    createdAt: now,
    expiresAt: now + SESSION_TTL,
  })
  return token
}

export function getSession(token: string): Session | null {
  const session = sessions.get(token)
  if (!session) return null
  if (session.expiresAt < Date.now()) {
    sessions.delete(token)
    return null
  }
  return session
}

export function deleteSession(token: string): void {
  sessions.delete(token)
}

// ─── Password Verification ───

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash)
}

// ─── Auth Middleware for API Routes ───

/**
 * Extracts and validates the auth token from the request.
 * Returns the user if authenticated, or an error response if not.
 */
export async function authenticateRequest(
  request: NextRequest
): Promise<{ user: AuthUser } | { error: NextResponse }> {
  const authHeader = request.headers.get('Authorization')
  const token = authHeader?.replace('Bearer ', '')

  if (!token) {
    return {
      error: NextResponse.json(
        { error: 'Neautorizovaný prístup. Prihláste sa.' },
        { status: 401 }
      ),
    }
  }

  const session = getSession(token)
  if (!session) {
    return {
      error: NextResponse.json(
        { error: 'Platnosť prihlásenia vypršala. Prihláste sa znova.' },
        { status: 401 }
      ),
    }
  }

  const user = await db.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      email: true,
      phone: true,
      role: true,
      isActive: true,
    },
  })

  if (!user || !user.isActive) {
    return {
      error: NextResponse.json(
        { error: 'Účet nie je aktívny.' },
        { status: 403 }
      ),
    }
  }

  return { user: user as AuthUser }
}

/**
 * Require specific role(s) for an API route.
 * Usage: const auth = await requireRole(request, ['ADMIN', 'KITCHEN'])
 * If auth is a NextResponse, return it immediately (error).
 * Otherwise, auth.user contains the authenticated user.
 */
export async function requireRole(
  request: NextRequest,
  allowedRoles: UserRole[]
): Promise<{ user: AuthUser } | { error: NextResponse }> {
  const authResult = await authenticateRequest(request)

  if ('error' in authResult) {
    return authResult
  }

  if (!allowedRoles.includes(authResult.user.role)) {
    return {
      error: NextResponse.json(
        { error: 'Nemáte oprávnenie na túto operáciu.' },
        { status: 403 }
      ),
    }
  }

  return authResult
}

// ─── Status Transition Validation ───

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  NEW: ['ACCEPTED', 'CANCELLED'],
  ACCEPTED: ['IN_KITCHEN', 'CANCELLED'],
  IN_KITCHEN: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['WAITING_FOR_COURIER', 'PICKED_UP', 'CANCELLED'],
  WAITING_FOR_COURIER: ['ASSIGNED_TO_COURIER', 'CANCELLED'],
  ASSIGNED_TO_COURIER: ['PICKED_UP', 'CANCELLED'],
  PICKED_UP: ['ON_THE_WAY', 'CANCELLED'],
  ON_THE_WAY: ['DELIVERED', 'CANCELLED'],
  DELIVERED: ['REFUNDED'],
  CANCELLED: [],
  REFUNDED: [],
}

export function isValidStatusTransition(
  from: string,
  to: string
): boolean {
  const allowed = ALLOWED_TRANSITIONS[from]
  if (!allowed) return false
  return allowed.includes(to)
}

export function getAllowedTransitions(currentStatus: string): string[] {
  return ALLOWED_TRANSITIONS[currentStatus] || []
}

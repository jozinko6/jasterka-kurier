import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { UserRole } from '@prisma/client'
import crypto from 'crypto'

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

interface Session {
  userId: string
  role: UserRole
  createdAt: Date
  expiresAt: Date
}

const SESSION_TTL = 8 * 60 * 60 * 1000 // 8 hours
export const SESSION_COOKIE_NAME = 'jasterka_session'

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

function generateToken(): string {
  return crypto.randomBytes(32).toString('base64url')
}

function parseToken(token: string): { sessionId: string; secret: string } | null {
  const [sessionId, secret] = token.split('.')
  if (!sessionId || !secret) return null
  return { sessionId, secret }
}

function constantTimeEqual(a: string, b: string): boolean {
  const aBuffer = Buffer.from(a)
  const bBuffer = Buffer.from(b)
  return aBuffer.length === bBuffer.length && crypto.timingSafeEqual(aBuffer, bBuffer)
}

export async function createSession(userId: string, role: UserRole): Promise<string> {
  const secret = generateToken()
  const session = await db.authSession.create({
    data: {
      userId,
      tokenHash: hashToken(secret),
      expiresAt: new Date(Date.now() + SESSION_TTL),
    },
    select: { id: true },
  })

  return `${session.id}.${secret}`
}

export async function getSession(token: string): Promise<Session | null> {
  const parsed = parseToken(token)
  if (!parsed) return null

  const session = await db.authSession.findUnique({
    where: { id: parsed.sessionId },
    include: {
      user: {
        select: { role: true },
      },
    },
  })

  if (!session || session.expiresAt < new Date()) {
    if (session) {
      await db.authSession.delete({ where: { id: session.id } }).catch(() => null)
    }
    return null
  }

  if (!constantTimeEqual(session.tokenHash, hashToken(parsed.secret))) {
    return null
  }

  return {
    userId: session.userId,
    role: session.user.role,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
  }
}

export async function deleteSession(token: string): Promise<void> {
  const parsed = parseToken(token)
  if (!parsed) return

  await db.authSession
    .deleteMany({
      where: {
        id: parsed.sessionId,
        tokenHash: hashToken(parsed.secret),
      },
    })
    .catch(() => null)
}

export function getRequestToken(request: NextRequest): string | null {
  const authHeader = request.headers.get('Authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.slice('Bearer '.length) : null
  return bearerToken || request.cookies.get(SESSION_COOKIE_NAME)?.value || null
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
  const token = getRequestToken(request)

  if (!token) {
    return {
      error: NextResponse.json(
        { error: 'Neautorizovaný prístup. Prihláste sa.' },
        { status: 401 }
      ),
    }
  }

  const session = await getSession(token)
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

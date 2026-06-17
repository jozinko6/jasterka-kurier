/**
 * Courier-specific auth helpers.
 *
 * These extend the base auth layer with courier-profile lookups and
 * resource-level ownership checks.
 */

import { NextRequest } from 'next/server'
import { db } from '@/lib/db'
import { authenticateRequest, type AuthUser } from '@/lib/auth'
import { apiError } from '@/lib/api-errors'

export interface CourierAuthResult {
  user: AuthUser
  courier: {
    id: string
    userId: string
    displayName: string
    vehicleType: string
    status: string
    isActive: boolean
  }
}

/**
 * Authenticate the request and load the courier profile for the logged-in user.
 * Returns 401 if not authenticated, 403 if not a COURIER role, 404 if no
 * courier profile exists.
 */
export async function requireCourier(
  request: NextRequest
): Promise<{ data: CourierAuthResult } | { error: ReturnType<typeof apiError> }> {
  const authResult = await authenticateRequest(request)
  if ('error' in authResult) {
    return { error: apiError('UNAUTHENTICATED', 'Neautorizovaný prístup. Prihláste sa.') }
  }

  if (authResult.user.role !== 'COURIER' && authResult.user.role !== 'ADMIN' && authResult.user.role !== 'OWNER') {
    return { error: apiError('FORBIDDEN', 'Táto sekcia je dostupná iba kuriérom.') }
  }

  const courier = await db.courier.findUnique({
    where: { userId: authResult.user.id },
    select: {
      id: true,
      userId: true,
      displayName: true,
      vehicleType: true,
      status: true,
      isActive: true,
    },
  })

  if (!courier) {
    return { error: apiError('NOT_FOUND', 'Kuriérsky profil nebol nájdený.') }
  }

  if (!courier.isActive) {
    return { error: apiError('FORBIDDEN', 'Váš kuriérsky profil nie je aktívny.') }
  }

  return { data: { user: authResult.user, courier } }
}

/**
 * Verify that the requesting courier owns the active assignment for an order.
 * Returns the assignment if owned, otherwise returns an error response.
 */
export async function requireAssignedCourierForOrder(
  courierId: string,
  orderId: string
): Promise<{ data: { assignmentId: string } } | { error: ReturnType<typeof apiError> }> {
  const assignment = await db.deliveryAssignment.findFirst({
    where: {
      orderId,
      courierId,
      status: { in: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP'] },
    },
    select: { id: true, courierId: true },
  })

  if (!assignment) {
    return {
      error: apiError('FORBIDDEN', 'Nemáte priradenú túto objednávku.', { orderId }),
    }
  }

  return { data: { assignmentId: assignment.id } }
}

/**
 * Get the real client IP from a Next.js request (behind Caddy proxy).
 */
export function getClientIp(request: NextRequest): string {
  const xff = request.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  const xri = request.headers.get('x-real-ip')
  if (xri) return xri
  return 'unknown'
}

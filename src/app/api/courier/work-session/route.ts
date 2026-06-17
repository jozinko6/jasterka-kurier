import { NextRequest, NextResponse } from 'next/server'
import { requireCourier } from '@/lib/courier-auth'
import { startWorkSession, endWorkSession, pauseWorkSession, resumeWorkSession } from '@/lib/work-session-service'
import { apiError, withErrorHandler } from '@/lib/api-errors'
import { z } from 'zod/v4'

const actionSchema = z.object({
  action: z.enum(['start', 'end', 'pause', 'resume']),
})

/**
 * POST /api/courier/work-session
 *
 * Body: { action: 'start' | 'end' | 'pause' | 'resume' }
 *
 * Manages the courier's work session for time tracking.
 */
export const POST = withErrorHandler(async (request: NextRequest) => {
  const authResult = await requireCourier(request)
  if ('error' in authResult) return authResult.error

  const { courier } = authResult.data

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return apiError('INVALID_REQUEST', 'Neplatný JSON body')
  }

  const validation = actionSchema.safeParse(body)
  if (!validation.success) {
    return apiError('INVALID_REQUEST', 'Neplatná akcia', { errors: validation.error.issues })
  }

  const { action } = validation.data

  let session
  switch (action) {
    case 'start':
      session = await startWorkSession(courier.id)
      break
    case 'end':
      session = await endWorkSession(courier.id)
      if (!session) {
        return apiError('NOT_FOUND', 'Žiadna aktívna pracovná smena')
      }
      break
    case 'pause':
      session = await pauseWorkSession(courier.id)
      if (!session) {
        return apiError('NOT_FOUND', 'Žiadna aktívna pracovná smena')
      }
      break
    case 'resume':
      session = await resumeWorkSession(courier.id)
      if (!session) {
        return apiError('NOT_FOUND', 'Žiadna pozastavená pracovná smena')
      }
      break
  }

  return NextResponse.json(session, {
    headers: { 'Cache-Control': 'private, no-store, max-age=0' },
  })
})

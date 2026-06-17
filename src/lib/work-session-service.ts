/**
 * Work session service.
 *
 * Tracks courier work time for hourly guarantee calculations and for
 * agreement (dohodar) earnings statements. A session starts when the courier
 * goes online and ends when they go offline.
 *
 * The session can be paused (e.g. break) and resumed. Total active time
 * excludes paused intervals.
 */

import { db } from '@/lib/db'

export interface WorkSessionSummary {
  id: string
  courierId: string
  startedAt: Date
  endedAt: Date | null
  totalActiveSeconds: number
  status: 'ACTIVE' | 'ENDED' | 'PAUSED'
}

/**
 * Start a new work session for a courier. If there's already an active session,
 * return it instead of creating a duplicate.
 */
export async function startWorkSession(courierId: string): Promise<WorkSessionSummary> {
  const existing = await db.workSession.findFirst({
    where: { courierId, status: { in: ['ACTIVE', 'PAUSED'] } },
  })

  if (existing) {
    return mapSession(existing)
  }

  const session = await db.workSession.create({
    data: {
      courierId,
      status: 'ACTIVE',
      startedAt: new Date(),
    },
  })

  return mapSession(session)
}

/**
 * End the active work session for a courier. Computes total active time.
 */
export async function endWorkSession(courierId: string): Promise<WorkSessionSummary | null> {
  const session = await db.workSession.findFirst({
    where: { courierId, status: { in: ['ACTIVE', 'PAUSED'] } },
  })

  if (!session) return null

  const now = new Date()
  let totalActiveSeconds = session.totalActiveSeconds

  if (session.status === 'ACTIVE') {
    const elapsed = Math.floor((now.getTime() - session.startedAt.getTime()) / 1000)
    totalActiveSeconds += elapsed
  }
  // If paused, the pause time isn't counted (the pause was the end of active time)

  const updated = await db.workSession.update({
    where: { id: session.id },
    data: {
      status: 'ENDED',
      endedAt: now,
      totalActiveSeconds,
    },
  })

  return mapSession(updated)
}

/**
 * Pause the active work session (e.g. break).
 */
export async function pauseWorkSession(courierId: string): Promise<WorkSessionSummary | null> {
  const session = await db.workSession.findFirst({
    where: { courierId, status: 'ACTIVE' },
  })

  if (!session) return null

  const now = new Date()
  const elapsed = Math.floor((now.getTime() - (session.resumedAt?.getTime() ?? session.startedAt.getTime())) / 1000)
  const totalActiveSeconds = session.totalActiveSeconds + elapsed

  const updated = await db.workSession.update({
    where: { id: session.id },
    data: {
      status: 'PAUSED',
      pausedAt: now,
      totalActiveSeconds,
    },
  })

  return mapSession(updated)
}

/**
 * Resume a paused work session.
 */
export async function resumeWorkSession(courierId: string): Promise<WorkSessionSummary | null> {
  const session = await db.workSession.findFirst({
    where: { courierId, status: 'PAUSED' },
  })

  if (!session) return null

  const updated = await db.workSession.update({
    where: { id: session.id },
    data: {
      status: 'ACTIVE',
      resumedAt: new Date(),
    },
  })

  return mapSession(updated)
}

/**
 * Get the active work session for a courier (if any).
 */
export async function getActiveWorkSession(courierId: string): Promise<WorkSessionSummary | null> {
  const session = await db.workSession.findFirst({
    where: { courierId, status: { in: ['ACTIVE', 'PAUSED'] } },
  })
  return session ? mapSession(session) : null
}

/**
 * Get total active work time for a courier within a date range (in seconds).
 * Used for hourly guarantee calculations and earnings statements.
 */
export async function getActiveWorkSeconds(
  courierId: string,
  from: Date,
  to: Date
): Promise<number> {
  const sessions = await db.workSession.findMany({
    where: {
      courierId,
      startedAt: { lt: to },
      OR: [
        { endedAt: null },
        { endedAt: { gte: from } },
      ],
    },
  })

  let totalSeconds = 0
  for (const session of sessions) {
    const sessionStart = session.startedAt > from ? session.startedAt : from
    const sessionEnd = session.endedAt && session.endedAt < to ? session.endedAt : to
    if (sessionEnd > sessionStart) {
      // Use stored totalActiveSeconds for completed sessions, compute for active
      if (session.status === 'ENDED') {
        // Proportional split if session spans the range boundary
        const sessionDuration = session.endedAt!.getTime() - session.startedAt.getTime()
        const activeRatio = sessionDuration > 0 ? session.totalActiveSeconds / (sessionDuration / 1000) : 1
        const overlapSeconds = (sessionEnd.getTime() - sessionStart.getTime()) / 1000
        totalSeconds += Math.round(overlapSeconds * activeRatio)
      } else {
        // Active session — count time since started (or resumed)
        const refTime = session.resumedAt ?? session.startedAt
        totalSeconds += session.totalActiveSeconds + Math.floor((sessionEnd.getTime() - refTime.getTime()) / 1000)
      }
    }
  }

  return totalSeconds
}

function mapSession(s: {
  id: string
  courierId: string
  startedAt: Date
  endedAt: Date | null
  totalActiveSeconds: number
  status: 'ACTIVE' | 'ENDED' | 'PAUSED'
}): WorkSessionSummary {
  return {
    id: s.id,
    courierId: s.courierId,
    startedAt: s.startedAt,
    endedAt: s.endedAt,
    totalActiveSeconds: s.totalActiveSeconds,
    status: s.status,
  }
}

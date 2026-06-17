/**
 * Work session service with segment-based pause/resume tracking.
 *
 * Each active interval is a WorkSessionSegment with startedAt/endedAt.
 * The session's totalActiveSeconds is the sum of all segment durations.
 *
 * - start: creates session + first segment (ACTIVE)
 * - pause: ends current segment, sets session to PAUSED
 * - resume: creates new segment, sets session to ACTIVE
 * - end: ends current segment, sets session to ENDED, computes final total
 *
 * Only one ACTIVE or PAUSED session per courier (enforced by query).
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
 * Start a new work session. If there's already an active/paused session,
 * return it instead of creating a duplicate.
 */
export async function startWorkSession(courierId: string): Promise<WorkSessionSummary> {
  const existing = await db.workSession.findFirst({
    where: { courierId, status: { in: ['ACTIVE', 'PAUSED'] } },
    include: { segments: true },
  })

  if (existing) {
    return mapSession(existing)
  }

  const now = new Date()
  const session = await db.$transaction(async (tx) => {
    // Ensure no other active session exists (race condition guard)
    const activeCount = await tx.workSession.count({
      where: { courierId, status: { in: ['ACTIVE', 'PAUSED'] } },
    })
    if (activeCount > 0) {
      // Another session was created in parallel — return it
      const parallel = await tx.workSession.findFirst({
        where: { courierId, status: { in: ['ACTIVE', 'PAUSED'] } },
        include: { segments: true },
      })
      if (parallel) return parallel
    }

    const created = await tx.workSession.create({
      data: {
        courierId,
        status: 'ACTIVE',
        startedAt: now,
        segments: {
          create: {
            startedAt: now,
          },
        },
      },
      include: { segments: true },
    })
    return created
  })

  return mapSession(session)
}

/**
 * End the active work session. Computes total active time from segments.
 */
export async function endWorkSession(courierId: string): Promise<WorkSessionSummary | null> {
  const session = await db.workSession.findFirst({
    where: { courierId, status: { in: ['ACTIVE', 'PAUSED'] } },
    include: { segments: true },
  })

  if (!session) return null

  const now = new Date()
  const updated = await db.$transaction(async (tx) => {
    // End any open segment
    let additionalSeconds = 0
    for (const segment of session.segments) {
      if (!segment.endedAt) {
        const duration = Math.floor((now.getTime() - segment.startedAt.getTime()) / 1000)
        additionalSeconds += duration
        await tx.workSessionSegment.update({
          where: { id: segment.id },
          data: { endedAt: now, durationSeconds: duration },
        })
      }
    }

    const totalActiveSeconds = session.totalActiveSeconds + additionalSeconds

    const result = await tx.workSession.update({
      where: { id: session.id },
      data: {
        status: 'ENDED',
        endedAt: now,
        totalActiveSeconds,
      },
      include: { segments: true },
    })

    return result
  })

  return mapSession(updated)
}

/**
 * Pause the active work session (ends current segment).
 */
export async function pauseWorkSession(courierId: string): Promise<WorkSessionSummary | null> {
  const session = await db.workSession.findFirst({
    where: { courierId, status: 'ACTIVE' },
    include: { segments: true },
  })

  if (!session) return null

  const now = new Date()
  const updated = await db.$transaction(async (tx) => {
    // Find and end the current open segment
    const openSegment = session.segments.find((s) => !s.endedAt)
    if (openSegment) {
      const duration = Math.floor((now.getTime() - openSegment.startedAt.getTime()) / 1000)
      await tx.workSessionSegment.update({
        where: { id: openSegment.id },
        data: { endedAt: now, durationSeconds: duration },
      })

      const totalActiveSeconds = session.totalActiveSeconds + duration
      await tx.workSession.update({
        where: { id: session.id },
        data: {
          status: 'PAUSED',
          totalActiveSeconds,
        },
        include: { segments: true },
      })
    }

    return tx.workSession.findUnique({
      where: { id: session.id },
      include: { segments: true },
    })
  })

  return mapSession(updated!)
}

/**
 * Resume a paused work session (creates new segment).
 */
export async function resumeWorkSession(courierId: string): Promise<WorkSessionSummary | null> {
  const session = await db.workSession.findFirst({
    where: { courierId, status: 'PAUSED' },
    include: { segments: true },
  })

  if (!session) return null

  const now = new Date()
  const updated = await db.$transaction(async (tx) => {
    // Create new segment
    await tx.workSessionSegment.create({
      data: {
        sessionId: session.id,
        startedAt: now,
      },
    })

    return tx.workSession.update({
      where: { id: session.id },
      data: { status: 'ACTIVE' },
      include: { segments: true },
    })
  })

  return mapSession(updated)
}

/**
 * Get the active work session for a courier (if any).
 */
export async function getActiveWorkSession(courierId: string): Promise<WorkSessionSummary | null> {
  const session = await db.workSession.findFirst({
    where: { courierId, status: { in: ['ACTIVE', 'PAUSED'] } },
    include: { segments: true },
  })
  return session ? mapSession(session) : null
}

/**
 * Get total active work time for a courier within a date range (in seconds).
 * Computes from segments, not from stored totalActiveSeconds.
 */
export async function getActiveWorkSeconds(
  courierId: string,
  from: Date,
  to: Date
): Promise<number> {
  // Get all sessions that overlap with the range
  const sessions = await db.workSession.findMany({
    where: {
      courierId,
      startedAt: { lt: to },
      OR: [
        { endedAt: null },
        { endedAt: { gte: from } },
      ],
    },
    include: {
      segments: {
        where: {
          startedAt: { lt: to },
          OR: [
            { endedAt: null },
            { endedAt: { gte: from } },
          ],
        },
      },
    },
  })

  let totalSeconds = 0
  for (const session of sessions) {
    for (const segment of session.segments) {
      const segStart = segment.startedAt > from ? segment.startedAt : from
      const segEnd = segment.endedAt && segment.endedAt < to ? segment.endedAt : to
      if (segEnd > segStart) {
        totalSeconds += Math.floor((segEnd.getTime() - segStart.getTime()) / 1000)
      }
    }
  }

  return totalSeconds
}

/**
 * Get live active seconds (stored + current open segment duration).
 * Used by dashboard for real-time display.
 */
export async function getLiveActiveSeconds(courierId: string): Promise<number> {
  const session = await db.workSession.findFirst({
    where: { courierId, status: 'ACTIVE' },
    include: { segments: true },
  })

  if (!session) return 0

  let total = session.totalActiveSeconds
  const now = new Date()

  // Add time from current open segment
  const openSegment = session.segments.find((s) => !s.endedAt)
  if (openSegment) {
    total += Math.floor((now.getTime() - openSegment.startedAt.getTime()) / 1000)
  }

  return total
}

function mapSession(s: {
  id: string
  courierId: string
  startedAt: Date
  endedAt: Date | null
  totalActiveSeconds: number
  status: 'ACTIVE' | 'ENDED' | 'PAUSED'
  segments?: Array<{ startedAt: Date; endedAt: Date | null }>
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

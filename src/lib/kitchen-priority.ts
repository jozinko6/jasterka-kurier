/**
 * Kitchen order priority calculation.
 *
 * Determines the display order of orders in the kitchen UI.
 * Highest priority first:
 * 1. Overdue orders (estimatedReadyAt < now, not READY)
 * 2. New unaccepted orders (status = NEW)
 * 3. Orders with nearest estimatedReadyAt
 * 4. Orders with longest wait time
 * 5. Others
 */

export interface KitchenPriorityInput {
  id: string
  status: string
  createdAt: Date
  estimatedReadyAt: Date | null
  estimateStatus: string | null
  now?: Date
}

export interface KitchenPriorityResult {
  score: number
  label: string | null
  isOverdue: boolean
  isNew: boolean
  minutesUntilReady: number | null
}

export function calculateKitchenPriority(order: KitchenPriorityInput): KitchenPriorityResult {
  const now = order.now ?? new Date()
  const ageMs = now.getTime() - order.createdAt.getTime()
  const ageMinutes = Math.floor(ageMs / 60000)

  const minutesUntilReady = order.estimatedReadyAt
    ? Math.round((order.estimatedReadyAt.getTime() - now.getTime()) / 60000)
    : null

  const isOverdue =
    order.estimatedReadyAt !== null &&
    order.estimatedReadyAt < now &&
    !['READY', 'DELIVERED', 'CANCELLED', 'REFUNDED'].includes(order.status)

  const isNew = order.status === 'NEW'

  // Priority score: higher = more urgent
  let score = 0

  // Base: age in minutes (older = higher priority)
  score += Math.min(ageMinutes, 120) // cap at 120 minutes

  // Overdue orders get massive boost
  if (isOverdue && minutesUntilReady !== null) {
    score += 10000 + Math.abs(minutesUntilReady) * 100
  }

  // New orders get boost
  if (isNew) {
    score += 5000
  }

  // Orders nearing ready time get boost
  if (minutesUntilReady !== null && minutesUntilReady >= 0 && !isOverdue) {
    score += Math.max(0, 100 - minutesUntilReady) * 10
  }

  // Label
  let label: string | null = null
  if (isOverdue) {
    label = 'MEŠKÁ'
  } else if (isNew) {
    label = 'NOVÁ'
  } else if (minutesUntilReady !== null && minutesUntilReady <= 5 && minutesUntilReady >= 0) {
    label = 'DO 5 MIN'
  } else if (order.status === 'READY') {
    label = 'ČAKÁ NA KURIÉRA'
  }

  return {
    score,
    label,
    isOverdue,
    isNew,
    minutesUntilReady,
  }
}

/**
 * Sort orders by kitchen priority (highest first).
 */
export function sortByKitchenPriority<T extends KitchenPriorityInput>(
  orders: T[],
  now: Date = new Date()
): T[] {
  return [...orders].sort((a, b) => {
    const pa = calculateKitchenPriority({ ...a, now })
    const pb = calculateKitchenPriority({ ...b, now })
    return pb.score - pa.score
  })
}

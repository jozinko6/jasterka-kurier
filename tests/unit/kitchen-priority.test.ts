/**
 * Unit tests for kitchen priority calculation.
 */

import { describe, it, expect } from 'vitest'
import { calculateKitchenPriority, sortByKitchenPriority } from '@/lib/kitchen-priority'

describe('calculateKitchenPriority', () => {
  const now = new Date('2025-06-18T16:00:00Z')

  it('gives highest priority to overdue orders', () => {
    const overdue = calculateKitchenPriority({
      id: '1',
      status: 'PREPARING',
      createdAt: new Date('2025-06-18T15:00:00Z'),
      estimatedReadyAt: new Date('2025-06-18T15:50:00Z'), // 10 min overdue
      estimateStatus: 'DELAYED',
      now,
    })
    const normal = calculateKitchenPriority({
      id: '2',
      status: 'PREPARING',
      createdAt: new Date('2025-06-18T15:50:00Z'),
      estimatedReadyAt: new Date('2025-06-18T16:20:00Z'), // 20 min future
      estimateStatus: 'ESTIMATED',
      now,
    })
    expect(overdue.score).toBeGreaterThan(normal.score)
    expect(overdue.isOverdue).toBe(true)
    expect(overdue.label).toBe('MEŠKÁ')
  })

  it('gives high priority to new orders', () => {
    const newOrder = calculateKitchenPriority({
      id: '1',
      status: 'NEW',
      createdAt: new Date('2025-06-18T15:58:00Z'),
      estimatedReadyAt: null,
      estimateStatus: null,
      now,
    })
    const accepted = calculateKitchenPriority({
      id: '2',
      status: 'ACCEPTED',
      createdAt: new Date('2025-06-18T15:50:00Z'),
      estimatedReadyAt: new Date('2025-06-18T16:15:00Z'),
      estimateStatus: 'ESTIMATED',
      now,
    })
    // New order gets +5000 boost
    expect(newOrder.isNew).toBe(true)
    expect(newOrder.label).toBe('NOVÁ')
    expect(newOrder.score).toBeGreaterThan(accepted.score)
  })

  it('gives "DO 5 MIN" label when ready within 5 minutes', () => {
    const result = calculateKitchenPriority({
      id: '1',
      status: 'PREPARING',
      createdAt: new Date('2025-06-18T15:30:00Z'),
      estimatedReadyAt: new Date('2025-06-18T16:03:00Z'), // 3 min future
      estimateStatus: 'ESTIMATED',
      now,
    })
    expect(result.label).toBe('DO 5 MIN')
    expect(result.minutesUntilReady).toBe(3)
  })

  it('gives "ČAKÁ NA KURIÉRA" label for READY status', () => {
    const result = calculateKitchenPriority({
      id: '1',
      status: 'READY',
      createdAt: new Date('2025-06-18T15:00:00Z'),
      estimatedReadyAt: new Date('2025-06-18T15:50:00Z'),
      estimateStatus: 'READY',
      now,
    })
    expect(result.label).toBe('ČAKÁ NA KURIÉRA')
  })

  it('older orders get higher base score', () => {
    const old = calculateKitchenPriority({
      id: '1',
      status: 'ACCEPTED',
      createdAt: new Date('2025-06-18T15:00:00Z'), // 60 min ago
      estimatedReadyAt: new Date('2025-06-18T16:20:00Z'),
      estimateStatus: 'ESTIMATED',
      now,
    })
    const recent = calculateKitchenPriority({
      id: '2',
      status: 'ACCEPTED',
      createdAt: new Date('2025-06-18T15:55:00Z'), // 5 min ago
      estimatedReadyAt: new Date('2025-06-18T16:20:00Z'),
      estimateStatus: 'ESTIMATED',
      now,
    })
    expect(old.score).toBeGreaterThan(recent.score)
  })
})

describe('sortByKitchenPriority', () => {
  it('sorts overdue first, then new, then by time', () => {
    const now = new Date('2025-06-18T16:00:00Z')
    const orders = [
      {
        id: '1',
        status: 'ACCEPTED',
        createdAt: new Date('2025-06-18T15:50:00Z'),
        estimatedReadyAt: new Date('2025-06-18T16:20:00Z'),
        estimateStatus: 'ESTIMATED',
      },
      {
        id: '2',
        status: 'NEW',
        createdAt: new Date('2025-06-18T15:58:00Z'),
        estimatedReadyAt: null,
        estimateStatus: null,
      },
      {
        id: '3',
        status: 'PREPARING',
        createdAt: new Date('2025-06-18T15:00:00Z'),
        estimatedReadyAt: new Date('2025-06-18T15:50:00Z'), // overdue
        estimateStatus: 'DELAYED',
      },
    ]

    const sorted = sortByKitchenPriority(orders, now)
    expect(sorted[0].id).toBe('3') // overdue
    expect(sorted[1].id).toBe('2') // new
    expect(sorted[2].id).toBe('1') // normal
  })
})

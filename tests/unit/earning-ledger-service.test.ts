/**
 * Unit tests for earning ledger service.
 *
 * Tests the core earning ledger operations using a real SQLite database:
 * - createEarningEntriesForOrder is idempotent
 * - reverseEarningsForOrder creates REVERSAL entries
 * - applyManualAdjustment creates audit log
 * - recalculatePayoutPeriod computes correct totals
 *
 * These tests connect directly to the SQLite database (no HTTP).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import {
  createEarningEntriesForOrder,
  reverseEarningsForOrder,
  applyManualAdjustment,
  recalculatePayoutPeriod,
} from '@/lib/earning-ledger-service'
import type { EarningComponent, RemunerationPlanSnapshot } from '@/lib/remuneration'

// ─── Test fixtures ───

const testPlanSnapshot: RemunerationPlanSnapshot = {
  planId: 'test-plan',
  planName: 'Test Plan',
  versionNumber: 1,
  currency: 'EUR',
  rules: [
    { ruleType: 'DELIVERY_BASE', valueType: 'FIXED_CENTS', valueCents: 150, valueBasisPoints: 0, priority: 1 },
    { ruleType: 'ZONE_BONUS', valueType: 'FIXED_CENTS', valueCents: 50, valueBasisPoints: 0, priority: 1 },
  ],
  zoneRules: [],
  peakRules: [],
}

const testComponents: EarningComponent[] = [
  { type: 'DELIVERY_BASE', amountCents: 150, description: 'Základná odmena' },
  { type: 'ZONE_BONUS', amountCents: 50, description: 'Bonus za zónu' },
]

// ─── Helpers ───

let testCourierId: string
let testOrderId: string
let testUserId: string
let testPlanVersionId: string

async function setupTestCourier() {
  // Create a test user + courier + compensation profile + remuneration plan version
  const user = await db.user.create({
    data: {
      email: `test-${Date.now()}@test.local`,
      role: 'COURIER',
      passwordHash: 'test-hash',
      isActive: true,
    },
  })
  testUserId = user.id

  const courier = await db.courier.create({
    data: {
      userId: user.id,
      displayName: 'Test Courier',
      vehicleType: 'BICYCLE',
      status: 'AVAILABLE',
      isActive: true,
    },
  })
  testCourierId = courier.id

  // Create a remuneration plan + version
  const plan = await db.remunerationPlan.create({
    data: { name: 'Test Plan', currency: 'EUR', isActive: true },
  })
  const version = await db.remunerationPlanVersion.create({
    data: {
      planId: plan.id,
      versionNumber: 1,
      effectiveFrom: new Date('2025-01-01'),
      rulesSnapshot: JSON.stringify({}),
    },
  })
  testPlanVersionId = version.id

  // Create a compensation profile (WEEKLY)
  const profile = await db.courierCompensationProfile.create({
    data: {
      courierId: courier.id,
      contractType: 'AGREEMENT',
      agreementType: 'WORK_ACTIVITY',
      payoutFrequency: 'WEEKLY',
      preferredPayoutWeekday: 4,
      remunerationPlanId: plan.id,
      validFrom: new Date('2025-01-01'),
      active: true,
    },
  })
  await db.courier.update({
    where: { id: courier.id },
    data: { activeCompensationProfileId: profile.id },
  })
}

async function setupTestOrder() {
  const order = await db.order.create({
    data: {
      orderNumber: `TEST-${Date.now()}`,
      status: 'DELIVERED',
      orderType: 'DELIVERY',
      paymentMethod: 'CASH',
      customerName: 'Test Customer',
      customerPhone: '+421900000000',
      subtotalAmount: 10,
      deliveryFee: 1,
      totalAmount: 11,
      deliveredAt: new Date(),
    },
  })
  testOrderId = order.id
  return order
}

async function cleanupTest() {
  // Delete in dependency order
  await db.earningLedgerEntry.deleteMany({ where: { courierId: testCourierId } })
  await db.courierAuditLog.deleteMany({ where: { courierId: testCourierId } })
  await db.payoutPeriod.deleteMany({ where: { courierId: testCourierId } })
  await db.order.deleteMany({ where: { id: testOrderId } }).catch(() => null)
  await db.courierCompensationProfile.deleteMany({ where: { courierId: testCourierId } })
  await db.courier.deleteMany({ where: { id: testCourierId } })
  await db.user.deleteMany({ where: { id: testUserId } })
  await db.remunerationPlanVersion.deleteMany({ where: { id: testPlanVersionId } })
  await db.remunerationPlan.deleteMany({ where: { id: testPlanVersionId } }).catch(() => null)
}

// ─── Tests ───

describe('earning ledger service', () => {
  beforeAll(async () => {
    await setupTestCourier()
  })

  afterAll(async () => {
    await cleanupTest()
    await db.$disconnect()
  })

  describe('createEarningEntriesForOrder', () => {
    beforeEach(async () => {
      // Clean up any entries + periods from previous test
      await db.earningLedgerEntry.deleteMany({ where: { courierId: testCourierId } })
      await db.payoutPeriod.deleteMany({ where: { courierId: testCourierId } })
      await setupTestOrder()
    })

    it('creates ledger entries for each component', async () => {
      const result = await createEarningEntriesForOrder({
        courierId: testCourierId,
        orderId: testOrderId,
        components: testComponents,
        planSnapshot: testPlanSnapshot,
        remunerationPlanVersionId: testPlanVersionId,
        occurredAt: new Date(),
      })

      expect(result.created).toBe(true)
      expect(result.entryIds).toHaveLength(2)

      const entries = await db.earningLedgerEntry.findMany({
        where: { orderId: testOrderId },
      })
      expect(entries).toHaveLength(2)
      expect(entries.map((e) => e.type).sort()).toEqual(['DELIVERY_BASE', 'ZONE_BONUS'])
      expect(entries[0].status).toBe('CONFIRMED')
      expect(entries[0].amountCents).toBeGreaterThan(0)
    })

    it('is idempotent — second call does not create duplicates', async () => {
      // First call
      const result1 = await createEarningEntriesForOrder({
        courierId: testCourierId,
        orderId: testOrderId,
        components: testComponents,
        planSnapshot: testPlanSnapshot,
        remunerationPlanVersionId: testPlanVersionId,
        occurredAt: new Date(),
      })
      expect(result1.created).toBe(true)

      // Second call with same order
      const result2 = await createEarningEntriesForOrder({
        courierId: testCourierId,
        orderId: testOrderId,
        components: testComponents,
        planSnapshot: testPlanSnapshot,
        remunerationPlanVersionId: testPlanVersionId,
        occurredAt: new Date(),
      })
      expect(result2.created).toBe(false)
      expect(result2.entryIds).toEqual(result1.entryIds)

      // Verify no duplicates
      const entries = await db.earningLedgerEntry.findMany({
        where: { orderId: testOrderId },
      })
      expect(entries).toHaveLength(2)
    })

    it('assigns entries to a payout period', async () => {
      await createEarningEntriesForOrder({
        courierId: testCourierId,
        orderId: testOrderId,
        components: testComponents,
        planSnapshot: testPlanSnapshot,
        remunerationPlanVersionId: testPlanVersionId,
        occurredAt: new Date(),
      })

      const entries = await db.earningLedgerEntry.findMany({
        where: { orderId: testOrderId },
        select: { payoutPeriodId: true },
      })

      // All entries should be assigned to a payout period
      for (const entry of entries) {
        expect(entry.payoutPeriodId).not.toBeNull()
      }
    })

    it('uses unique idempotency keys', async () => {
      await createEarningEntriesForOrder({
        courierId: testCourierId,
        orderId: testOrderId,
        components: testComponents,
        planSnapshot: testPlanSnapshot,
        remunerationPlanVersionId: testPlanVersionId,
        occurredAt: new Date(),
      })

      const entries = await db.earningLedgerEntry.findMany({
        where: { orderId: testOrderId },
        select: { idempotencyKey: true },
      })

      const keys = entries.map((e) => e.idempotencyKey)
      const uniqueKeys = new Set(keys)
      expect(uniqueKeys.size).toBe(keys.length) // all unique
      expect(keys[0]).toContain(`order:${testOrderId}:`)
    })
  })

  describe('reverseEarningsForOrder', () => {
    beforeEach(async () => {
      await db.earningLedgerEntry.deleteMany({ where: { courierId: testCourierId } })
      await db.payoutPeriod.deleteMany({ where: { courierId: testCourierId } })
      await setupTestOrder()
    })

    it('creates reversal entries with negative amounts', async () => {
      // Create original entries
      await createEarningEntriesForOrder({
        courierId: testCourierId,
        orderId: testOrderId,
        components: testComponents,
        planSnapshot: testPlanSnapshot,
        remunerationPlanVersionId: testPlanVersionId,
        occurredAt: new Date(),
      })

      // Reverse them
      const result = await reverseEarningsForOrder(
        testOrderId,
        'Test reversal',
        testUserId
      )
      expect(result.reversedCount).toBe(2)

      const allEntries = await db.earningLedgerEntry.findMany({
        where: { orderId: testOrderId },
        orderBy: { createdAt: 'asc' },
      })

      // Original entries marked as REVERSED
      const originals = allEntries.filter((e) => e.type !== 'REVERSAL')
      expect(originals.every((e) => e.status === 'REVERSED')).toBe(true)

      // Reversal entries created with negative amounts
      const reversals = allEntries.filter((e) => e.type === 'REVERSAL')
      expect(reversals).toHaveLength(2)
      expect(reversals.every((e) => e.amountCents < 0)).toBe(true)
      expect(reversals.every((e) => e.status === 'CONFIRMED')).toBe(true)
    })

    it('does not delete original entries (immutable ledger)', async () => {
      await createEarningEntriesForOrder({
        courierId: testCourierId,
        orderId: testOrderId,
        components: testComponents,
        planSnapshot: testPlanSnapshot,
        remunerationPlanVersionId: testPlanVersionId,
        occurredAt: new Date(),
      })

      const beforeReverse = await db.earningLedgerEntry.count({
        where: { orderId: testOrderId },
      })

      await reverseEarningsForOrder(testOrderId, 'Test', testUserId)

      const afterReverse = await db.earningLedgerEntry.count({
        where: { orderId: testOrderId },
      })

      // Should have MORE entries (originals + reversals), not fewer
      expect(afterReverse).toBe(beforeReverse + 2)
    })

    it('is idempotent — reversing already-reversed entries does nothing', async () => {
      await createEarningEntriesForOrder({
        courierId: testCourierId,
        orderId: testOrderId,
        components: testComponents,
        planSnapshot: testPlanSnapshot,
        remunerationPlanVersionId: testPlanVersionId,
        occurredAt: new Date(),
      })

      await reverseEarningsForOrder(testOrderId, 'First', testUserId)
      const result2 = await reverseEarningsForOrder(testOrderId, 'Second', testUserId)

      expect(result2.reversedCount).toBe(0)
    })
  })

  describe('applyManualAdjustment', () => {
    it('creates a manual adjustment entry', async () => {
      const result = await applyManualAdjustment({
        courierId: testCourierId,
        amountCents: 500,
        reason: 'Performance bonus',
        description: 'Bonus za dobrú prácu',
        actorUserId: testUserId,
      })

      expect(result.entryId).toBeDefined()

      const entry = await db.earningLedgerEntry.findUnique({
        where: { id: result.entryId },
      })
      expect(entry?.type).toBe('MANUAL_ADJUSTMENT')
      expect(entry?.amountCents).toBe(500)
      expect(entry?.status).toBe('CONFIRMED')

      // Clean up
      await db.earningLedgerEntry.delete({ where: { id: result.entryId } })
    })

    it('rejects zero amount', async () => {
      await expect(
        applyManualAdjustment({
          courierId: testCourierId,
          amountCents: 0,
          reason: 'Zero test',
          actorUserId: testUserId,
        })
      ).rejects.toThrow('cannot be zero')
    })

    it('rejects negative amount without isNegative flag', async () => {
      await expect(
        applyManualAdjustment({
          courierId: testCourierId,
          amountCents: -100,
          reason: 'Negative without flag',
          actorUserId: testUserId,
        })
      ).rejects.toThrow('isNegative=true')
    })

    it('allows negative amount with isNegative flag', async () => {
      const result = await applyManualAdjustment({
        courierId: testCourierId,
        amountCents: -200,
        reason: 'Correction for overpayment',
        actorUserId: testUserId,
        isNegative: true,
      })

      expect(result.entryId).toBeDefined()

      const entry = await db.earningLedgerEntry.findUnique({
        where: { id: result.entryId },
      })
      expect(entry?.amountCents).toBe(-200)

      // Clean up
      await db.earningLedgerEntry.delete({ where: { id: result.entryId } })
    })

    it('requires a reason (min 3 chars)', async () => {
      await expect(
        applyManualAdjustment({
          courierId: testCourierId,
          amountCents: 100,
          reason: 'ab',
          actorUserId: testUserId,
        })
      ).rejects.toThrow('min 3')
    })

    it('creates an audit log entry', async () => {
      const result = await applyManualAdjustment({
        courierId: testCourierId,
        amountCents: 300,
        reason: 'Audit test',
        actorUserId: testUserId,
      })

      const auditLog = await db.courierAuditLog.findFirst({
        where: {
          courierId: testCourierId,
          action: 'MANUAL_ADJUSTMENT',
        },
        orderBy: { createdAt: 'desc' },
      })

      expect(auditLog).toBeDefined()
      expect(auditLog?.reason).toBe('Audit test')
      expect(auditLog?.actorUserId).toBe(testUserId)

      // Clean up
      await db.earningLedgerEntry.delete({ where: { id: result.entryId } })
      await db.courierAuditLog.delete({ where: { id: auditLog!.id } })
    })
  })

  describe('recalculatePayoutPeriod', () => {
    beforeEach(async () => {
      // Clean up ALL entries + periods for this courier before testing
      await db.earningLedgerEntry.deleteMany({ where: { courierId: testCourierId } })
      await db.payoutPeriod.deleteMany({ where: { courierId: testCourierId } })
    })

    it('computes correct totals from confirmed entries', async () => {
      await setupTestOrder()

      // Create entries
      await createEarningEntriesForOrder({
        courierId: testCourierId,
        orderId: testOrderId,
        components: testComponents,
        planSnapshot: testPlanSnapshot,
        remunerationPlanVersionId: testPlanVersionId,
        occurredAt: new Date(),
      })

      // Find the payout period
      const entries = await db.earningLedgerEntry.findMany({
        where: { courierId: testCourierId },
        select: { payoutPeriodId: true },
      })
      const periodId = entries[0]?.payoutPeriodId
      expect(periodId).toBeDefined()

      if (periodId) {
        const result = await recalculatePayoutPeriod(periodId)

        // 150 (base) + 50 (zone) = 200 gross, 0 adjustments, 200 payable
        expect(result.grossEarningsCents).toBe(200)
        expect(result.bonusesCents).toBe(50)
        expect(result.adjustmentsCents).toBe(0)
        expect(result.payableCents).toBe(200)

        // Verify the period was updated in DB
        const period = await db.payoutPeriod.findUnique({
          where: { id: periodId },
        })
        expect(period?.grossEarningsCents).toBe(200)
        expect(period?.payableCents).toBe(200)
      }
    })
  })
})

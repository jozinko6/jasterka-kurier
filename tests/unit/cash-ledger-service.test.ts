/**
 * Unit tests for cash ledger service.
 *
 * Tests:
 * - recordCashCollected creates a positive entry
 * - recordCashHandedOver creates a negative entry
 * - getCashBalance returns correct running balance
 * - getCashBalances returns balances for multiple couriers
 * - recordCashAdjustment with audit
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import {
  recordCashCollected,
  recordCashHandedOver,
  recordCashAdjustment,
  getCashBalance,
  getCashBalances,
} from '@/lib/cash-ledger-service'

let testCourierId: string
let testCourier2Id: string
let testUserId: string
let testOrderId: string

async function setupTestCourier(suffix = '') {
  const user = await db.user.create({
    data: {
      email: `cash-test-${Date.now()}-${suffix}@test.local`,
      role: 'COURIER',
      passwordHash: 'test-hash',
      isActive: true,
    },
  })

  const courier = await db.courier.create({
    data: {
      userId: user.id,
      displayName: `Cash Test Courier ${suffix}`,
      vehicleType: 'BICYCLE',
      status: 'AVAILABLE',
      isActive: true,
    },
  })

  return { userId: user.id, courierId: courier.id }
}

async function setupTestOrder() {
  const order = await db.order.create({
    data: {
      orderNumber: `CASH-TEST-${Date.now()}`,
      status: 'DELIVERED',
      orderType: 'DELIVERY',
      paymentMethod: 'CASH',
      customerName: 'Cash Test Customer',
      customerPhone: '+421900000000',
      subtotalAmount: 10,
      deliveryFee: 1,
      totalAmount: 11,
      deliveredAt: new Date(),
    },
  })
  testOrderId = order.id
}

describe('cash ledger service', () => {
  beforeAll(async () => {
    const c1 = await setupTestCourier('1')
    const c2 = await setupTestCourier('2')
    testCourierId = c1.courierId
    testCourier2Id = c2.courierId
    testUserId = c1.userId
  })

  afterAll(async () => {
    // Cleanup
    await db.cashLedgerEntry.deleteMany({
      where: { courierId: { in: [testCourierId, testCourier2Id] } },
    })
    await db.order.deleteMany({ where: { id: testOrderId } }).catch(() => null)
    await db.courier.deleteMany({ where: { id: { in: [testCourierId, testCourier2Id] } } })
    await db.user.deleteMany({ where: { id: { in: [testCourierId, testCourier2Id].map(() => testUserId) } } })
    await db.$disconnect()
  })

  beforeEach(async () => {
    await db.cashLedgerEntry.deleteMany({
      where: { courierId: { in: [testCourierId, testCourier2Id] } },
    })
  })

  describe('recordCashCollected', () => {
    it('creates a positive cash entry', async () => {
      await setupTestOrder()
      const result = await recordCashCollected({
        courierId: testCourierId,
        orderId: testOrderId,
        amountCents: 1100,
      })

      expect(result.entryId).toBeDefined()
      expect(result.balanceAfterCents).toBe(1100)

      const entry = await db.cashLedgerEntry.findUnique({
        where: { id: result.entryId },
      })
      expect(entry?.type).toBe('CASH_COLLECTED')
      expect(entry?.amountCents).toBe(1100)
      expect(entry?.balanceAfterCents).toBe(1100)
    })

    it('updates running balance correctly', async () => {
      await setupTestOrder()
      const r1 = await recordCashCollected({
        courierId: testCourierId,
        orderId: testOrderId,
        amountCents: 500,
      })
      expect(r1.balanceAfterCents).toBe(500)

      // Create another order for the second collection
      const order2 = await db.order.create({
        data: {
          orderNumber: `CASH-TEST-2-${Date.now()}`,
          status: 'DELIVERED',
          orderType: 'DELIVERY',
          paymentMethod: 'CASH',
          customerName: 'Cash Test 2',
          customerPhone: '+421900000001',
          subtotalAmount: 5,
          deliveryFee: 0,
          totalAmount: 5,
        },
      })

      const r2 = await recordCashCollected({
        courierId: testCourierId,
        orderId: order2.id,
        amountCents: 300,
      })
      expect(r2.balanceAfterCents).toBe(800) // 500 + 300

      await db.order.delete({ where: { id: order2.id } })
    })
  })

  describe('recordCashHandedOver', () => {
    it('creates a negative entry reducing balance', async () => {
      // First collect some cash
      await setupTestOrder()
      await recordCashCollected({
        courierId: testCourierId,
        orderId: testOrderId,
        amountCents: 1000,
      })

      // Then hand it over
      const result = await recordCashHandedOver({
        courierId: testCourierId,
        amountCents: 1000,
        confirmedByUserId: testUserId,
      })

      expect(result.balanceAfterCents).toBe(0)

      const entry = await db.cashLedgerEntry.findUnique({
        where: { id: result.entryId },
      })
      expect(entry?.type).toBe('CASH_HANDED_OVER')
      expect(entry?.amountCents).toBe(-1000) // negative
      expect(entry?.balanceAfterCents).toBe(0)
    })

    it('can hand over partial amount', async () => {
      await setupTestOrder()
      await recordCashCollected({
        courierId: testCourierId,
        orderId: testOrderId,
        amountCents: 1000,
      })

      const result = await recordCashHandedOver({
        courierId: testCourierId,
        amountCents: 400,
        confirmedByUserId: testUserId,
      })

      expect(result.balanceAfterCents).toBe(600)
    })
  })

  describe('getCashBalance', () => {
    it('returns 0 for courier with no entries', async () => {
      const balance = await getCashBalance(testCourierId)
      expect(balance.balanceCents).toBe(0)
      expect(balance.lastEntryAt).toBeNull()
    })

    it('returns correct balance after multiple operations', async () => {
      await setupTestOrder()
      await recordCashCollected({
        courierId: testCourierId,
        orderId: testOrderId,
        amountCents: 1500,
      })
      await recordCashHandedOver({
        courierId: testCourierId,
        amountCents: 500,
        confirmedByUserId: testUserId,
      })

      const balance = await getCashBalance(testCourierId)
      expect(balance.balanceCents).toBe(1000)
      expect(balance.lastEntryAt).not.toBeNull()
    })
  })

  describe('getCashBalances', () => {
    it('returns balances for multiple couriers', async () => {
      await setupTestOrder()

      // Courier 1 collects 800
      await recordCashCollected({
        courierId: testCourierId,
        orderId: testOrderId,
        amountCents: 800,
      })

      // Courier 2 collects 1200
      const order2 = await db.order.create({
        data: {
          orderNumber: `CASH-TEST-3-${Date.now()}`,
          status: 'DELIVERED',
          orderType: 'DELIVERY',
          paymentMethod: 'CASH',
          customerName: 'Cash Test 3',
          customerPhone: '+421900000002',
          subtotalAmount: 12,
          deliveryFee: 0,
          totalAmount: 12,
        },
      })
      await recordCashCollected({
        courierId: testCourier2Id,
        orderId: order2.id,
        amountCents: 1200,
      })

      const balances = await getCashBalances([testCourierId, testCourier2Id])
      expect(balances.get(testCourierId)).toBe(800)
      expect(balances.get(testCourier2Id)).toBe(1200)

      await db.order.delete({ where: { id: order2.id } })
    })

    it('returns 0 for couriers with no entries', async () => {
      const balances = await getCashBalances([testCourierId])
      expect(balances.get(testCourierId)).toBe(0)
    })

    it('handles empty input', async () => {
      const balances = await getCashBalances([])
      expect(balances.size).toBe(0)
    })
  })

  describe('recordCashAdjustment', () => {
    it('creates an adjustment with note and confirmer', async () => {
      await setupTestOrder()
      await recordCashCollected({
        courierId: testCourierId,
        orderId: testOrderId,
        amountCents: 1000,
      })

      const result = await recordCashAdjustment({
        courierId: testCourierId,
        amountCents: -100,
        confirmedByUserId: testUserId,
        reason: 'Shortage correction',
      })

      expect(result.balanceAfterCents).toBe(900)

      const entry = await db.cashLedgerEntry.findUnique({
        where: { id: result.entryId },
      })
      expect(entry?.type).toBe('CASH_ADJUSTMENT')
      expect(entry?.amountCents).toBe(-100)
      expect(entry?.note).toContain('Shortage')
      expect(entry?.confirmedByUserId).toBe(testUserId)
    })

    it('rejects zero amount', async () => {
      await expect(
        recordCashAdjustment({
          courierId: testCourierId,
          amountCents: 0,
          confirmedByUserId: testUserId,
          reason: 'Zero',
        })
      ).rejects.toThrow('cannot be zero')
    })
  })

  describe('cash is separate from earnings', () => {
    it('cash entries do not appear in earning ledger', async () => {
      await setupTestOrder()
      await recordCashCollected({
        courierId: testCourierId,
        orderId: testOrderId,
        amountCents: 500,
      })

      const earningEntries = await db.earningLedgerEntry.findMany({
        where: { courierId: testCourierId },
      })
      expect(earningEntries).toHaveLength(0)

      const cashEntries = await db.cashLedgerEntry.findMany({
        where: { courierId: testCourierId },
      })
      expect(cashEntries).toHaveLength(1)
    })
  })
})

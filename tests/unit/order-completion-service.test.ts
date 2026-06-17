/**
 * Unit tests for order completion service.
 *
 * Tests:
 * - completeDeliveryOrder creates earning entries
 * - completeDeliveryOrder is idempotent (no duplicate earnings)
 * - completeDeliveryOrder creates cash entry for CASH orders
 * - completeDeliveryOrder rejects non-owned orders
 * - completeDeliveryOrder rejects invalid status
 * - completeDeliveryOrder updates courier active order count
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { db } from '@/lib/db'
import {
  completeDeliveryOrder,
  CompleteOrderError,
} from '@/lib/order-completion-service'

let testCourierId: string
let testCourier2Id: string
let testUserId: string
let testPlanVersionId: string
let testPlanId: string

async function setupTestCourier(name: string) {
  const user = await db.user.create({
    data: {
      email: `complete-${Date.now()}-${name}@test.local`,
      role: 'COURIER',
      passwordHash: 'test-hash',
      isActive: true,
    },
  })

  const courier = await db.courier.create({
    data: {
      userId: user.id,
      displayName: `Complete Test ${name}`,
      vehicleType: 'BICYCLE',
      status: 'AVAILABLE',
      isActive: true,
    },
  })

  return { userId: user.id, courierId: courier.id }
}

async function setupPlan() {
  const plan = await db.remunerationPlan.create({
    data: { name: 'Complete Test Plan', currency: 'EUR', isActive: true },
  })
  testPlanId = plan.id

  const version = await db.remunerationPlanVersion.create({
    data: {
      planId: plan.id,
      versionNumber: 1,
      effectiveFrom: new Date('2025-01-01'),
      rulesSnapshot: JSON.stringify({
        rules: [
          { ruleType: 'DELIVERY_BASE', valueType: 'FIXED_CENTS', valueCents: 200, priority: 1 },
        ],
      }),
    },
  })
  testPlanVersionId = version.id

  // Add a rule
  await db.remunerationRule.create({
    data: {
      planId: plan.id,
      ruleType: 'DELIVERY_BASE',
      valueType: 'FIXED_CENTS',
      valueCents: 200,
      priority: 1,
      active: true,
    },
  })

  return { planId: plan.id, versionId: version.id }
}

async function createAssignedOrder(
  courierId: string,
  zoneId: string | null,
  paymentMethod: 'CASH' | 'CARD_ON_DELIVERY',
  status: 'PICKED_UP' | 'ON_THE_WAY' | 'DELIVERED' = 'ON_THE_WAY'
) {
  const order = await db.order.create({
    data: {
      orderNumber: `COMPLETE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status,
      orderType: 'DELIVERY',
      paymentMethod,
      customerName: 'Complete Test Customer',
      customerPhone: '+421900000000',
      subtotalAmount: 10,
      deliveryFee: 1,
      totalAmount: 11,
      deliveryZoneId: zoneId,
      pickedUpAt: new Date(),
    },
  })

  const assignment = await db.deliveryAssignment.create({
    data: {
      orderId: order.id,
      courierId,
      zoneId,
      status: 'PICKED_UP',
      assignedByUserId: testUserId,
      pickedUpAt: new Date(),
    },
  })

  return { order, assignment }
}

describe('order completion service', () => {
  beforeAll(async () => {
    const c1 = await setupTestCourier('A')
    testCourierId = c1.courierId
    testUserId = c1.userId

    const c2 = await setupTestCourier('B')
    testCourier2Id = c2.courierId

    await setupPlan()

    // Create compensation profiles for both couriers
    for (const cid of [testCourierId, testCourier2Id]) {
      const profile = await db.courierCompensationProfile.create({
        data: {
          courierId: cid,
          contractType: 'AGREEMENT',
          agreementType: 'WORK_ACTIVITY',
          payoutFrequency: 'WEEKLY',
          preferredPayoutWeekday: 4,
          remunerationPlanId: testPlanId,
          validFrom: new Date('2025-01-01'),
          active: true,
          createdByUserId: testUserId,
        },
      })
      await db.courier.update({
        where: { id: cid },
        data: { activeCompensationProfileId: profile.id },
      })
    }
  })

  afterAll(async () => {
    // Cleanup — defensive, ignore errors from missing records
    const courierIds = [testCourierId, testCourier2Id]
    try {
      await db.earningLedgerEntry.deleteMany({ where: { courierId: { in: courierIds } } })
    } catch {}
    try {
      await db.cashLedgerEntry.deleteMany({ where: { courierId: { in: courierIds } } })
    } catch {}
    try {
      await db.orderRemunerationSnapshot.deleteMany({ where: { courierId: { in: courierIds } } })
    } catch {}
    try {
      await db.courierAuditLog.deleteMany({ where: { courierId: { in: courierIds } } })
    } catch {}
    try {
      await db.payoutPeriod.deleteMany({ where: { courierId: { in: courierIds } } })
    } catch {}
    try {
      await db.deliveryAssignment.deleteMany({ where: { courierId: { in: courierIds } } })
    } catch {}
    // Delete any orders created by these couriers
    try {
      const orders = await db.order.findMany({
        where: { assignments: { some: { courierId: { in: courierIds } } } },
        select: { id: true },
      })
      if (orders.length > 0) {
        const orderIds = orders.map((o) => o.id)
        try { await db.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } }) } catch {}
        try { await db.orderItem.deleteMany({ where: { orderId: { in: orderIds } } }) } catch {}
        try { await db.order.deleteMany({ where: { id: { in: orderIds } } }) } catch {}
      }
    } catch {}
    try {
      await db.courierCompensationProfile.deleteMany({ where: { courierId: { in: courierIds } } })
    } catch {}
    try {
      // Clear activeCompensationProfileId first to avoid FK constraint
      await db.courier.updateMany({
        where: { id: { in: courierIds } },
        data: { activeCompensationProfileId: null },
      })
    } catch {}
    try {
      await db.courier.deleteMany({ where: { id: { in: courierIds } } })
    } catch {}
    try {
      await db.remunerationRule.deleteMany({ where: { planId: testPlanId } })
    } catch {}
    try {
      await db.remunerationPlanVersion.deleteMany({ where: { planId: testPlanId } })
    } catch {}
    try {
      await db.remunerationPlan.deleteMany({ where: { id: testPlanId } })
    } catch {}
    try {
      await db.user.deleteMany({ where: { id: testUserId } })
    } catch {}
    await db.$disconnect()
  })

  beforeEach(async () => {
    // Clean up earning/cash/assignment entries between tests
    await db.earningLedgerEntry.deleteMany({
      where: { courierId: { in: [testCourierId, testCourier2Id] } },
    })
    await db.cashLedgerEntry.deleteMany({
      where: { courierId: { in: [testCourierId, testCourier2Id] } },
    })
    await db.payoutPeriod.deleteMany({
      where: { courierId: { in: [testCourierId, testCourier2Id] } },
    })
    await db.orderRemunerationSnapshot.deleteMany({
      where: { courierId: { in: [testCourierId, testCourier2Id] } },
    })
    // Clean up test orders + assignments
    const testOrders = await db.order.findMany({
      where: { assignments: { some: { courierId: { in: [testCourierId, testCourier2Id] } } } },
      select: { id: true },
    })
    if (testOrders.length > 0) {
      await db.deliveryAssignment.deleteMany({
        where: { orderId: { in: testOrders.map((o) => o.id) } },
      })
      await db.orderStatusHistory.deleteMany({
        where: { orderId: { in: testOrders.map((o) => o.id) } },
      })
      await db.order.deleteMany({
        where: { id: { in: testOrders.map((o) => o.id) } },
      })
    }
    // Reset courier activeOrderCount
    await db.courier.updateMany({
      where: { id: { in: [testCourierId, testCourier2Id] } },
      data: { activeOrderCount: 0 },
    })
  })

  describe('completeDeliveryOrder', () => {
    it('completes an ON_THE_WAY order and creates earnings', async () => {
      const { order } = await createAssignedOrder(testCourierId, null, 'CASH', 'ON_THE_WAY')

      const result = await completeDeliveryOrder(order.id, testCourierId, testUserId)

      expect(result.orderStatus).toBe('DELIVERED')
      expect(result.totalEarningsCents).toBeGreaterThan(0)
      expect(result.earningEntryIds.length).toBeGreaterThan(0)

      // Verify order is DELIVERED
      const updated = await db.order.findUnique({ where: { id: order.id } })
      expect(updated?.status).toBe('DELIVERED')
      expect(updated?.deliveredAt).not.toBeNull()
    })

    it('is idempotent — second call does not create duplicate earnings', async () => {
      const { order } = await createAssignedOrder(testCourierId, null, 'CASH', 'ON_THE_WAY')

      const result1 = await completeDeliveryOrder(order.id, testCourierId, testUserId)
      expect(result1.totalEarningsCents).toBeGreaterThan(0)
      const entryCount1 = result1.earningEntryIds.length

      // Second call — should return same entries without creating duplicates
      const result2 = await completeDeliveryOrder(order.id, testCourierId, testUserId)
      expect(result2.earningEntryIds.length).toBe(entryCount1)
      expect(result2.totalEarningsCents).toBe(result1.totalEarningsCents)

      // Verify no duplicate entries in DB
      const entries = await db.earningLedgerEntry.findMany({
        where: { orderId: order.id, type: { not: 'REVERSAL' } },
      })
      expect(entries.length).toBe(entryCount1)
    })

    it('creates cash ledger entry for CASH payment', async () => {
      const { order } = await createAssignedOrder(testCourierId, null, 'CASH', 'ON_THE_WAY')

      const result = await completeDeliveryOrder(order.id, testCourierId, testUserId)

      // cashCollectedCents should be set (balance after collection)
      expect(result.cashCollectedCents).not.toBeNull()

      const cashEntries = await db.cashLedgerEntry.findMany({
        where: { orderId: order.id },
      })
      expect(cashEntries.length).toBe(1)
      expect(cashEntries[0].type).toBe('CASH_COLLECTED')
      expect(cashEntries[0].amountCents).toBe(Math.round(11 * 100)) // totalAmount in cents
    })

    it('does NOT create cash entry for CARD_ON_DELIVERY', async () => {
      const { order } = await createAssignedOrder(testCourierId, null, 'CARD_ON_DELIVERY', 'ON_THE_WAY')

      const result = await completeDeliveryOrder(order.id, testCourierId, testUserId)

      expect(result.cashCollectedCents).toBeNull()

      const cashEntries = await db.cashLedgerEntry.findMany({
        where: { orderId: order.id },
      })
      expect(cashEntries.length).toBe(0)
    })

    it('rejects order not assigned to this courier', async () => {
      const { order } = await createAssignedOrder(testCourierId, null, 'CASH', 'ON_THE_WAY')

      await expect(
        completeDeliveryOrder(order.id, testCourier2Id, testUserId)
      ).rejects.toThrow(CompleteOrderError)
    })

    it('rejects order in invalid status (NEW)', async () => {
      const { order } = await createAssignedOrder(testCourierId, null, 'CASH', 'ON_THE_WAY')

      // Manually set status to NEW
      await db.order.update({ where: { id: order.id }, data: { status: 'NEW' } })

      await expect(
        completeDeliveryOrder(order.id, testCourierId, testUserId)
      ).rejects.toThrow(CompleteOrderError)
    })

    it('rejects non-existent order', async () => {
      await expect(
        completeDeliveryOrder('nonexistent-order-id', testCourierId, testUserId)
      ).rejects.toThrow(CompleteOrderError)
    })

    it('creates a remuneration snapshot for the order', async () => {
      const { order } = await createAssignedOrder(testCourierId, null, 'CASH', 'ON_THE_WAY')

      await completeDeliveryOrder(order.id, testCourierId, testUserId)

      const snapshot = await db.orderRemunerationSnapshot.findUnique({
        where: { orderId: order.id },
      })
      expect(snapshot).not.toBeNull()
      expect(snapshot?.estimatedTotalCents).toBeGreaterThan(0)
      expect(snapshot?.actualTotalCents).toBeGreaterThan(0)
      expect(snapshot?.planSnapshotJson).toContain('Test Plan')
    })

    it('updates courier active order count to 0 after delivery', async () => {
      const { order } = await createAssignedOrder(testCourierId, null, 'CASH', 'ON_THE_WAY')

      // Set courier activeOrderCount to 1 before completion
      await db.courier.update({
        where: { id: testCourierId },
        data: { activeOrderCount: 1 },
      })

      await completeDeliveryOrder(order.id, testCourierId, testUserId)

      const courier = await db.courier.findUnique({
        where: { id: testCourierId },
        select: { activeOrderCount: true },
      })
      expect(courier?.activeOrderCount).toBe(0)
    })

    it('updates delivery assignment to DELIVERED', async () => {
      const { order, assignment } = await createAssignedOrder(testCourierId, null, 'CASH', 'ON_THE_WAY')

      await completeDeliveryOrder(order.id, testCourierId, testUserId)

      const updatedAssignment = await db.deliveryAssignment.findUnique({
        where: { id: assignment.id },
      })
      expect(updatedAssignment?.status).toBe('DELIVERED')
      expect(updatedAssignment?.deliveredAt).not.toBeNull()
    })

    it('creates status history entry for DELIVERED', async () => {
      const { order } = await createAssignedOrder(testCourierId, null, 'CASH', 'ON_THE_WAY')

      await completeDeliveryOrder(order.id, testCourierId, testUserId)

      const history = await db.orderStatusHistory.findMany({
        where: { orderId: order.id, status: 'DELIVERED' },
      })
      expect(history.length).toBe(1)
      expect(history[0].changedByUserId).toBe(testUserId)
    })
  })
})

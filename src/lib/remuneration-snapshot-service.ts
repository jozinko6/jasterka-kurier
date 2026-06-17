/**
 * Remuneration snapshot service.
 *
 * Loads the active remuneration plan version for a courier, builds a
 * RemunerationPlanSnapshot, and stores an immutable OrderRemunerationSnapshot
 * for the order. The snapshot is used by the calculation engine and by the
 * earning ledger service.
 *
 * Key principle: once a snapshot is created for an order, it NEVER changes.
 * If the rate card is updated later, this order's earnings are computed from
 * the original snapshot.
 */

import { db } from '@/lib/db'
import type {
  RemunerationPlan,
  RemunerationPlanVersion,
  RemunerationRule,
  ZoneCompensationRule,
  PeakPeriodRule,
  CourierRateOverride,
  DeliveryZone,
} from '@prisma/client'
import type { RemunerationPlanSnapshot, RemunerationRuleSnapshot, ZoneCompensationSnapshot, PeakPeriodSnapshot, CourierRateOverrideSnapshot } from '@/lib/remuneration'
import { calculateOrderRemuneration, type OrderCompensationInput, type RemunerationCalculationResult } from '@/lib/remuneration'

/**
 * Load the active remuneration plan snapshot for a courier at a given time.
 * Falls back to the first active plan if the courier has no compensation profile.
 */
export async function loadPlanSnapshotForCourier(
  courierId: string,
  at: Date = new Date()
): Promise<{ snapshot: RemunerationPlanSnapshot; versionId: string; overrides: CourierRateOverrideSnapshot[] } | null> {
  const courier = await db.courier.findUnique({
    where: { id: courierId },
    include: {
      activeCompensationProfile: {
        include: {
          remunerationPlan: {
            include: {
              rules: { where: { active: true } },
              zoneRules: { where: { active: true }, include: { zone: true } },
              peakRules: { where: { active: true } },
            },
          },
        },
      },
      rateOverrides: { where: { active: true } },
    },
  })

  if (!courier) return null

  let plan: RemunerationPlan & {
    rules: RemunerationRule[]
    zoneRules: (ZoneCompensationRule & { zone: DeliveryZone })[]
    peakRules: PeakPeriodRule[]
  } | null = courier.activeCompensationProfile?.remunerationPlan ?? null

  if (!plan) {
    // Fallback: first active plan
    plan = await db.remunerationPlan.findFirst({
      where: { isActive: true },
      include: {
        rules: { where: { active: true } },
        zoneRules: { where: { active: true }, include: { zone: true } },
        peakRules: { where: { active: true } },
      },
    })
  }

  if (!plan) return null

  // Find the version effective at `at`
  const versions = await db.remunerationPlanVersion.findMany({
    where: {
      planId: plan.id,
      effectiveFrom: { lte: at },
    },
    orderBy: { versionNumber: 'desc' },
  })
  const effectiveVersion = versions[0]
  if (!effectiveVersion) return null

  const snapshot = buildPlanSnapshot(plan, effectiveVersion)
  const overrides: CourierRateOverrideSnapshot[] = courier.rateOverrides.map(mapOverride)

  return { snapshot, versionId: effectiveVersion.id, overrides }
}

function buildPlanSnapshot(
  plan: RemunerationPlan & {
    rules: RemunerationRule[]
    zoneRules: (ZoneCompensationRule & { zone: DeliveryZone })[]
    peakRules: PeakPeriodRule[]
  },
  version: RemunerationPlanVersion
): RemunerationPlanSnapshot {
  return {
    planId: plan.id,
    planName: plan.name,
    versionNumber: version.versionNumber,
    currency: plan.currency,
    rules: plan.rules.map(mapRule),
    zoneRules: plan.zoneRules.map(mapZoneRule),
    peakRules: plan.peakRules.map(mapPeakRule),
  }
}

function mapRule(r: RemunerationRule): RemunerationRuleSnapshot {
  return {
    ruleType: r.ruleType,
    valueType: r.valueType,
    valueCents: r.valueCents,
    valueBasisPoints: r.valueBasisPoints,
    conditionJson: r.conditionJson,
    priority: r.priority,
  }
}

function mapZoneRule(z: ZoneCompensationRule & { zone: DeliveryZone }): ZoneCompensationSnapshot {
  return {
    zoneId: z.zoneId,
    zoneName: z.zone.name,
    bonusCents: z.bonusCents,
  }
}

function mapPeakRule(p: PeakPeriodRule): PeakPeriodSnapshot {
  return {
    dayOfWeek: p.dayOfWeek,
    startTime: p.startTime,
    endTime: p.endTime,
    bonusCents: p.bonusCents,
  }
}

function mapOverride(o: CourierRateOverride): CourierRateOverrideSnapshot {
  return {
    ruleType: o.ruleType,
    valueType: o.valueType,
    valueCents: o.valueCents,
    valueBasisPoints: o.valueBasisPoints,
  }
}

/**
 * Create or retrieve an immutable remuneration snapshot for an order.
 * Called at dispatch time (to show estimated earnings) and at completion time
 * (to compute actual earnings). The snapshot is created once and never updated.
 */
export async function getOrCreateOrderSnapshot(
  orderId: string,
  courierId: string,
  input: OrderCompensationInput
): Promise<{ snapshotId: string; calculation: RemunerationCalculationResult }> {
  // Check if snapshot already exists
  const existing = await db.orderRemunerationSnapshot.findUnique({
    where: { orderId },
  })

  if (existing) {
    // Recompute using the stored snapshot (for display consistency)
    const planSnapshot = JSON.parse(existing.planSnapshotJson) as RemunerationPlanSnapshot
    const calculation = calculateOrderRemuneration(planSnapshot, input)
    return { snapshotId: existing.id, calculation }
  }

  const planData = await loadPlanSnapshotForCourier(courierId, input.occurredAt)
  if (!planData) {
    throw new Error(`No active remuneration plan found for courier ${courierId}`)
  }

  const { snapshot, versionId, overrides } = planData
  const calculation = calculateOrderRemuneration(snapshot, { ...input, courierOverrides: overrides })

  const created = await db.orderRemunerationSnapshot.create({
    data: {
      orderId,
      courierId,
      remunerationPlanVersionId: versionId,
      planSnapshotJson: JSON.stringify(snapshot),
      estimatedTotalCents: calculation.totalCents,
    },
    select: { id: true },
  })

  return { snapshotId: created.id, calculation }
}

/**
 * Update the actual total on an existing snapshot (after delivery completion).
 */
export async function setActualSnapshotTotal(orderId: string, actualCents: number): Promise<void> {
  await db.orderRemunerationSnapshot.update({
    where: { orderId },
    data: { actualTotalCents: actualCents },
  })
}

/**
 * Kitchen estimate service.
 *
 * Centralizes all mutations of order ETA fields:
 * - setOrderEstimate — set/replace estimatedReadyAt (MINUTES or EXACT_TIME mode)
 * - delayOrderEstimate — push the estimate forward by additional minutes
 * - acceptOrderWithEstimate — atomic NEW→ACCEPTED + set estimate + status history
 *   + KitchenEvent audit + delivery window computation
 *
 * Guarantees:
 * - All operations are a single db.$transaction
 * - Optimistic concurrency via compare-and-swap on estimateVersion
 * - Actor identity always from session (actorUserId), NEVER from client
 * - Validates: min 5 min, max maxKitchenPrepMinutes (default 180),
 *   not in past, order not CANCELLED/DELIVERED
 * - Creates a KitchenEvent audit row with old/new times, version, reason
 * - Uses calculateCustomerEtaWindow to compute the customer-facing delivery
 *   window (estimatedDeliveryFrom / estimatedDeliveryTo) so the kitchen and
 *   customer screens stay in sync
 *
 * All dates stored as UTC; display layer (UI) formats to Europe/Bratislava.
 */

import { db } from '@/lib/db'
import { Prisma } from '@prisma/client'
import type {
  EstimateSource,
  EstimateStatus,
  OrderStatus,
  OrderType,
  PublicDelayReason,
} from '@prisma/client'
import {
  calculateCustomerEtaWindow,
  validateEstimateMinutes,
} from '@/lib/order-estimates'
import { SETTINGS_SINGLETON_ID } from '@/lib/settings-singleton'

// ─── Errors ───

export type KitchenEstimateErrorCode =
  | 'ORDER_NOT_FOUND'
  | 'INVALID_STATUS'
  | 'STATUS_CONFLICT'
  | 'ESTIMATE_VERSION_CONFLICT'
  | 'BUSINESS_RULE_VIOLATION'

export class KitchenEstimateError extends Error {
  code: KitchenEstimateErrorCode
  details?: Record<string, unknown>
  constructor(
    code: KitchenEstimateErrorCode,
    message: string,
    details?: Record<string, unknown>
  ) {
    super(message)
    this.code = code
    this.details = details
  }
}

// ─── Types ───

export type EstimateMode = 'MINUTES' | 'EXACT_TIME'

export interface SetOrderEstimateParams {
  orderId: string
  actorUserId: string
  mode: EstimateMode
  /** For MINUTES mode: minutes from now until ready. */
  minutes?: number
  /** For EXACT_TIME mode: absolute ready time (UTC ISO string or Date). */
  exactTime?: Date | string
  /** Optional kitchen-set source (defaults to KITCHEN_MANUAL). */
  source?: EstimateSource
  /** Optional note/reason for the audit log. */
  reason?: string
  /** Optimistic concurrency: client-sent current estimateVersion. */
  expectedEstimateVersion?: number
}

export interface DelayOrderEstimateParams {
  orderId: string
  actorUserId: string
  /** Additional minutes to push the estimate forward. */
  additionalMinutes: number
  /** Public-facing reason for the delay (shown to customer). */
  delayReason: PublicDelayReason
  /** Optional internal note for the audit log. */
  reason?: string
  /** Optimistic concurrency: client-sent current estimateVersion. */
  expectedEstimateVersion?: number
}

export interface AcceptOrderWithEstimateParams {
  orderId: string
  actorUserId: string
  /** Minutes from now until ready. */
  prepMinutes: number
  /** Optional kitchen-set source (defaults to KITCHEN_MANUAL). */
  source?: EstimateSource
  /** Optional internal note for the audit log. */
  reason?: string
  /** Optimistic concurrency: client-sent current order status. */
  expectedStatus?: OrderStatus
  /** Optimistic concurrency: client-sent current estimateVersion. */
  expectedEstimateVersion?: number
}

export interface KitchenEstimateResult {
  orderId: string
  status: OrderStatus
  estimatedReadyAt: Date | null
  estimatedDeliveryFrom: Date | null
  estimatedDeliveryTo: Date | null
  estimateStatus: EstimateStatus | null
  estimateSource: EstimateSource | null
  estimateVersion: number
  estimateUpdatedAt: Date | null
  publicDelayReason: PublicDelayReason | null
  updatedAt: Date
}

// ─── Helpers ───

interface LoadedOrder {
  id: string
  status: OrderStatus
  orderType: OrderType
  estimatedReadyAt: Date | null
  estimatedDeliveryFrom: Date | null
  estimatedDeliveryTo: Date | null
  estimateStatus: EstimateStatus | null
  estimateSource: EstimateSource | null
  estimateVersion: number
  estimateUpdatedAt: Date | null
  publicDelayReason: PublicDelayReason | null
  deliveryZoneId: string | null
  readyAt: Date | null
  actualReadyAt?: Date | null
  updatedAt: Date
}

interface SettingsData {
  deliveryWindowBeforeMinutes: number
  deliveryWindowAfterMinutes: number
  defaultKitchenPrepMinutes: number
  maxKitchenPrepMinutes: number
}

const TERMINAL_STATUSES: OrderStatus[] = ['CANCELLED', 'DELIVERED', 'REFUNDED']

async function loadSettings(tx: Prisma.TransactionClient): Promise<SettingsData> {
  // RestaurantSettings is a singleton — see SETTINGS_SINGLETON_ID
  const settings = await tx.restaurantSettings.findUnique({
    where: { id: SETTINGS_SINGLETON_ID },
    select: {
      deliveryWindowBeforeMinutes: true,
      deliveryWindowAfterMinutes: true,
      defaultKitchenPrepMinutes: true,
      maxKitchenPrepMinutes: true,
    },
  })
  // Fall back to safe defaults if the singleton row is somehow missing
  return settings ?? {
    deliveryWindowBeforeMinutes: 5,
    deliveryWindowAfterMinutes: 10,
    defaultKitchenPrepMinutes: 25,
    maxKitchenPrepMinutes: 180,
  }
}

async function loadZoneDeliveryMinutes(
  tx: Prisma.TransactionClient,
  zoneId: string | null
): Promise<number | null> {
  if (!zoneId) return null
  const zone = await tx.deliveryZone.findUnique({
    where: { id: zoneId },
    select: { estimatedDeliveryMinutes: true },
  })
  return zone?.estimatedDeliveryMinutes ?? null
}

/**
 * Compute the customer-facing ETA window for the given order+readyAt.
 * PICKUP orders get null delivery window; DELIVERY orders get ready ± buffer.
 */
function computeEtaWindow(
  order: LoadedOrder,
  readyAt: Date | null,
  settings: SettingsData,
  zoneDeliveryMinutes: number | null
): {
  estimatedDeliveryFrom: Date | null
  estimatedDeliveryTo: Date | null
  estimateStatus: EstimateStatus | null
} {
  const eta = calculateCustomerEtaWindow({
    orderType: order.orderType,
    orderStatus: order.status,
    estimatedReadyAt: readyAt,
    actualReadyAt: order.readyAt ?? order.actualReadyAt ?? null,
    zoneDeliveryMinutes,
    beforeBufferMinutes: settings.deliveryWindowBeforeMinutes,
    afterBufferMinutes: settings.deliveryWindowAfterMinutes,
    defaultPrepMinutes: settings.defaultKitchenPrepMinutes,
  })
  return {
    estimatedDeliveryFrom: eta.deliveryFrom,
    estimatedDeliveryTo: eta.deliveryTo,
    estimateStatus: eta.status as EstimateStatus,
  }
}

function assertNotTerminal(order: LoadedOrder): void {
  if (TERMINAL_STATUSES.includes(order.status)) {
    throw new KitchenEstimateError(
      'BUSINESS_RULE_VIOLATION',
      `Objednávku v stave ${order.status} nemožno upravovať.`,
      { currentStatus: order.status }
    )
  }
}

function assertFuture(readyAt: Date): void {
  if (readyAt.getTime() <= Date.now()) {
    throw new KitchenEstimateError(
      'BUSINESS_RULE_VIOLATION',
      'Odhadovaný čas musí byť v budúcnosti.',
      { readyAt: readyAt.toISOString() }
    )
  }
}

/**
 * Resolve the target readyAt from MINUTES or EXACT_TIME mode.
 * Validates minutes range (5..maxKitchenPrepMinutes) and future-time.
 */
function resolveReadyAt(
  params: SetOrderEstimateParams,
  maxMinutes: number
): Date {
  const now = new Date()
  if (params.mode === 'MINUTES') {
    const minutes = params.minutes
    if (minutes === undefined || !Number.isFinite(minutes)) {
      throw new KitchenEstimateError(
        'BUSINESS_RULE_VIOLATION',
        'Chýba počet minút pre odhad.'
      )
    }
    const err = validateEstimateMinutes(minutes, maxMinutes)
    if (err) {
      throw new KitchenEstimateError('BUSINESS_RULE_VIOLATION', err, { minutes })
    }
    return new Date(now.getTime() + minutes * 60 * 1000)
  }
  // EXACT_TIME
  const raw = params.exactTime
  if (raw === undefined || raw === null) {
    throw new KitchenEstimateError(
      'BUSINESS_RULE_VIOLATION',
      'Chýba presný čas pre odhad.'
    )
  }
  const date = raw instanceof Date ? raw : new Date(raw)
  if (Number.isNaN(date.getTime())) {
    throw new KitchenEstimateError(
      'BUSINESS_RULE_VIOLATION',
      'Neplatný formát času.'
    )
  }
  assertFuture(date)
  // Validate minutes-from-now range for EXACT_TIME too
  const minutesFromNow = (date.getTime() - now.getTime()) / 60000
  const err = validateEstimateMinutes(minutesFromNow, maxMinutes)
  if (err) {
    throw new KitchenEstimateError('BUSINESS_RULE_VIOLATION', err, {
      minutes: Math.round(minutesFromNow),
    })
  }
  return date
}

// ─── Public API ───

/**
 * Set (or replace) the order's estimatedReadyAt.
 *
 * Validates input, applies optimistic concurrency on estimateVersion,
 * recomputes the customer-facing delivery window, and creates a KitchenEvent
 * audit row with old/new times and versions.
 */
export async function setOrderEstimate(
  params: SetOrderEstimateParams
): Promise<KitchenEstimateResult> {
  return db.$transaction(async (tx) => {
    const settings = await loadSettings(tx)
    const newReadyAt = resolveReadyAt(params, settings.maxKitchenPrepMinutes)

    const order = (await tx.order.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        status: true,
        orderType: true,
        estimatedReadyAt: true,
        estimatedDeliveryFrom: true,
        estimatedDeliveryTo: true,
        estimateStatus: true,
        estimateSource: true,
        estimateVersion: true,
        estimateUpdatedAt: true,
        publicDelayReason: true,
        deliveryZoneId: true,
        readyAt: true,
        updatedAt: true,
      },
    })) as LoadedOrder | null

    if (!order) {
      throw new KitchenEstimateError('ORDER_NOT_FOUND', 'Objednávka nenájdená.')
    }
    assertNotTerminal(order)

    // Optimistic concurrency check
    if (
      params.expectedEstimateVersion !== undefined &&
      params.expectedEstimateVersion !== order.estimateVersion
    ) {
      throw new KitchenEstimateError(
        'ESTIMATE_VERSION_CONFLICT',
        'Odhad objednávky medzičasom zmenil iný používateľ.',
        {
          currentVersion: order.estimateVersion,
          expectedVersion: params.expectedEstimateVersion,
          currentEstimatedReadyAt: order.estimatedReadyAt?.toISOString() ?? null,
        }
      )
    }

    const zoneMinutes = await loadZoneDeliveryMinutes(tx, order.deliveryZoneId)
    const window = computeEtaWindow(order, newReadyAt, settings, zoneMinutes)

    const oldVersion = order.estimateVersion
    const newVersion = oldVersion + 1
    const oldEstimatedReadyAt = order.estimatedReadyAt
    const now = new Date()
    const eventType =
      oldEstimatedReadyAt === null ? 'ESTIMATE_CREATED' : 'ESTIMATE_CHANGED'

    const updated = await tx.order.update({
      where: { id: params.orderId },
      data: {
        estimatedReadyAt: newReadyAt,
        estimatedDeliveryFrom: window.estimatedDeliveryFrom,
        estimatedDeliveryTo: window.estimatedDeliveryTo,
        estimateStatus: window.estimateStatus,
        estimateSource: params.source ?? 'KITCHEN_MANUAL',
        estimateVersion: newVersion,
        estimateUpdatedAt: now,
        estimateSetAt: oldEstimatedReadyAt === null ? now : undefined,
        estimateSetByUserId: params.actorUserId,
      },
    })

    await tx.kitchenEvent.create({
      data: {
        orderId: params.orderId,
        eventType,
        note: params.reason ?? null,
        metadataJson: JSON.stringify({
          oldEstimatedReadyAt: oldEstimatedReadyAt?.toISOString() ?? null,
          newEstimatedReadyAt: newReadyAt.toISOString(),
          oldVersion,
          newVersion,
          reason: params.reason ?? null,
          actorUserId: params.actorUserId,
          mode: params.mode,
          source: params.source ?? 'KITCHEN_MANUAL',
        }),
        createdByUserId: params.actorUserId,
      },
    })

    return {
      orderId: updated.id,
      status: updated.status,
      estimatedReadyAt: updated.estimatedReadyAt,
      estimatedDeliveryFrom: updated.estimatedDeliveryFrom,
      estimatedDeliveryTo: updated.estimatedDeliveryTo,
      estimateStatus: updated.estimateStatus,
      estimateSource: updated.estimateSource,
      estimateVersion: updated.estimateVersion,
      estimateUpdatedAt: updated.estimateUpdatedAt,
      publicDelayReason: updated.publicDelayReason,
      updatedAt: updated.updatedAt,
    }
  })
}

/**
 * Push the existing estimate forward by additionalMinutes.
 * Records the public delay reason (shown to customer) and audit trail.
 *
 * If no estimate exists yet, the additionalMinutes is used as the prepMinutes
 * from now (creating an estimate fresh).
 */
export async function delayOrderEstimate(
  params: DelayOrderEstimateParams
): Promise<KitchenEstimateResult> {
  return db.$transaction(async (tx) => {
    const settings = await loadSettings(tx)
    const now = new Date()

    if (
      !Number.isFinite(params.additionalMinutes) ||
      params.additionalMinutes < 1 ||
      params.additionalMinutes > settings.maxKitchenPrepMinutes
    ) {
      throw new KitchenEstimateError(
        'BUSINESS_RULE_VIOLATION',
        `Počet minút oneskorenia musí byť 1 až ${settings.maxKitchenPrepMinutes}.`,
        { additionalMinutes: params.additionalMinutes }
      )
    }

    const order = (await tx.order.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        status: true,
        orderType: true,
        estimatedReadyAt: true,
        estimatedDeliveryFrom: true,
        estimatedDeliveryTo: true,
        estimateStatus: true,
        estimateSource: true,
        estimateVersion: true,
        estimateUpdatedAt: true,
        publicDelayReason: true,
        deliveryZoneId: true,
        readyAt: true,
        updatedAt: true,
      },
    })) as LoadedOrder | null

    if (!order) {
      throw new KitchenEstimateError('ORDER_NOT_FOUND', 'Objednávka nenájdená.')
    }
    assertNotTerminal(order)

    if (
      params.expectedEstimateVersion !== undefined &&
      params.expectedEstimateVersion !== order.estimateVersion
    ) {
      throw new KitchenEstimateError(
        'ESTIMATE_VERSION_CONFLICT',
        'Odhad objednávky medzičasom zmenil iný používateľ.',
        {
          currentVersion: order.estimateVersion,
          expectedVersion: params.expectedEstimateVersion,
          currentEstimatedReadyAt: order.estimatedReadyAt?.toISOString() ?? null,
        }
      )
    }

    const oldEstimatedReadyAt = order.estimatedReadyAt
    const baseTime = oldEstimatedReadyAt ?? now
    const newReadyAt = new Date(
      baseTime.getTime() + params.additionalMinutes * 60 * 1000
    )

    // Validate the resulting time is not too far in the future
    const minutesFromNow = (newReadyAt.getTime() - now.getTime()) / 60000
    const err = validateEstimateMinutes(
      Math.max(5, minutesFromNow),
      settings.maxKitchenPrepMinutes
    )
    if (err) {
      throw new KitchenEstimateError('BUSINESS_RULE_VIOLATION', err, {
        minutes: Math.round(minutesFromNow),
      })
    }

    const zoneMinutes = await loadZoneDeliveryMinutes(tx, order.deliveryZoneId)
    const window = computeEtaWindow(order, newReadyAt, settings, zoneMinutes)

    const oldVersion = order.estimateVersion
    const newVersion = oldVersion + 1

    const updated = await tx.order.update({
      where: { id: params.orderId },
      data: {
        estimatedReadyAt: newReadyAt,
        estimatedDeliveryFrom: window.estimatedDeliveryFrom,
        estimatedDeliveryTo: window.estimatedDeliveryTo,
        estimateStatus: 'DELAYED',
        estimateSource: order.estimateSource ?? 'KITCHEN_MANUAL',
        estimateVersion: newVersion,
        estimateUpdatedAt: now,
        estimateSetAt: oldEstimatedReadyAt === null ? now : undefined,
        estimateSetByUserId: params.actorUserId,
        publicDelayReason: params.delayReason,
      },
    })

    await tx.kitchenEvent.create({
      data: {
        orderId: params.orderId,
        eventType: 'ESTIMATE_DELAYED',
        note: params.reason ?? null,
        metadataJson: JSON.stringify({
          oldEstimatedReadyAt: oldEstimatedReadyAt?.toISOString() ?? null,
          newEstimatedReadyAt: newReadyAt.toISOString(),
          oldVersion,
          newVersion,
          reason: params.reason ?? null,
          delayReason: params.delayReason,
          additionalMinutes: params.additionalMinutes,
          actorUserId: params.actorUserId,
        }),
        createdByUserId: params.actorUserId,
      },
    })

    return {
      orderId: updated.id,
      status: updated.status,
      estimatedReadyAt: updated.estimatedReadyAt,
      estimatedDeliveryFrom: updated.estimatedDeliveryFrom,
      estimatedDeliveryTo: updated.estimatedDeliveryTo,
      estimateStatus: updated.estimateStatus,
      estimateSource: updated.estimateSource,
      estimateVersion: updated.estimateVersion,
      estimateUpdatedAt: updated.estimateUpdatedAt,
      publicDelayReason: updated.publicDelayReason,
      updatedAt: updated.updatedAt,
    }
  })
}

/**
 * Atomic NEW→ACCEPTED transition + set initial estimate.
 *
 * In a SINGLE transaction:
 * 1. Compares-and-swaps order status NEW→ACCEPTED (409 if changed)
 * 2. Sets estimatedReadyAt from prepMinutes + computes delivery window
 * 3. Creates OrderStatusHistory (actor from session)
 * 4. Creates KitchenEvent audit (ESTIMATE_CREATED)
 *
 * Idempotent: if the order is already ACCEPTED with the same estimate, returns
 * the existing state without creating duplicates.
 */
export async function acceptOrderWithEstimate(
  params: AcceptOrderWithEstimateParams
): Promise<KitchenEstimateResult> {
  return db.$transaction(async (tx) => {
    const settings = await loadSettings(tx)
    const now = new Date()

    // Validate prepMinutes range
    const err = validateEstimateMinutes(
      params.prepMinutes,
      settings.maxKitchenPrepMinutes
    )
    if (err) {
      throw new KitchenEstimateError('BUSINESS_RULE_VIOLATION', err, {
        minutes: params.prepMinutes,
      })
    }

    const order = (await tx.order.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        status: true,
        orderType: true,
        estimatedReadyAt: true,
        estimatedDeliveryFrom: true,
        estimatedDeliveryTo: true,
        estimateStatus: true,
        estimateSource: true,
        estimateVersion: true,
        estimateUpdatedAt: true,
        publicDelayReason: true,
        deliveryZoneId: true,
        readyAt: true,
        acceptedAt: true,
        updatedAt: true,
      },
    })) as (LoadedOrder & { acceptedAt: Date | null }) | null

    if (!order) {
      throw new KitchenEstimateError('ORDER_NOT_FOUND', 'Objednávka nenájdená.')
    }

    // Idempotent retry: already ACCEPTED with same estimate
    if (
      order.status === 'ACCEPTED' &&
      order.estimatedReadyAt !== null &&
      Math.abs(
        order.estimatedReadyAt.getTime() -
          (now.getTime() + params.prepMinutes * 60 * 1000)
      ) < 60 * 1000 // 1 minute tolerance
    ) {
      return {
        orderId: order.id,
        status: order.status,
        estimatedReadyAt: order.estimatedReadyAt,
        estimatedDeliveryFrom: order.estimatedDeliveryFrom,
        estimatedDeliveryTo: order.estimatedDeliveryTo,
        estimateStatus: order.estimateStatus,
        estimateSource: order.estimateSource,
        estimateVersion: order.estimateVersion,
        estimateUpdatedAt: order.estimateUpdatedAt,
        publicDelayReason: order.publicDelayReason,
        updatedAt: order.updatedAt,
      }
    }

    // Status check: must be NEW (or already ACCEPTED for idempotent retry path above)
    if (order.status !== 'NEW') {
      if (
        params.expectedStatus !== undefined &&
        params.expectedStatus !== order.status
      ) {
        throw new KitchenEstimateError(
          'STATUS_CONFLICT',
          'Objednávku medzičasom zmenil iný používateľ.',
          {
            currentStatus: order.status,
            expectedStatus: params.expectedStatus,
          }
        )
      }
      throw new KitchenEstimateError(
        'INVALID_STATUS',
        `Z objednávky v stave ${order.status} nemožno prejsť na ACCEPTED.`,
        { currentStatus: order.status }
      )
    }

    // Optional client-sent expectedStatus check
    if (
      params.expectedStatus !== undefined &&
      params.expectedStatus !== order.status
    ) {
      throw new KitchenEstimateError(
        'STATUS_CONFLICT',
        'Objednávku medzičasom zmenil iný používateľ.',
        {
          currentStatus: order.status,
          expectedStatus: params.expectedStatus,
        }
      )
    }

    // Optional client-sent estimate version check
    if (
      params.expectedEstimateVersion !== undefined &&
      params.expectedEstimateVersion !== order.estimateVersion
    ) {
      throw new KitchenEstimateError(
        'ESTIMATE_VERSION_CONFLICT',
        'Odhad objednávky medzičasom zmenil iný používateľ.',
        {
          currentVersion: order.estimateVersion,
          expectedVersion: params.expectedEstimateVersion,
        }
      )
    }

    const newReadyAt = new Date(now.getTime() + params.prepMinutes * 60 * 1000)
    const zoneMinutes = await loadZoneDeliveryMinutes(tx, order.deliveryZoneId)
    const window = computeEtaWindow(order, newReadyAt, settings, zoneMinutes)

    const oldVersion = order.estimateVersion
    const newVersion = oldVersion + 1
    const oldEstimatedReadyAt = order.estimatedReadyAt

    // Compare-and-swap on status NEW→ACCEPTED
    const swap = await tx.order.updateMany({
      where: { id: params.orderId, status: 'NEW' },
      data: {
        status: 'ACCEPTED',
        acceptedAt: now,
        estimatedReadyAt: newReadyAt,
        estimatedDeliveryFrom: window.estimatedDeliveryFrom,
        estimatedDeliveryTo: window.estimatedDeliveryTo,
        estimateStatus: window.estimateStatus,
        estimateSource: params.source ?? 'KITCHEN_MANUAL',
        estimateVersion: newVersion,
        estimateUpdatedAt: now,
        estimateSetAt: now,
        estimateSetByUserId: params.actorUserId,
      },
    })

    if (swap.count !== 1) {
      // Status changed between our read and update — race condition
      throw new KitchenEstimateError(
        'STATUS_CONFLICT',
        'Objednávku medzičasom zmenil iný používateľ.',
        {}
      )
    }

    // Status history (actor from session, NEVER from client)
    await tx.orderStatusHistory.create({
      data: {
        orderId: params.orderId,
        status: 'ACCEPTED',
        changedByUserId: params.actorUserId,
        reason: params.reason ?? 'Prijaté kuchyňou s odhadom času',
      },
    })

    // KitchenEvent audit
    await tx.kitchenEvent.create({
      data: {
        orderId: params.orderId,
        eventType: 'ESTIMATE_CREATED',
        note: params.reason ?? null,
        metadataJson: JSON.stringify({
          oldEstimatedReadyAt: oldEstimatedReadyAt?.toISOString() ?? null,
          newEstimatedReadyAt: newReadyAt.toISOString(),
          oldVersion,
          newVersion,
          reason: params.reason ?? null,
          prepMinutes: params.prepMinutes,
          source: params.source ?? 'KITCHEN_MANUAL',
          actorUserId: params.actorUserId,
          statusTransition: 'NEW→ACCEPTED',
        }),
        createdByUserId: params.actorUserId,
      },
    })

    const updated = await tx.order.findUnique({
      where: { id: params.orderId },
      select: {
        id: true,
        status: true,
        estimatedReadyAt: true,
        estimatedDeliveryFrom: true,
        estimatedDeliveryTo: true,
        estimateStatus: true,
        estimateSource: true,
        estimateVersion: true,
        estimateUpdatedAt: true,
        publicDelayReason: true,
        updatedAt: true,
      },
    })

    if (!updated) {
      throw new KitchenEstimateError('ORDER_NOT_FOUND', 'Objednávka nenájdená.')
    }

    return {
      orderId: updated.id,
      status: updated.status,
      estimatedReadyAt: updated.estimatedReadyAt,
      estimatedDeliveryFrom: updated.estimatedDeliveryFrom,
      estimatedDeliveryTo: updated.estimatedDeliveryTo,
      estimateStatus: updated.estimateStatus,
      estimateSource: updated.estimateSource,
      estimateVersion: updated.estimateVersion,
      estimateUpdatedAt: updated.estimateUpdatedAt,
      publicDelayReason: updated.publicDelayReason,
      updatedAt: updated.updatedAt,
    }
  })
}

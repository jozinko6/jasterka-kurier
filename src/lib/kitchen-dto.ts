/**
 * Kitchen-specific order DTO.
 *
 * Kitchen sees ONLY what it needs for food preparation.
 * No customer contact info, no financial data, no courier internals.
 */

export interface KitchenOrderDTO {
  id: string
  orderNumber: string
  status: string
  orderType: string
  paymentMethod: string
  createdAt: string
  scheduledFor: string | null
  kitchenNote: string | null
  // ETA fields
  estimatedReadyAt: string | null
  estimatedDeliveryFrom: string | null
  estimatedDeliveryTo: string | null
  estimateStatus: string | null
  estimateVersion: number
  estimateUpdatedAt: string | null
  publicDelayReason: string | null
  readyAt: string | null
  // Zone name only (no address)
  deliveryZoneName: string | null
  // Items
  items: Array<{
    id: string
    menuItemNameSnapshot: string
    quantity: number
    selectedSize: string | null
    selectedOptions: string | null
    kitchenNote: string | null
  }>
  // Allowed transitions for this order
  allowedTransitions: string[]
}

/**
 * Convert a Prisma Order (with relations loaded) to KitchenOrderDTO.
 * Strips all customer contact info, financial data, and courier internals.
 */
export function toKitchenOrderDTO(order: {
  id: string
  orderNumber: string
  status: string
  orderType: string
  paymentMethod: string
  createdAt: Date
  scheduledFor: Date | null
  kitchenNote: string | null
  estimatedReadyAt: Date | null
  estimatedDeliveryFrom: Date | null
  estimatedDeliveryTo: Date | null
  estimateStatus: string | null
  estimateVersion: number
  estimateUpdatedAt: Date | null
  publicDelayReason: string | null
  readyAt: Date | null
  deliveryZone?: { name: string } | null
  items: Array<{
    id: string
    menuItemNameSnapshot: string
    quantity: number
    selectedSize: string | null
    selectedOptions: string | null
    kitchenNote: string | null
  }>
}): KitchenOrderDTO {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    orderType: order.orderType,
    paymentMethod: order.paymentMethod,
    createdAt: order.createdAt.toISOString(),
    scheduledFor: order.scheduledFor?.toISOString() ?? null,
    kitchenNote: order.kitchenNote,
    estimatedReadyAt: order.estimatedReadyAt?.toISOString() ?? null,
    estimatedDeliveryFrom: order.estimatedDeliveryFrom?.toISOString() ?? null,
    estimatedDeliveryTo: order.estimatedDeliveryTo?.toISOString() ?? null,
    estimateStatus: order.estimateStatus,
    estimateVersion: order.estimateVersion,
    estimateUpdatedAt: order.estimateUpdatedAt?.toISOString() ?? null,
    publicDelayReason: order.publicDelayReason,
    readyAt: order.readyAt?.toISOString() ?? null,
    deliveryZoneName: order.deliveryZone?.name ?? null,
    items: order.items.map((item) => ({
      id: item.id,
      menuItemNameSnapshot: item.menuItemNameSnapshot,
      quantity: item.quantity,
      selectedSize: item.selectedSize,
      selectedOptions: item.selectedOptions,
      kitchenNote: item.kitchenNote,
    })),
    allowedTransitions: [], // filled by caller
  }
}

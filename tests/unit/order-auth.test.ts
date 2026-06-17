import { describe, it, expect } from 'vitest'
import { toPublicOrderTrackingDTO } from '@/lib/order-auth'

describe('toPublicOrderTrackingDTO', () => {
  const baseOrder = {
    orderNumber: 'JAS-TEST-001',
    status: 'READY' as const,
    orderType: 'DELIVERY' as const,
    paymentMethod: 'CASH',
    totalAmount: 15.50,
    createdAt: new Date('2025-06-18T10:00:00Z'),
    acceptedAt: new Date('2025-06-18T10:01:00Z'),
    readyAt: new Date('2025-06-18T10:15:00Z'),
    pickedUpAt: null,
    deliveredAt: null,
    items: [
      {
        id: 'item-1',
        menuItemNameSnapshot: 'Pizza Margherita',
        quantity: 1,
        lineTotal: 9.90,
        selectedSize: '32 cm',
        selectedOptions: null,
      },
    ],
    assignments: [],
  }

  it('returns orderNumber, status, orderType, paymentMethod', () => {
    const dto = toPublicOrderTrackingDTO(baseOrder)
    expect(dto.orderNumber).toBe('JAS-TEST-001')
    expect(dto.status).toBe('READY')
    expect(dto.orderType).toBe('DELIVERY')
    expect(dto.paymentMethod).toBe('CASH')
  })

  it('returns totalAmount', () => {
    const dto = toPublicOrderOrderTrackingDTO(baseOrder)
    expect(dto.totalAmount).toBe(15.50)
  })

  it('returns items with safe fields', () => {
    const dto = toPublicOrderTrackingDTO(baseOrder)
    expect(dto.items).toHaveLength(1)
    expect(dto.items[0].menuItemNameSnapshot).toBe('Pizza Margherita')
    expect(dto.items[0].quantity).toBe(1)
    expect(dto.items[0].lineTotal).toBe(9.90)
  })

  it('does NOT include customerPhone, customerEmail, customerName', () => {
    const dto = toPublicOrderTrackingDTO(baseOrder)
    expect(dto).not.toHaveProperty('customerPhone')
    expect(dto).not.toHaveProperty('customerEmail')
    expect(dto).not.toHaveProperty('customerName')
  })

  it('does NOT include deliveryAddressLine1, deliveryCity, deliveryNote', () => {
    const dto = toPublicOrderTrackingDTO(baseOrder)
    expect(dto).not.toHaveProperty('deliveryAddressLine1')
    expect(dto).not.toHaveProperty('deliveryCity')
    expect(dto).not.toHaveProperty('deliveryNote')
  })

  it('does NOT include kitchenNote, customerId, deliveryZoneId', () => {
    const dto = toPublicOrderTrackingDTO(baseOrder)
    expect(dto).not.toHaveProperty('kitchenNote')
    expect(dto).not.toHaveProperty('customerId')
    expect(dto).not.toHaveProperty('deliveryZoneId')
  })

  it('returns sanitized courier info (no phone/email/licensePlate/userId)', () => {
    const orderWithCourier = {
      ...baseOrder,
      status: 'ASSIGNED_TO_COURIER' as const,
      assignments: [
        {
          status: 'ASSIGNED',
          courier: {
            displayName: 'Miro Bicykel',
            vehicleType: 'BICYCLE',
            profilePhotoUrl: 'https://example.com/photo.jpg',
          },
        },
      ],
    }
    const dto = toPublicOrderTrackingDTO(orderWithCourier)
    expect(dto.courier).not.toBeNull()
    expect(dto.courier?.displayName).toBe('Miro Bicykel')
    expect(dto.courier?.vehicleType).toBe('BICYCLE')
    expect(dto.courier?.profilePhotoUrl).toBe('https://example.com/photo.jpg')
    // Must NOT include sensitive courier fields
    expect(dto.courier).not.toHaveProperty('phone')
    expect(dto.courier).not.toHaveProperty('email')
    expect(dto.courier).not.toHaveProperty('licensePlate')
    expect(dto.courier).not.toHaveProperty('userId')
    expect(dto.courier).not.toHaveProperty('id')
  })

  it('returns null courier when no active assignment', () => {
    const dto = toPublicOrderTrackingDTO(baseOrder)
    expect(dto.courier).toBeNull()
  })

  it('returns trackingSteps for DELIVERY', () => {
    const dto = toPublicOrderTrackingDTO(baseOrder)
    expect(dto.trackingSteps).toContain('WAITING_FOR_COURIER')
    expect(dto.trackingSteps).toContain('ASSIGNED_TO_COURIER')
    expect(dto.trackingSteps[dto.trackingSteps.length - 1]).toBe('DELIVERED')
  })

  it('returns pickup trackingSteps (no courier states) for PICKUP', () => {
    const dto = toPublicOrderTrackingDTO({ ...baseOrder, orderType: 'PICKUP' as const })
    expect(dto.trackingSteps).not.toContain('WAITING_FOR_COURIER')
    expect(dto.trackingSteps).not.toContain('ASSIGNED_TO_COURIER')
  })

  it('returns only CANCELLED for cancelled orders', () => {
    const dto = toPublicOrderTrackingDTO({ ...baseOrder, status: 'CANCELLED' as const })
    expect(dto.trackingSteps).toEqual(['CANCELLED'])
  })

  it('returns only REFUNDED for refunded orders', () => {
    const dto = toPublicOrderTrackingDTO({ ...baseOrder, status: 'REFUNDED' as const })
    expect(dto.trackingSteps).toEqual(['REFUNDED'])
  })
})

// Helper alias to avoid typo in test
function toPublicOrderOrderTrackingDTO(order: Parameters<typeof toPublicOrderTrackingDTO>[0]) {
  return toPublicOrderTrackingDTO(order)
}

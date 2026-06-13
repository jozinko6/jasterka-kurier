// Pizza Jašterka - Shared Types

export interface MenuCategory {
  id: string
  slug: string
  name: string
  description: string | null
  sortOrder: number
  isActive: boolean
  isDailyMenu: boolean
  imageUrl: string | null
  menuItems: MenuItem[]
}

export interface MenuItem {
  id: string
  categoryId: string
  slug: string
  name: string
  description: string | null
  basePrice: number
  imageUrl: string | null
  isActive: boolean
  isFeatured: boolean
  isAvailable: boolean
  preparationTimeMinutes: number | null
  options: MenuItemOption[]
  category?: MenuCategory
}

export interface MenuItemOption {
  id: string
  menuItemId: string
  optionGroup: string
  optionType: 'SIZE' | 'EXTRA' | 'REMOVE'
  name: string
  priceDelta: number
  isDefault: boolean
  isRequired: boolean
  sortOrder: number
  isActive: boolean
}

export interface CartItem {
  menuItem: MenuItem
  quantity: number
  selectedSize: MenuItemOption | null
  selectedExtras: MenuItemOption[]
  selectedRemoves: MenuItemOption[]
  kitchenNote: string
  unitTotal: number
  lineTotal: number
}

export interface Order {
  id: string
  orderNumber: string
  status: OrderStatus
  orderType: OrderType
  paymentMethod: PaymentMethod
  paymentStatus: string
  customerName: string
  customerPhone: string
  customerEmail: string | null
  deliveryZoneId: string | null
  deliveryAddressLine1: string | null
  deliveryCity: string | null
  deliveryNote: string | null
  kitchenNote: string | null
  subtotalAmount: number
  deliveryFee: number
  totalAmount: number
  createdAt: string
  acceptedAt: string | null
  readyAt: string | null
  pickedUpAt: string | null
  deliveredAt: string | null
  items: OrderItem[]
  deliveryZone?: DeliveryZone
  assignments?: DeliveryAssignment[]
}

export interface OrderItem {
  id: string
  menuItemNameSnapshot: string
  quantity: number
  basePriceSnapshot: number
  unitTotalSnapshot: number
  lineTotal: number
  selectedSize: string | null
  selectedOptions: string | null
  kitchenNote: string | null
}

export interface DeliveryZone {
  id: string
  name: string
  deliveryFee: number
  minimumOrderAmount: number
  estimatedDeliveryMinutes: number
  allowedVehicleTypes: string
  isActive: boolean
  priority: number
}

export interface DeliveryAssignment {
  id: string
  orderId: string
  courierId: string
  status: string
  courier?: Courier
}

export interface Courier {
  id: string
  displayName: string
  phone: string | null
  vehicleType: 'BICYCLE' | 'SCOOTER' | 'CAR'
  status: 'OFFLINE' | 'AVAILABLE' | 'ASSIGNED' | 'PICKING_UP' | 'DELIVERING' | 'BREAK'
  isActive: boolean
  activeOrderCount: number
  user?: { id?: string; email: string | null; phone?: string | null; role?: string; isActive?: boolean }
}

export interface RestaurantSettings {
  id: string
  deliveryEnabled: boolean
  pickupEnabled: boolean
  isOpen: boolean
  customerMessage: string | null
  averagePrepMinutes: number
  minimumOrderAmount: number
  storePhone: string | null
  storeAddress: string | null
}

export type OrderStatus = 'NEW' | 'ACCEPTED' | 'IN_KITCHEN' | 'PREPARING' | 'READY' | 'WAITING_FOR_COURIER' | 'ASSIGNED_TO_COURIER' | 'PICKED_UP' | 'ON_THE_WAY' | 'DELIVERED' | 'CANCELLED' | 'REFUNDED'
export type OrderType = 'DELIVERY' | 'PICKUP' | 'SCHEDULED_DELIVERY' | 'SCHEDULED_PICKUP'
export type PaymentMethod = 'CASH' | 'CARD_ON_DELIVERY' | 'CARD_ON_PICKUP' | 'ONLINE_CARD'

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: 'Nová',
  ACCEPTED: 'Prijatá',
  IN_KITCHEN: 'V kuchyni',
  PREPARING: 'Pripravuje sa',
  READY: 'Hotová',
  WAITING_FOR_COURIER: 'Čaká na kuriéra',
  ASSIGNED_TO_COURIER: 'Priradená kuriérovi',
  PICKED_UP: 'Vyzdvihnutá',
  ON_THE_WAY: 'Na ceste',
  DELIVERED: 'Doručená',
  CANCELLED: 'Zrušená',
  REFUNDED: 'Vrátená',
}

export const VEHICLE_TYPE_LABELS: Record<string, string> = {
  BICYCLE: 'Bicykel',
  SCOOTER: 'Skúter',
  CAR: 'Auto',
}

export const COURIER_STATUS_LABELS: Record<string, string> = {
  OFFLINE: 'Offline',
  AVAILABLE: 'Dostupný',
  ASSIGNED: 'Priradený',
  PICKING_UP: 'Vyzdvihuje',
  DELIVERING: 'Doručuje',
  BREAK: 'Pauza',
}

export function formatPrice(amount: number): string {
  return `${amount.toFixed(2)} €`
}

export function getStatusColor(status: OrderStatus): string {
  const colors: Record<OrderStatus, string> = {
    NEW: 'bg-blue-100 text-blue-800',
    ACCEPTED: 'bg-indigo-100 text-indigo-800',
    IN_KITCHEN: 'bg-yellow-100 text-yellow-800',
    PREPARING: 'bg-orange-100 text-orange-800',
    READY: 'bg-green-100 text-green-800',
    WAITING_FOR_COURIER: 'bg-amber-100 text-amber-800',
    ASSIGNED_TO_COURIER: 'bg-purple-100 text-purple-800',
    PICKED_UP: 'bg-cyan-100 text-cyan-800',
    ON_THE_WAY: 'bg-teal-100 text-teal-800',
    DELIVERED: 'bg-emerald-100 text-emerald-800',
    CANCELLED: 'bg-red-100 text-red-800',
    REFUNDED: 'bg-gray-100 text-gray-800',
  }
  return colors[status] || 'bg-gray-100 text-gray-800'
}

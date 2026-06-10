'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { Order, OrderStatus, Courier } from '@/lib/types'
import { formatPrice, getStatusColor, ORDER_STATUS_LABELS, COURIER_STATUS_LABELS, VEHICLE_TYPE_LABELS } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Bike,
  Car,
  PackageCheck,
  PackageX,
  Phone,
  MapPin,
  MessageSquare,
  DollarSign,
  Clock,
  Power,
  PowerOff,
  ChevronRight,
} from 'lucide-react'

// Simple courier selector (in production this would be login)
const DEMO_COURIER_IDS = ['courier-bike', 'courier-car']

export function CourierSection() {
  const queryClient = useQueryClient()
  const [selectedCourierId, setSelectedCourierId] = useState<string | null>(null)

  const { data: couriers, isLoading: couriersLoading } = useQuery<Courier[]>({
    queryKey: ['couriers'],
    queryFn: () => fetch('/api/couriers').then(r => r.json()),
  })

  const selectedCourier = couriers?.find(c => c.id === selectedCourierId)

  const updateCourierMutation = useMutation({
    mutationFn: async ({ courierId, status }: { courierId: string; status: string }) => {
      const res = await fetch('/api/couriers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courierId, status }),
      })
      if (!res.ok) throw new Error('Chyba pri aktualizácii')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['couriers'] })
      toast.success('Stav aktualizovaný')
    },
  })

  const updateOrderMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatus }) => {
      const res = await fetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('Chyba pri aktualizácii')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courier-orders'] })
      queryClient.invalidateQueries({ queryKey: ['courier-earnings'] })
      toast.success('Stav objednávky aktualizovaný')
    },
  })

  // If no courier selected, show selection
  if (!selectedCourierId) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b">
          <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: '#4f7f2a' }}>
            <Bike className="h-6 w-6" />
            Kuriér
          </h2>
          <p className="text-sm text-muted-foreground">Vyberte kuriéra</p>
        </div>

        <div className="flex-1 p-4 space-y-3">
          {couriersLoading ? (
            [1, 2].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)
          ) : (
            couriers?.map((courier) => (
              <Card
                key={courier.id}
                className="p-4 cursor-pointer hover:shadow-md transition-all"
                onClick={() => setSelectedCourierId(courier.id)}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-12 w-12 rounded-full flex items-center justify-center" style={{ backgroundColor: '#f0f7ec' }}>
                      {courier.vehicleType === 'BICYCLE' ? <Bike className="h-6 w-6" style={{ color: '#4f7f2a' }} /> : <Car className="h-6 w-6" style={{ color: '#4f7f2a' }} />}
                    </div>
                    <div>
                      <h4 className="font-semibold">{courier.displayName}</h4>
                      <p className="text-sm text-muted-foreground">
                        {VEHICLE_TYPE_LABELS[courier.vehicleType]}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge className={
                      courier.status === 'AVAILABLE' ? 'bg-green-100 text-green-800' :
                      courier.status === 'OFFLINE' ? 'bg-gray-100 text-gray-800' :
                      'bg-yellow-100 text-yellow-800'
                    }>
                      {COURIER_STATUS_LABELS[courier.status]}
                    </Badge>
                    <ChevronRight className="h-5 w-5 text-muted-foreground" />
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
      </div>
    )
  }

  // Courier dashboard
  return (
    <CourierDashboard
      courier={selectedCourier!}
      onToggleOnline={(online) => {
        updateCourierMutation.mutate({
          courierId: selectedCourierId,
          status: online ? 'AVAILABLE' : 'OFFLINE',
        })
      }}
      onPickup={(orderId) => {
        updateOrderMutation.mutate({ orderId, status: 'PICKED_UP' })
        updateCourierMutation.mutate({ courierId: selectedCourierId, status: 'PICKING_UP' })
      }}
      onDeliver={(orderId) => {
        updateOrderMutation.mutate({ orderId, status: 'DELIVERED' })
        updateCourierMutation.mutate({ courierId: selectedCourierId, status: 'AVAILABLE' })
      }}
      onBack={() => setSelectedCourierId(null)}
      isToggling={updateCourierMutation.isPending}
    />
  )
}

function CourierDashboard({
  courier,
  onToggleOnline,
  onPickup,
  onDeliver,
  onBack,
  isToggling,
}: {
  courier: Courier
  onToggleOnline: (online: boolean) => void
  onPickup: (orderId: string) => void
  onDeliver: (orderId: string) => void
  onBack: () => void
  isToggling: boolean
}) {
  const isOnline = courier.status !== 'OFFLINE'

  // Fetch assigned orders
  const { data: orders } = useQuery<Order[]>({
    queryKey: ['courier-orders'],
    queryFn: () => fetch('/api/orders?status=ASSIGNED_TO_COURIER').then(r => r.json()),
    enabled: isOnline,
    refetchInterval: 10000,
  })

  // Also fetch orders in relevant statuses
  const { data: pickupOrders } = useQuery<Order[]>({
    queryKey: ['pickup-orders'],
    queryFn: () => fetch('/api/orders?status=PICKED_UP').then(r => r.json()),
    enabled: isOnline,
    refetchInterval: 10000,
  })

  // Fetch earnings
  const { data: earningsData } = useQuery({
    queryKey: ['courier-earnings', courier.id],
    queryFn: () => fetch(`/api/courier-earnings?courierId=${courier.id}`).then(r => r.json()),
  })

  const assignedOrders = [
    ...(orders?.filter(o => o.assignments?.some(a => a.courierId === courier.id)) || []),
    ...(pickupOrders?.filter(o => o.assignments?.some(a => a.courierId === courier.id)) || []),
  ]

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b space-y-3">
        <div className="flex items-center justify-between">
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← Späť
          </Button>
          <div className="flex items-center gap-2">
            <Switch
              checked={isOnline}
              onCheckedChange={onToggleOnline}
              disabled={isToggling}
            />
            <Label className="text-sm font-medium">
              {isOnline ? 'Online' : 'Offline'}
            </Label>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-full flex items-center justify-center" style={{ backgroundColor: '#f0f7ec' }}>
            {courier.vehicleType === 'BICYCLE' ? <Bike className="h-6 w-6" style={{ color: '#4f7f2a' }} /> : <Car className="h-6 w-6" style={{ color: '#4f7f2a' }} />}
          </div>
          <div>
            <h3 className="font-semibold text-lg">{courier.displayName}</h3>
            <Badge className={
              courier.status === 'AVAILABLE' ? 'bg-green-100 text-green-800' :
              courier.status === 'OFFLINE' ? 'bg-gray-100 text-gray-800' :
              courier.status === 'DELIVERING' ? 'bg-blue-100 text-blue-800' :
              'bg-yellow-100 text-yellow-800'
            }>
              {COURIER_STATUS_LABELS[courier.status]}
            </Badge>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
        {/* Today's earnings */}
        <Card className="p-4" style={{ backgroundColor: '#fff4df' }}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <DollarSign className="h-5 w-5" style={{ color: '#4f7f2a' }} />
              <span className="font-medium">Dnešné zárobky</span>
            </div>
            <span className="text-2xl font-bold" style={{ color: '#4f7f2a' }}>
              {formatPrice(earningsData?.summary?.totalEarnings || 0)}
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            {earningsData?.summary?.deliveryCount || 0} doručení
          </p>
        </Card>

        {!isOnline ? (
          <div className="text-center py-12 text-muted-foreground">
            <PowerOff className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Ste offline</p>
            <p className="text-sm mt-1">Prepnite sa online pre prijímanie objednávok</p>
          </div>
        ) : (
          <>
            {/* Assigned orders */}
            <div>
              <h3 className="font-semibold mb-3">Priradené objednávky ({assignedOrders.length})</h3>
              {assignedOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <PackageCheck className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Žiadne priradené objednávky</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {assignedOrders.map((order) => (
                    <Card key={order.id} className="p-4">
                      <div className="flex items-start justify-between mb-2">
                        <span className="font-bold" style={{ color: '#4f7f2a' }}>
                          {order.orderNumber}
                        </span>
                        <Badge className={getStatusColor(order.status)}>
                          {ORDER_STATUS_LABELS[order.status]}
                        </Badge>
                      </div>

                      <div className="space-y-1 text-sm text-muted-foreground mb-3">
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {order.deliveryAddressLine1}{order.deliveryCity ? `, ${order.deliveryCity}` : ''}
                        </div>
                        <div className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {order.customerPhone}
                        </div>
                        {order.deliveryNote && (
                          <div className="flex items-center gap-1">
                            <MessageSquare className="h-3 w-3" />
                            {order.deliveryNote}
                          </div>
                        )}
                      </div>

                      <div className="text-sm mb-3">
                        {order.items.map(item => (
                          <div key={item.id}>
                            {item.quantity}x {item.menuItemNameSnapshot}
                          </div>
                        ))}
                      </div>

                      <div className="flex justify-between items-center">
                        <span className="font-semibold">{formatPrice(order.totalAmount)}</span>
                        <div className="flex gap-2">
                          {order.status === 'ASSIGNED_TO_COURIER' && (
                            <Button
                              size="sm"
                              style={{ backgroundColor: '#4f7f2a', color: 'white' }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#3d6620')}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#4f7f2a')}
                              onClick={() => onPickup(order.id)}
                            >
                              <PackageCheck className="h-4 w-4 mr-1" />
                              Vyzdvihnúť
                            </Button>
                          )}
                          {order.status === 'PICKED_UP' && (
                            <Button
                              size="sm"
                              style={{ backgroundColor: '#c73325', color: 'white' }}
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#a5281d')}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#c73325')}
                              onClick={() => onDeliver(order.id)}
                            >
                              <PackageCheck className="h-4 w-4 mr-1" />
                              Doručené
                            </Button>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { authFetch } from '@/stores/auth-store'
import { toast } from 'sonner'
import type { Order, OrderStatus, Courier } from '@/lib/types'
import { formatPrice, getStatusColor, ORDER_STATUS_LABELS, COURIER_STATUS_LABELS, VEHICLE_TYPE_LABELS } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Bike,
  Car,
  ChevronRight,
  DollarSign,
  History,
  MapPin,
  MessageSquare,
  PackageCheck,
  Phone,
  PowerOff,
  Save,
  User,
} from 'lucide-react'

type CourierProfileForm = {
  displayName: string
  phone: string
  profilePhotoUrl: string
  vehicleType: Courier['vehicleType']
  licensePlate: string
}

function courierAvatar(courier: Courier) {
  if (courier.profilePhotoUrl) {
    return (
      <img
        src={courier.profilePhotoUrl}
        alt={courier.displayName}
        className="h-full w-full rounded-full object-cover"
      />
    )
  }

  if (courier.vehicleType === 'BICYCLE') return <Bike className="h-6 w-6" style={{ color: '#4f7f2a' }} />
  return <Car className="h-6 w-6" style={{ color: '#4f7f2a' }} />
}

export function CourierSection() {
  const queryClient = useQueryClient()
  const [selectedCourierId, setSelectedCourierId] = useState<string | null>(null)

  const { data: couriers, isLoading: couriersLoading } = useQuery<Courier[]>({
    queryKey: ['couriers'],
    queryFn: () => authFetch('/api/couriers').then(r => r.json()),
  })

  const effectiveCourierId = selectedCourierId ?? (couriers?.length === 1 ? couriers[0].id : null)
  const selectedCourier = couriers?.find(c => c.id === effectiveCourierId)

  const updateCourierStatusMutation = useMutation({
    mutationFn: async ({ courierId, status }: { courierId: string; status: string }) => {
      const res = await authFetch('/api/couriers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courierId, status }),
      })
      if (!res.ok) throw new Error('Chyba pri aktualizácii stavu')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['couriers'] })
      toast.success('Stav aktualizovaný')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Chyba pri aktualizácii stavu'),
  })

  const updateOrderMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatus }) => {
      const res = await authFetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('Chyba pri aktualizácii objednávky')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courier-orders'] })
      queryClient.invalidateQueries({ queryKey: ['courier-orders-picked-up'] })
      queryClient.invalidateQueries({ queryKey: ['courier-orders-on-the-way'] })
      queryClient.invalidateQueries({ queryKey: ['courier-orders-delivered'] })
      queryClient.invalidateQueries({ queryKey: ['courier-earnings'] })
      queryClient.invalidateQueries({ queryKey: ['couriers'] })
      toast.success('Stav objednávky aktualizovaný')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Chyba pri aktualizácii objednávky'),
  })

  if (!effectiveCourierId) {
    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b">
          <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: '#4f7f2a' }}>
            <Bike className="h-6 w-6" />
            Kuriér
          </h2>
          <p className="text-sm text-muted-foreground">Vyberte kuriérsky profil</p>
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
                    <div className="h-12 w-12 rounded-full flex items-center justify-center overflow-hidden" style={{ backgroundColor: '#f0f7ec' }}>
                      {courierAvatar(courier)}
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

  if (!selectedCourier) {
    return (
      <div className="p-4">
        <Skeleton className="h-32 rounded-xl" />
      </div>
    )
  }

  return (
    <CourierDashboard
      key={selectedCourier.id}
      courier={selectedCourier}
      onToggleOnline={(online) => {
        updateCourierStatusMutation.mutate({
          courierId: effectiveCourierId,
          status: online ? 'AVAILABLE' : 'OFFLINE',
        })
      }}
      onPickup={(orderId) => {
        updateOrderMutation.mutate({ orderId, status: 'PICKED_UP' })
        updateCourierStatusMutation.mutate({ courierId: effectiveCourierId, status: 'PICKING_UP' })
      }}
      onStartDelivery={(orderId) => {
        updateOrderMutation.mutate({ orderId, status: 'ON_THE_WAY' })
        updateCourierStatusMutation.mutate({ courierId: effectiveCourierId, status: 'DELIVERING' })
      }}
      onDeliver={(orderId) => {
        updateOrderMutation.mutate({ orderId, status: 'DELIVERED' })
        updateCourierStatusMutation.mutate({ courierId: effectiveCourierId, status: 'AVAILABLE' })
      }}
      onBack={() => setSelectedCourierId(null)}
      isToggling={updateCourierStatusMutation.isPending}
    />
  )
}

function CourierDashboard({
  courier,
  onToggleOnline,
  onPickup,
  onStartDelivery,
  onDeliver,
  onBack,
  isToggling,
}: {
  courier: Courier
  onToggleOnline: (online: boolean) => void
  onPickup: (orderId: string) => void
  onStartDelivery: (orderId: string) => void
  onDeliver: (orderId: string) => void
  onBack: () => void
  isToggling: boolean
}) {
  const queryClient = useQueryClient()
  const isOnline = courier.status !== 'OFFLINE'
  const [profileForm, setProfileForm] = useState<CourierProfileForm>({
    displayName: courier.displayName,
    phone: courier.phone || '',
    profilePhotoUrl: courier.profilePhotoUrl || '',
    vehicleType: courier.vehicleType,
    licensePlate: courier.licensePlate || '',
  })

  const updateProfileMutation = useMutation({
    mutationFn: async () => {
      const res = await authFetch('/api/couriers', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          courierId: courier.id,
          displayName: profileForm.displayName,
          phone: profileForm.phone || null,
          profilePhotoUrl: profileForm.profilePhotoUrl || null,
          vehicleType: profileForm.vehicleType,
          licensePlate: profileForm.vehicleType === 'CAR' ? profileForm.licensePlate || null : null,
          status: courier.status,
        }),
      })
      if (!res.ok) throw new Error((await res.json()).error || 'Chyba pri ukladaní profilu')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['couriers'] })
      toast.success('Profil uložený')
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : 'Chyba pri ukladaní profilu'),
  })

  const { data: orders } = useQuery<Order[]>({
    queryKey: ['courier-orders'],
    queryFn: () => authFetch('/api/orders?status=ASSIGNED_TO_COURIER').then(r => r.json()),
    enabled: isOnline,
    refetchInterval: 10000,
  })

  const { data: pickupOrders } = useQuery<Order[]>({
    queryKey: ['courier-orders-picked-up'],
    queryFn: () => authFetch('/api/orders?status=PICKED_UP').then(r => r.json()),
    enabled: isOnline,
    refetchInterval: 10000,
  })

  const { data: onTheWayOrders } = useQuery<Order[]>({
    queryKey: ['courier-orders-on-the-way'],
    queryFn: () => authFetch('/api/orders?status=ON_THE_WAY').then(r => r.json()),
    enabled: isOnline,
    refetchInterval: 10000,
  })

  const { data: deliveredOrders } = useQuery<Order[]>({
    queryKey: ['courier-orders-delivered'],
    queryFn: () => authFetch('/api/orders?status=DELIVERED').then(r => r.json()),
    enabled: isOnline,
    refetchInterval: 30000,
  })

  const { data: earningsData } = useQuery({
    queryKey: ['courier-earnings', courier.id],
    queryFn: () => authFetch(`/api/courier-earnings?courierId=${courier.id}`).then(r => r.json()),
  })

  const assignedOrders = [
    ...(orders?.filter(o => o.assignments?.some(a => a.courierId === courier.id)) || []),
    ...(pickupOrders?.filter(o => o.assignments?.some(a => a.courierId === courier.id)) || []),
    ...(onTheWayOrders?.filter(o => o.assignments?.some(a => a.courierId === courier.id)) || []),
  ]

  const pastOrders = (deliveredOrders || [])
    .filter(o => o.assignments?.some(a => a.courierId === courier.id))
    .slice(0, 20)

  return (
    <div className="flex flex-col h-full">
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
          <div className="h-12 w-12 rounded-full flex items-center justify-center overflow-hidden" style={{ backgroundColor: '#f0f7ec' }}>
            {courierAvatar(courier)}
          </div>
          <div>
            <h3 className="font-semibold text-lg">{courier.displayName}</h3>
            <div className="flex flex-wrap gap-2 mt-1">
              <Badge className={
                courier.status === 'AVAILABLE' ? 'bg-green-100 text-green-800' :
                courier.status === 'OFFLINE' ? 'bg-gray-100 text-gray-800' :
                courier.status === 'DELIVERING' ? 'bg-blue-100 text-blue-800' :
                'bg-yellow-100 text-yellow-800'
              }>
                {COURIER_STATUS_LABELS[courier.status]}
              </Badge>
              <Badge variant="outline">{VEHICLE_TYPE_LABELS[courier.vehicleType]}</Badge>
              {courier.vehicleType === 'CAR' && courier.licensePlate && (
                <Badge variant="outline">SPZ: {courier.licensePlate}</Badge>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
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

        <Card className="p-4 space-y-3">
          <h3 className="font-semibold flex items-center gap-2">
            <User className="h-4 w-4" style={{ color: '#4f7f2a' }} />
            Môj profil
          </h3>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Meno</Label>
              <Input
                value={profileForm.displayName}
                onChange={(e) => setProfileForm(prev => ({ ...prev, displayName: e.target.value }))}
              />
            </div>
            <div>
              <Label>Telefón</Label>
              <Input
                value={profileForm.phone}
                onChange={(e) => setProfileForm(prev => ({ ...prev, phone: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <Label>Fotka profilu (URL)</Label>
            <Input
              value={profileForm.profilePhotoUrl}
              placeholder="https://..."
              onChange={(e) => setProfileForm(prev => ({ ...prev, profilePhotoUrl: e.target.value }))}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Dopravný prostriedok</Label>
              <Select
                value={profileForm.vehicleType}
                onValueChange={(value) => setProfileForm(prev => ({ ...prev, vehicleType: value as Courier['vehicleType'] }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="BICYCLE">Bicykel</SelectItem>
                  <SelectItem value="SCOOTER">Skúter</SelectItem>
                  <SelectItem value="CAR">Auto</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {profileForm.vehicleType === 'CAR' && (
              <div>
                <Label>SPZ auta</Label>
                <Input
                  value={profileForm.licensePlate}
                  placeholder="HC123AB"
                  onChange={(e) => setProfileForm(prev => ({ ...prev, licensePlate: e.target.value.toUpperCase() }))}
                />
              </div>
            )}
          </div>
          <Button
            disabled={updateProfileMutation.isPending || !profileForm.displayName.trim()}
            onClick={() => updateProfileMutation.mutate()}
            style={{ backgroundColor: '#4f7f2a', color: 'white' }}
          >
            <Save className="h-4 w-4 mr-2" />
            {updateProfileMutation.isPending ? 'Ukladám...' : 'Uložiť profil'}
          </Button>
        </Card>

        {!isOnline ? (
          <div className="text-center py-12 text-muted-foreground">
            <PowerOff className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p>Ste offline</p>
            <p className="text-sm mt-1">Prepnite sa online pre prijímanie objednávok</p>
          </div>
        ) : (
          <>
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
                    <CourierOrderCard
                      key={order.id}
                      order={order}
                      onPickup={onPickup}
                      onStartDelivery={onStartDelivery}
                      onDeliver={onDeliver}
                    />
                  ))}
                </div>
              )}
            </div>

            <div>
              <h3 className="font-semibold mb-3 flex items-center gap-2">
                <History className="h-4 w-4" style={{ color: '#4f7f2a' }} />
                Minulé objednávky ({pastOrders.length})
              </h3>
              {pastOrders.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <History className="h-10 w-10 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Zatiaľ žiadne doručené objednávky</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {pastOrders.map((order) => (
                    <Card key={order.id} className="p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold" style={{ color: '#4f7f2a' }}>{order.orderNumber}</div>
                          <div className="text-sm text-muted-foreground">{order.customerName}</div>
                          {order.deliveryAddressLine1 && (
                            <div className="text-xs text-muted-foreground">
                              {order.deliveryAddressLine1}{order.deliveryCity ? `, ${order.deliveryCity}` : ''}
                            </div>
                          )}
                        </div>
                        <div className="text-right">
                          <div className="font-semibold">{formatPrice(order.totalAmount)}</div>
                          <div className="text-xs text-muted-foreground">
                            {order.deliveredAt
                              ? new Date(order.deliveredAt).toLocaleDateString('sk-SK')
                              : new Date(order.createdAt).toLocaleDateString('sk-SK')}
                          </div>
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

function CourierOrderCard({
  order,
  onPickup,
  onStartDelivery,
  onDeliver,
}: {
  order: Order
  onPickup: (orderId: string) => void
  onStartDelivery: (orderId: string) => void
  onDeliver: (orderId: string) => void
}) {
  return (
    <Card className="p-4">
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
              onClick={() => onPickup(order.id)}
            >
              <PackageCheck className="h-4 w-4 mr-1" />
              Vyzdvihnúť
            </Button>
          )}
          {order.status === 'PICKED_UP' && (
            <Button
              size="sm"
              style={{ backgroundColor: '#4f7f2a', color: 'white' }}
              onClick={() => onStartDelivery(order.id)}
            >
              <PackageCheck className="h-4 w-4 mr-1" />
              Na ceste
            </Button>
          )}
          {order.status === 'ON_THE_WAY' && (
            <Button
              size="sm"
              style={{ backgroundColor: '#c73325', color: 'white' }}
              onClick={() => onDeliver(order.id)}
            >
              <PackageCheck className="h-4 w-4 mr-1" />
              Doručené
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}

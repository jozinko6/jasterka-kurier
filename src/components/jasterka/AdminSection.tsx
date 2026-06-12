'use client'

import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { authFetch } from '@/stores/auth-store'
import { toast } from 'sonner'
import type { Order, OrderStatus, Courier, DeliveryZone, RestaurantSettings, MenuCategory } from '@/lib/types'
import { formatPrice, getStatusColor, ORDER_STATUS_LABELS, COURIER_STATUS_LABELS, VEHICLE_TYPE_LABELS } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  ClipboardList,
  Settings,
  Users,
  BarChart3,
  UtensilsCrossed,
  Eye,
  UserCheck,
  TrendingUp,
  DollarSign,
  ShoppingBag,
  RefreshCw,
  Truck,
  Phone,
  Mail,
  MapPin,
  MessageSquare,
  User,
  Clock,
} from 'lucide-react'

export function AdminSection() {
  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <h2 className="text-xl font-bold" style={{ color: '#4f7f2a' }}>Administrácia</h2>
        <p className="text-sm text-muted-foreground">Správa objednávok, menu a nastavení</p>
      </div>

      <Tabs defaultValue="orders" className="flex-1 flex flex-col">
        <div className="px-4 pt-2">
          <TabsList className="w-full flex-wrap h-auto gap-1 bg-transparent p-0">
            <TabsTrigger value="orders" className="rounded-md data-[state=active]:text-white text-sm px-3 py-2">
              <ClipboardList className="h-4 w-4 mr-1" />
              Objednávky
            </TabsTrigger>
            <TabsTrigger value="menu" className="rounded-md data-[state=active]:text-white text-sm px-3 py-2">
              <UtensilsCrossed className="h-4 w-4 mr-1" />
              Menu
            </TabsTrigger>
            <TabsTrigger value="settings" className="rounded-md data-[state=active]:text-white text-sm px-3 py-2">
              <Settings className="h-4 w-4 mr-1" />
              Nastavenia
            </TabsTrigger>
            <TabsTrigger value="couriers" className="rounded-md data-[state=active]:text-white text-sm px-3 py-2">
              <Users className="h-4 w-4 mr-1" />
              Kuriéri
            </TabsTrigger>
            <TabsTrigger value="stats" className="rounded-md data-[state=active]:text-white text-sm px-3 py-2">
              <BarChart3 className="h-4 w-4 mr-1" />
              Štatistiky
            </TabsTrigger>
          </TabsList>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar">
          <TabsContent value="orders" className="m-0 p-4">
            <AdminOrders />
          </TabsContent>
          <TabsContent value="menu" className="m-0 p-4">
            <AdminMenu />
          </TabsContent>
          <TabsContent value="settings" className="m-0 p-4">
            <AdminSettings />
          </TabsContent>
          <TabsContent value="couriers" className="m-0 p-4">
            <AdminCouriers />
          </TabsContent>
          <TabsContent value="stats" className="m-0 p-4">
            <AdminStats />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  )
}

// ─── Admin Orders ───
function AdminOrders() {
  const queryClient = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('ALL')
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)

  const { data: orders, isLoading } = useQuery<Order[]>({
    queryKey: ['admin-orders', statusFilter],
    queryFn: () => {
      const params = statusFilter !== 'ALL' ? `?status=${statusFilter}` : ''
      return authFetch(`/api/orders${params}`).then(r => r.json())
    },
  })

  const { data: couriers } = useQuery<Courier[]>({
    queryKey: ['couriers'],
    queryFn: () => authFetch('/api/couriers').then(r => r.json()),
  })

  const updateStatusMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatus }) => {
      const res = await authFetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('Chyba pri aktualizácii')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      toast.success('Stav objednávky aktualizovaný')
    },
    onError: () => toast.error('Chyba pri aktualizácii stavu'),
  })

  const assignCourierMutation = useMutation({
    mutationFn: async ({ orderId, courierId }: { orderId: string; courierId: string }) => {
      const res = await authFetch('/api/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId, courierId }),
      })
      if (!res.ok) throw new Error('Chyba pri priraďovaní')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] })
      toast.success('Kuriér priradený')
    },
    onError: () => toast.error('Chyba pri priraďovaní kuriéra'),
  })

  const handleViewDetail = (order: Order) => {
    setSelectedOrder(order)
    setDetailOpen(true)
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4, 5].map(i => (
          <Skeleton key={i} className="h-16 rounded-lg" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <Label className="text-sm font-medium">Filter stavu:</Label>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">Všetky</SelectItem>
            {Object.entries(ORDER_STATUS_LABELS).map(([key, label]) => (
              <SelectItem key={key} value={key}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground">
          {orders?.length || 0} objednávok
        </span>
      </div>

      {/* Orders table */}
      <div className="rounded-lg border overflow-hidden">
        <div className="overflow-x-auto max-h-[calc(100vh-280px)] custom-scrollbar">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Číslo</TableHead>
                <TableHead>Zákazník</TableHead>
                <TableHead>Typ</TableHead>
                <TableHead>Stav</TableHead>
                <TableHead>Suma</TableHead>
                <TableHead>Čas</TableHead>
                <TableHead>Akcie</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {orders?.map((order) => (
                <TableRow key={order.id} className="cursor-pointer hover:bg-muted/50" onClick={() => handleViewDetail(order)}>
                  <TableCell className="font-medium" style={{ color: '#4f7f2a' }}>{order.orderNumber}</TableCell>
                  <TableCell>{order.customerName}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-xs">
                      {order.orderType === 'DELIVERY' ? '🚗 Rozvoz' : '📦 Odber'}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <Badge className={`text-xs ${getStatusColor(order.status)}`}>
                      {ORDER_STATUS_LABELS[order.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-medium">{formatPrice(order.totalAmount)}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(order.createdAt).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' })}
                  </TableCell>
                  <TableCell>
                    <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); handleViewDetail(order) }}>
                      <Eye className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {(!orders || orders.length === 0) && (
                <TableRow>
                  <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                    Žiadne objednávky
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Order detail dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle style={{ color: '#4f7f2a' }}>
              Objednávka {selectedOrder?.orderNumber}
            </DialogTitle>
            <DialogDescription>Detail objednávky a akcie</DialogDescription>
          </DialogHeader>
          {selectedOrder && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge className={getStatusColor(selectedOrder.status)}>
                  {ORDER_STATUS_LABELS[selectedOrder.status]}
                </Badge>
                <Badge variant="outline">
                  {selectedOrder.orderType === 'DELIVERY' ? 'Rozvoz' : 'Osobný odber'}
                </Badge>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2"><User className="h-4 w-4 text-muted-foreground" />{selectedOrder.customerName}</div>
                <div className="flex items-center gap-2"><Phone className="h-4 w-4 text-muted-foreground" />{selectedOrder.customerPhone}</div>
                {selectedOrder.customerEmail && <div className="flex items-center gap-2"><Mail className="h-4 w-4 text-muted-foreground" />{selectedOrder.customerEmail}</div>}
                {selectedOrder.deliveryAddressLine1 && <div className="flex items-center gap-2"><MapPin className="h-4 w-4 text-muted-foreground" />{selectedOrder.deliveryAddressLine1}{selectedOrder.deliveryCity ? `, ${selectedOrder.deliveryCity}` : ''}</div>}
                {selectedOrder.kitchenNote && <div className="flex items-center gap-2"><MessageSquare className="h-4 w-4 text-red-500" />{selectedOrder.kitchenNote}</div>}
              </div>

              <Separator />

              <div className="space-y-2">
                <h4 className="font-semibold text-sm">Položky</h4>
                {selectedOrder.items.map((item) => (
                  <div key={item.id} className="flex justify-between text-sm">
                    <span>{item.quantity}x {item.menuItemNameSnapshot}</span>
                    <span>{formatPrice(item.lineTotal)}</span>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between text-sm text-muted-foreground">
                  <span>Medzisúčet</span>
                  <span>{formatPrice(selectedOrder.subtotalAmount)}</span>
                </div>
                {selectedOrder.deliveryFee > 0 && (
                  <div className="flex justify-between text-sm text-muted-foreground">
                    <span>Dopravné</span>
                    <span>{formatPrice(selectedOrder.deliveryFee)}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold">
                  <span>Celkom</span>
                  <span style={{ color: '#4f7f2a' }}>{formatPrice(selectedOrder.totalAmount)}</span>
                </div>
              </div>

              <Separator />

              {/* Status update */}
              <div>
                <Label className="text-sm font-semibold">Zmeniť stav</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {(['ACCEPTED', 'IN_KITCHEN', 'PREPARING', 'READY', 'DELIVERED', 'CANCELLED'] as OrderStatus[]).map((s) => (
                    <Button
                      key={s}
                      variant={selectedOrder.status === s ? 'default' : 'outline'}
                      size="sm"
                      disabled={updateStatusMutation.isPending}
                      onClick={() => updateStatusMutation.mutate({ orderId: selectedOrder.id, status: s })}
                    >
                      {ORDER_STATUS_LABELS[s]}
                    </Button>
                  ))}
                </div>
              </div>

              {/* Assign courier for delivery orders */}
              {selectedOrder.orderType === 'DELIVERY' && (
                <div>
                  <Label className="text-sm font-semibold flex items-center gap-1">
                    <Truck className="h-4 w-4" />
                    Priradiť kuriéra
                  </Label>
                  <div className="flex flex-wrap gap-2 mt-2">
                    {couriers?.filter(c => c.isActive && c.status !== 'OFFLINE').map((c) => (
                      <Button
                        key={c.id}
                        variant="outline"
                        size="sm"
                        disabled={assignCourierMutation.isPending}
                        onClick={() => assignCourierMutation.mutate({ orderId: selectedOrder.id, courierId: c.id })}
                      >
                        <UserCheck className="h-3 w-3 mr-1" />
                        {c.displayName}
                      </Button>
                    ))}
                    {couriers?.filter(c => c.isActive && c.status !== 'OFFLINE').length === 0 && (
                      <p className="text-sm text-muted-foreground">Žiadni dostupní kuriéri</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ─── Admin Menu ───
function AdminMenu() {
  const queryClient = useQueryClient()

  const { data: categories, isLoading } = useQuery<MenuCategory[]>({
    queryKey: ['admin-categories'],
    queryFn: () => authFetch('/api/admin/categories').then(r => r.json()),
  })

  const updateMenuItemMutation = useMutation({
    mutationFn: async ({ id, ...fields }: { id: string; isActive?: boolean; isAvailable?: boolean }) => {
      const res = await authFetch('/api/admin/menu', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, ...fields }),
      })
      if (!res.ok) throw new Error('Chyba pri aktualizácii')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-categories'] })
      queryClient.invalidateQueries({ queryKey: ['menu'] })
      toast.success('Položka aktualizovaná')
    },
    onError: () => toast.error('Chyba pri aktualizácii'),
  })

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map(i => (
          <Skeleton key={i} className="h-48 rounded-xl" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {categories?.map((cat) => (
        <Card key={cat.id}>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>
                {cat.name}
                <span className="text-sm font-normal text-muted-foreground ml-2">
                  ({cat.menuItems.length} položiek)
                </span>
              </span>
              <Badge variant={cat.isActive ? 'default' : 'secondary'} className={cat.isActive ? 'bg-green-100 text-green-800' : ''}>
                {cat.isActive ? 'Aktívna' : 'Neaktívna'}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {cat.menuItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{item.name}</span>
                      {item.isFeatured && (
                        <Badge className="text-xs" style={{ backgroundColor: '#c73325', color: 'white' }}>Akcia</Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{formatPrice(item.basePrice)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Viditeľné</Label>
                      <Switch
                        checked={item.isActive}
                        onCheckedChange={(checked) => updateMenuItemMutation.mutate({ id: item.id, isActive: checked })}
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <Label className="text-xs text-muted-foreground">Dostupné</Label>
                      <Switch
                        checked={item.isAvailable}
                        onCheckedChange={(checked) => updateMenuItemMutation.mutate({ id: item.id, isAvailable: checked })}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

// ─── Admin Settings ───
function AdminSettings() {
  const queryClient = useQueryClient()

  const { data: settings, isLoading } = useQuery<RestaurantSettings>({
    queryKey: ['settings'],
    queryFn: () => authFetch('/api/settings').then(r => r.json()),
  })

  const [form, setForm] = useState<Partial<RestaurantSettings>>({})

  // Sync form with loaded settings
  const [synced, setSynced] = useState(false)
  if (settings && !synced) {
    setForm({
      deliveryEnabled: settings.deliveryEnabled,
      pickupEnabled: settings.pickupEnabled,
      isOpen: settings.isOpen,
      customerMessage: settings.customerMessage || '',
      averagePrepMinutes: settings.averagePrepMinutes,
      minimumOrderAmount: settings.minimumOrderAmount,
      storePhone: settings.storePhone || '',
      storeAddress: settings.storeAddress || '',
    })
    setSynced(true)
  }

  const updateSettingsMutation = useMutation({
    mutationFn: async (data: Partial<RestaurantSettings>) => {
      const res = await authFetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!res.ok) throw new Error('Chyba pri ukladaní')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settings'] })
      toast.success('Nastavenia uložené')
    },
    onError: () => toast.error('Chyba pri ukladaní nastavení'),
  })

  if (isLoading) return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 rounded-lg" />)}</div>

  return (
    <div className="space-y-6 max-w-lg">
      {/* Toggle settings */}
      <Card className="p-4 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Settings className="h-4 w-4" style={{ color: '#4f7f2a' }} />
          Prevádzka
        </h3>

        <div className="flex items-center justify-between">
          <Label>Otvorené</Label>
          <Switch
            checked={form.isOpen}
            onCheckedChange={(v) => setForm(prev => ({ ...prev, isOpen: v }))}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label>Rozvoz povolený</Label>
          <Switch
            checked={form.deliveryEnabled}
            onCheckedChange={(v) => setForm(prev => ({ ...prev, deliveryEnabled: v }))}
          />
        </div>

        <div className="flex items-center justify-between">
          <Label>Osobný odber povolený</Label>
          <Switch
            checked={form.pickupEnabled}
            onCheckedChange={(v) => setForm(prev => ({ ...prev, pickupEnabled: v }))}
          />
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <MessageSquare className="h-4 w-4" style={{ color: '#4f7f2a' }} />
          Správa pre zákazníkov
        </h3>
        <Textarea
          value={form.customerMessage || ''}
          onChange={(e) => setForm(prev => ({ ...prev, customerMessage: e.target.value }))}
          placeholder="Např. Vitajte v Pizza Jašterka!"
          rows={3}
        />
      </Card>

      <Card className="p-4 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Clock className="h-4 w-4" style={{ color: '#4f7f2a' }} />
          Čas a objednávky
        </h3>
        <div className="space-y-3">
          <div>
            <Label>Priemerný čas prípravy (min)</Label>
            <Input
              type="number"
              value={form.averagePrepMinutes || ''}
              onChange={(e) => setForm(prev => ({ ...prev, averagePrepMinutes: parseInt(e.target.value) || 0 }))}
            />
          </div>
          <div>
            <Label>Minimálna suma objednávky (€)</Label>
            <Input
              type="number"
              step="0.01"
              value={form.minimumOrderAmount || ''}
              onChange={(e) => setForm(prev => ({ ...prev, minimumOrderAmount: parseFloat(e.target.value) || 0 }))}
            />
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <h3 className="font-semibold flex items-center gap-2">
          <Phone className="h-4 w-4" style={{ color: '#4f7f2a' }} />
          Kontakt
        </h3>
        <div className="space-y-3">
          <div>
            <Label>Telefón</Label>
            <Input
              value={form.storePhone || ''}
              onChange={(e) => setForm(prev => ({ ...prev, storePhone: e.target.value }))}
              placeholder="+421 900 123 456"
            />
          </div>
          <div>
            <Label>Adresa</Label>
            <Input
              value={form.storeAddress || ''}
              onChange={(e) => setForm(prev => ({ ...prev, storeAddress: e.target.value }))}
              placeholder="Hlavná 45, 920 01 Hlohovec"
            />
          </div>
        </div>
      </Card>

      <Button
        className="w-full"
        disabled={updateSettingsMutation.isPending}
        style={{ backgroundColor: '#4f7f2a', color: 'white' }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#3d6620')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#4f7f2a')}
        onClick={() => updateSettingsMutation.mutate(form)}
      >
        {updateSettingsMutation.isPending ? 'Ukladám...' : 'Uložiť nastavenia'}
      </Button>
    </div>
  )
}

// ─── Admin Couriers ───
function AdminCouriers() {
  const queryClient = useQueryClient()

  const { data: couriers, isLoading } = useQuery<Courier[]>({
    queryKey: ['couriers'],
    queryFn: () => authFetch('/api/couriers').then(r => r.json()),
  })

  const updateCourierMutation = useMutation({
    mutationFn: async ({ courierId, status }: { courierId: string; status: string }) => {
      const res = await authFetch('/api/couriers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courierId, status }),
      })
      if (!res.ok) throw new Error('Chyba pri aktualizácii')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['couriers'] })
      toast.success('Stav kuriéra aktualizovaný')
    },
    onError: () => toast.error('Chyba pri aktualizácii'),
  })

  if (isLoading) return <div className="space-y-3">{[1, 2].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        {couriers?.map((courier) => (
          <Card key={courier.id} className="p-4">
            <div className="flex items-start justify-between mb-3">
              <div>
                <h4 className="font-semibold">{courier.displayName}</h4>
                <div className="text-sm text-muted-foreground space-y-0.5 mt-1">
                  {courier.phone && (
                    <div className="flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      {courier.phone}
                    </div>
                  )}
                  <div className="flex items-center gap-1">
                    <Truck className="h-3 w-3" />
                    {VEHICLE_TYPE_LABELS[courier.vehicleType] || courier.vehicleType}
                  </div>
                </div>
              </div>
              <Badge className={
                courier.status === 'AVAILABLE' ? 'bg-green-100 text-green-800' :
                courier.status === 'OFFLINE' ? 'bg-gray-100 text-gray-800' :
                courier.status === 'DELIVERING' ? 'bg-blue-100 text-blue-800' :
                'bg-yellow-100 text-yellow-800'
              }>
                {COURIER_STATUS_LABELS[courier.status] || courier.status}
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Label className="text-xs">Aktívny</Label>
                <Switch
                  checked={courier.isActive}
                  disabled
                />
              </div>
              <Select
                value={courier.status}
                onValueChange={(val) => updateCourierMutation.mutate({ courierId: courier.id, status: val })}
              >
                <SelectTrigger className="w-32">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="OFFLINE">Offline</SelectItem>
                  <SelectItem value="AVAILABLE">Dostupný</SelectItem>
                  <SelectItem value="BREAK">Pauza</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {courier.activeOrderCount > 0 && (
              <div className="mt-2 text-xs text-muted-foreground">
                Aktívne objednávky: {courier.activeOrderCount}
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  )
}

// ─── Admin Stats ───
function AdminStats() {
  const { data: stats, isLoading } = useQuery({
    queryKey: ['stats'],
    queryFn: () => authFetch('/api/stats').then(r => r.json()),
  })

  if (isLoading) return <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-24 rounded-xl" />)}</div>

  return (
    <div className="space-y-6">
      {/* Key metrics */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#f0f7ec' }}>
              <ShoppingBag className="h-5 w-5" style={{ color: '#4f7f2a' }} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Dnešné objednávky</p>
              <p className="text-2xl font-bold">{stats?.todaysOrderCount || 0}</p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#fff4df' }}>
              <DollarSign className="h-5 w-5" style={{ color: '#c73325' }} />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Dnešný obrat</p>
              <p className="text-2xl font-bold" style={{ color: '#4f7f2a' }}>
                {formatPrice(stats?.todaysRevenue || 0)}
              </p>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#e8f4fd' }}>
              <TrendingUp className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <p className="text-sm text-muted-foreground">Celkom objednávok</p>
              <p className="text-2xl font-bold">
                {Object.values(stats?.orderCountsByStatus || {}).reduce((a: number, b: unknown) => a + Number(b), 0) as number}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Status breakdown */}
      <Card className="p-4">
        <h3 className="font-semibold mb-4 flex items-center gap-2">
          <BarChart3 className="h-4 w-4" style={{ color: '#4f7f2a' }} />
          Objednávky podľa stavu
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Object.entries(ORDER_STATUS_LABELS).map(([status, label]) => {
            const count = (stats?.orderCountsByStatus?.[status] || 0) as number
            return (
              <div key={status} className="flex items-center justify-between p-3 rounded-lg bg-muted/50">
                <div className="flex items-center gap-2">
                  <Badge className={`text-xs ${getStatusColor(status as OrderStatus)}`}>{label}</Badge>
                </div>
                <span className="text-lg font-bold">{count}</span>
              </div>
            )
          })}
        </div>
      </Card>
    </div>
  )
}

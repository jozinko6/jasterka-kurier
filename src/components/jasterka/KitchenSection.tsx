'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { authFetch } from '@/stores/auth-store'
import { toast } from 'sonner'
import type { Order, OrderStatus } from '@/lib/types'
import { formatPrice, getStatusColor, ORDER_STATUS_LABELS } from '@/lib/types'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ChefHat,
  Clock,
  User,
  Phone,
  MapPin,
  MessageSquare,
  ArrowRight,
  RefreshCw,
} from 'lucide-react'

const KITCHEN_COLUMNS: { status: OrderStatus; label: string; color: string }[] = [
  { status: 'NEW', label: 'Nové', color: '#3b82f6' },
  { status: 'ACCEPTED', label: 'Prijaté', color: '#8b5cf6' },
  { status: 'IN_KITCHEN', label: 'V kuchyni', color: '#f59e0b' },
  { status: 'PREPARING', label: 'Pripravuje sa', color: '#f97316' },
  { status: 'READY', label: 'Hotové', color: '#22c55e' },
]

const NEXT_STATUS_MAP: Record<string, OrderStatus> = {
  NEW: 'ACCEPTED',
  ACCEPTED: 'IN_KITCHEN',
  IN_KITCHEN: 'PREPARING',
  PREPARING: 'READY',
}

const NEXT_STATUS_LABEL: Record<string, string> = {
  NEW: 'Prijať',
  ACCEPTED: 'Do kuchyne',
  IN_KITCHEN: 'Začať prípravu',
  PREPARING: 'Hotové',
}

export function KitchenSection() {
  const queryClient = useQueryClient()

  const { data: orders, isLoading, refetch } = useQuery<Order[]>({
    queryKey: ['kitchen'],
    queryFn: () => authFetch('/api/kitchen').then(r => r.json()),
    refetchInterval: 10000,
  })

  const updateStatusMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: string; status: OrderStatus }) => {
      const res = await authFetch(`/api/orders/${orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) throw new Error('Chyba pri aktualizácii stavu')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kitchen'] })
      queryClient.invalidateQueries({ queryKey: ['orders'] })
    },
    onError: () => {
      toast.error('Chyba pri aktualizácii stavu')
    },
  })

  const getOrdersByStatus = (status: OrderStatus) =>
    orders?.filter(o => o.status === status) || []

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2" style={{ color: '#4f7f2a' }}>
            <ChefHat className="h-6 w-6" />
            Kuchyňa
          </h2>
          <p className="text-sm text-muted-foreground">Správa objednávok v kuchyni</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => refetch()}
          className="gap-1"
        >
          <RefreshCw className="h-4 w-4" />
          Obnoviť
        </Button>
      </div>

      {/* Kanban board */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 p-4">
          {[1, 2, 3, 4, 5].map(i => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-10 rounded-lg" />
              <Skeleton className="h-32 rounded-xl" />
              <Skeleton className="h-32 rounded-xl" />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-x-auto p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 min-w-[1000px]">
            {KITCHEN_COLUMNS.map((col) => (
              <div key={col.status} className="space-y-3">
                {/* Column header */}
                <div
                  className="flex items-center justify-between rounded-lg p-3 text-white"
                  style={{ backgroundColor: col.color }}
                >
                  <span className="font-semibold text-sm">{col.label}</span>
                  <Badge className="bg-white/20 text-white border-0">
                    {getOrdersByStatus(col.status).length}
                  </Badge>
                </div>

                {/* Cards */}
                <div className="space-y-3 max-h-[calc(100vh-220px)] overflow-y-auto custom-scrollbar">
                  {getOrdersByStatus(col.status).map((order) => (
                    <KitchenCard
                      key={order.id}
                      order={order}
                      onNext={
                        NEXT_STATUS_MAP[order.status]
                          ? () => updateStatusMutation.mutate({
                              orderId: order.id,
                              status: NEXT_STATUS_MAP[order.status],
                            })
                          : undefined
                      }
                      nextLabel={NEXT_STATUS_LABEL[order.status]}
                      isMutating={updateStatusMutation.isPending}
                    />
                  ))}
                  {getOrdersByStatus(col.status).length === 0 && (
                    <div className="text-center py-6 text-muted-foreground text-sm">
                      Žiadne objednávky
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function KitchenCard({
  order,
  onNext,
  nextLabel,
  isMutating,
}: {
  order: Order
  onNext?: () => void
  nextLabel?: string
  isMutating: boolean
}) {
  const timeAgo = getTimeAgo(order.createdAt)

  return (
    <Card className="overflow-hidden border-border/60">
      <div
        className="h-1.5"
        style={{ backgroundColor: getStatusColor(order.status).includes('blue') ? '#3b82f6'
          : getStatusColor(order.status).includes('indigo') ? '#8b5cf6'
          : getStatusColor(order.status).includes('yellow') ? '#f59e0b'
          : getStatusColor(order.status).includes('orange') ? '#f97316'
          : getStatusColor(order.status).includes('green') ? '#22c55e'
          : '#94a3b8' }}
      />
      <CardContent className="p-4 space-y-3">
        {/* Order number and time */}
        <div className="flex items-center justify-between">
          <span className="font-bold text-base" style={{ color: '#4f7f2a' }}>
            {order.orderNumber}
          </span>
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {timeAgo}
          </div>
        </div>

        {/* Items */}
        <div className="space-y-1">
          {order.items.map((item) => (
            <div key={item.id} className="text-sm">
              <span className="font-medium">{item.quantity}x</span>{' '}
              {item.menuItemNameSnapshot}
              {item.selectedSize && (
                <span className="text-muted-foreground"> ({item.selectedSize})</span>
              )}
              {item.kitchenNote && (
                <div className="text-xs text-red-600 ml-4 flex items-center gap-1">
                  <MessageSquare className="h-3 w-3" />
                  {item.kitchenNote}
                </div>
              )}
            </div>
          ))}
        </div>

        <Separator />

        {/* Customer info */}
        <div className="space-y-1 text-xs text-muted-foreground">
          <div className="flex items-center gap-1">
            <User className="h-3 w-3" />
            {order.customerName}
          </div>
          <div className="flex items-center gap-1">
            <Phone className="h-3 w-3" />
            {order.customerPhone}
          </div>
          {order.orderType === 'DELIVERY' && order.deliveryAddressLine1 && (
            <div className="flex items-center gap-1">
              <MapPin className="h-3 w-3" />
              {order.deliveryAddressLine1}{order.deliveryCity ? `, ${order.deliveryCity}` : ''}
            </div>
          )}
          {order.kitchenNote && (
            <div className="flex items-center gap-1 text-red-600">
              <MessageSquare className="h-3 w-3" />
              {order.kitchenNote}
            </div>
          )}
        </div>

        {/* Type badge */}
        <div className="flex items-center justify-between">
          <Badge variant="outline" className="text-xs">
            {order.orderType === 'DELIVERY' ? '🚗 Rozvoz' : '📦 Odber'}
          </Badge>
          <span className="text-sm font-semibold">{formatPrice(order.totalAmount)}</span>
        </div>

        {/* Action button */}
        {onNext && (
          <Button
            className="w-full text-base py-5 touch-manipulation"
            disabled={isMutating}
            style={{ backgroundColor: '#4f7f2a', color: 'white' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#3d6620')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#4f7f2a')}
            onClick={onNext}
          >
            {nextLabel}
            <ArrowRight className="h-5 w-5 ml-2" />
          </Button>
        )}
      </CardContent>
    </Card>
  )
}

function getTimeAgo(dateStr: string): string {
  const now = new Date()
  const date = new Date(dateStr)
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60000)

  if (diffMin < 1) return 'Práve teraz'
  if (diffMin < 60) return `${diffMin} min`
  const diffH = Math.floor(diffMin / 60)
  return `${diffH}h ${diffMin % 60}m`
}

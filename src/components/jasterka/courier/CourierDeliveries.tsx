'use client'

import { useState } from 'react'
import { useCourierDeliveries } from '@/hooks/use-courier-api'
import { formatMoney } from '@/lib/money'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Package, Clock, MapPin, Phone, ChevronRight, CheckCircle2 } from 'lucide-react'
import { ORDER_STATUS_LABELS } from '@/lib/types'

type Filter = 'active' | 'scheduled' | 'completed' | 'cancelled'
type Range = 'today' | 'week' | 'custom'

export function CourierDeliveries({ onOpenActive }: { onOpenActive: () => void }) {
  const [filter, setFilter] = useState<Filter>('active')
  const [range, setRange] = useState<Range>('today')

  const { data, isLoading } = useCourierDeliveries(filter, filter === 'completed' || filter === 'cancelled' ? range : undefined)

  const deliveries = data?.deliveries ?? []

  return (
    <div className="p-4 space-y-4">
      {/* Filter tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {([
          { key: 'active', label: 'Aktívne' },
          { key: 'scheduled', label: 'Naplánované' },
          { key: 'completed', label: 'Dokončené' },
          { key: 'cancelled', label: 'Zrušené' },
        ] as Array<{ key: Filter; label: string }>).map((tab) => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
              filter === tab.key
                ? 'bg-[#4f7f2a] text-white'
                : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Range selector for completed/cancelled */}
      {(filter === 'completed' || filter === 'cancelled') && (
        <div className="flex gap-2">
          {([
            { key: 'today', label: 'Dnes' },
            { key: 'week', label: 'Tento týždeň' },
          ] as Array<{ key: Range; label: string }>).map((r) => (
            <button
              key={r.key}
              onClick={() => setRange(r.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
                range === r.key
                  ? 'bg-[#f0f7ec] text-[#4f7f2a] border border-[#4f7f2a]'
                  : 'bg-white text-gray-500 border border-gray-200'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}

      {/* Active delivery CTA */}
      {filter === 'active' && deliveries.length > 0 && (
        <Button
          className="w-full h-14 text-base font-semibold rounded-2xl bg-[#4f7f2a] hover:bg-[#3d6620] text-white"
          onClick={onOpenActive}
        >
          <Package className="h-5 w-5 mr-2" />
          Otvoriť aktívne doručenie
        </Button>
      )}

      {/* Deliveries list */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-28 rounded-2xl" />)}
        </div>
      ) : deliveries.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Package className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Žiadne {filter === 'active' ? 'aktívne' : filter === 'completed' ? 'dokončené' : filter === 'cancelled' ? 'zrušené' : 'naplánované'} doručenia</p>
        </div>
      ) : (
        <div className="space-y-3">
          {deliveries.map((delivery: any) => (
            <DeliveryCard key={delivery.assignmentId} delivery={delivery} />
          ))}
        </div>
      )}
    </div>
  )
}

function DeliveryCard({ delivery }: { delivery: any }) {
  const order = delivery.order
  const earnings = delivery.earnings

  return (
    <Card className="p-4 rounded-2xl bg-white">
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="font-bold text-[#4f7f2a]">{order.orderNumber}</span>
            <Badge variant="outline" className="text-xs">
              {ORDER_STATUS_LABELS[order.status as keyof typeof ORDER_STATUS_LABELS] || order.status}
            </Badge>
          </div>
          {delivery.deliveredAt && (
            <p className="text-xs text-gray-500 mt-1">
              {new Date(delivery.deliveredAt).toLocaleString('sk-SK', {
                day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </p>
          )}
        </div>
        {earnings && (
          <div className="text-right">
            <p className="font-bold text-[#4f7f2a]">{formatMoney(earnings.total / 100)}</p>
            <p className="text-xs text-gray-500">{earnings.components.length} položiek</p>
          </div>
        )}
      </div>

      {order.deliveryAddressLine1 && (
        <div className="flex items-start gap-2 text-sm text-gray-600 mb-2">
          <MapPin className="h-4 w-4 mt-0.5 text-gray-400 flex-shrink-0" />
          <span>{order.deliveryAddressLine1}{order.deliveryCity ? `, ${order.deliveryCity}` : ''}</span>
        </div>
      )}

      <div className="flex items-start gap-2 text-sm text-gray-600 mb-3">
        <Phone className="h-4 w-4 mt-0.5 text-gray-400 flex-shrink-0" />
        <span>{order.customerPhone}</span>
      </div>

      {/* Items */}
      <div className="bg-gray-50 rounded-lg p-3 space-y-1">
        {order.items.map((item: any) => (
          <div key={item.id} className="text-sm text-gray-700">
            {item.quantity}× {item.menuItemNameSnapshot}
          </div>
        ))}
      </div>

      {order.paymentMethod === 'CASH' && (
        <div className="mt-2 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 rounded-lg p-2">
          <Clock className="h-3 w-3" />
          Platba v hotovosti: {formatMoney(order.totalAmount)}
        </div>
      )}
    </Card>
  )
}

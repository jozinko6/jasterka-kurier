'use client'

import { useState } from 'react'
import { useCourierDashboard, useCourierAction } from '@/hooks/use-courier-api'
import { formatMoney } from '@/lib/money'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import {
  X, MapPin, Phone, Navigation, Package, CheckCircle2,
  Store, User, CreditCard, Clock, MessageSquare, ExternalLink,
} from 'lucide-react'

interface OrderItem {
  id: string
  menuItemNameSnapshot: string
  quantity: number
}

interface ActiveAssignmentOrder {
  id: string
  orderNumber: string
  status: string
  orderType: string
  paymentMethod: string
  totalAmount: number
  customerName: string
  customerPhone: string
  deliveryAddressLine1: string | null
  deliveryCity: string | null
  deliveryNote: string | null
  kitchenNote: string | null
  items: OrderItem[]
  zone: { id: string; name: string } | null
}

const STEPS = [
  { key: 'GO_TO_STORE', label: 'Choď do prevádzky', icon: Store },
  { key: 'AT_STORE', label: 'Som pri prevádzke', icon: MapPin },
  { key: 'ORDER_READY', label: 'Objednávka je pripravená', icon: Package },
  { key: 'PICKED_UP', label: 'Vyzdvihnuté', icon: CheckCircle2 },
  { key: 'NAVIGATE', label: 'Navigovať k zákazníkovi', icon: Navigation },
  { key: 'AT_CUSTOMER', label: 'Som pri zákazníkovi', icon: User },
  { key: 'DELIVERED', label: 'Doručené', icon: CheckCircle2 },
] as const

export function ActiveDelivery({ onClose }: { onClose: () => void }) {
  const { data, isLoading, refetch } = useCourierDashboard()
  const action = useCourierAction()

  if (isLoading || !data?.activeAssignment) {
    return (
      <div className="fixed inset-0 z-50 bg-white max-w-2xl mx-auto p-4">
        <div className="flex justify-end mb-4">
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-5 w-5" />
          </Button>
        </div>
        <Skeleton className="h-96 rounded-2xl" />
      </div>
    )
  }

  const { order, assignmentStatus } = data.activeAssignment

  // Determine current step based on order status
  const currentStepIndex = getStepIndex(order.status)

  const handleAction = (orderStatus: string) => {
    const actionType = orderStatus === 'PICKED_UP' ? 'pickup'
      : orderStatus === 'ON_THE_WAY' ? 'start-delivery'
      : orderStatus === 'DELIVERED' ? 'complete'
      : null

    if (!actionType) return

    action.mutate(
      { orderId: order.id, action: actionType },
      {
        onSuccess: (result) => {
          if (result.status === 'DELIVERED') {
            toast.success(`Objednávka doručená! Zarobili ste ${formatMoney(result.totalEarningsEuros)}`)
            onClose()
          } else {
            toast.success('Stav aktualizovaný')
          }
          refetch()
        },
        onError: (err) => {
          toast.error(err instanceof Error ? err.message : 'Akcia zlyhala')
        },
      }
    )
  }

  return (
    <div className="fixed inset-0 z-50 bg-gray-50 max-w-2xl mx-auto overflow-y-auto safe-area-top safe-area-bottom">
      {/* Header */}
      <div className="sticky top-0 bg-white border-b px-4 py-3 flex items-center justify-between z-10">
        <div>
          <p className="text-xs text-gray-500">Aktívne doručenie</p>
          <h2 className="font-bold text-[#4f7f2a]">{order.orderNumber}</h2>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X className="h-5 w-5" />
        </Button>
      </div>

      <div className="p-4 space-y-4">
        {/* Stepper */}
        <Card className="p-4 rounded-2xl bg-white">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Postup doručenia</h3>
          <div className="space-y-2">
            {STEPS.map((step, i) => {
              const isCompleted = i < currentStepIndex
              const isCurrent = i === currentStepIndex
              const Icon = step.icon
              return (
                <div
                  key={step.key}
                  className={`flex items-center gap-3 p-2 rounded-lg ${
                    isCurrent ? 'bg-[#f0f7ec] border border-[#4f7f2a]' : ''
                  }`}
                >
                  <div
                    className={`h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isCompleted ? 'bg-[#4f7f2a] text-white'
                        : isCurrent ? 'bg-[#4f7f2a] text-white'
                        : 'bg-gray-100 text-gray-400'
                    }`}
                  >
                    {isCompleted ? <CheckCircle2 className="h-4 w-4" /> : <Icon className="h-4 w-4" />}
                  </div>
                  <span className={`text-sm ${isCompleted || isCurrent ? 'font-medium text-gray-900' : 'text-gray-400'}`}>
                    {step.label}
                  </span>
                </div>
              )
            })}
          </div>
        </Card>

        {/* Customer & address */}
        <Card className="p-4 rounded-2xl bg-white">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2">
              <MapPin className="h-5 w-5 text-[#4f7f2a]" />
              <h3 className="font-semibold">Adresa doručenia</h3>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="gap-1"
              onClick={() => {
                const addr = encodeURIComponent(`${order.deliveryAddressLine1} ${order.deliveryCity || ''}`)
                window.open(`https://www.google.com/maps/search/?api=1&query=${addr}`, '_blank')
              }}
            >
              <ExternalLink className="h-3 w-3" />
              Navigovať
            </Button>
          </div>
          <p className="text-sm font-medium">{order.deliveryAddressLine1}</p>
          {order.deliveryCity && <p className="text-sm text-gray-600">{order.deliveryCity}</p>}
          {order.deliveryNote && (
            <div className="mt-2 p-2 bg-amber-50 rounded-lg text-xs text-amber-800 flex items-start gap-2">
              <MessageSquare className="h-3 w-3 mt-0.5 flex-shrink-0" />
              <span>{order.deliveryNote}</span>
            </div>
          )}
        </Card>

        {/* Customer contact */}
        <Card className="p-4 rounded-2xl bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <User className="h-5 w-5 text-[#4f7f2a]" />
              <div>
                <p className="text-sm font-medium">{order.customerName}</p>
                <p className="text-xs text-gray-500">{order.customerPhone}</p>
              </div>
            </div>
            <a href={`tel:${order.customerPhone}`}>
              <Button variant="outline" size="sm" className="gap-1">
                <Phone className="h-3 w-3" />
                Zavolať
              </Button>
            </a>
          </div>
        </Card>

        {/* Order items */}
        <Card className="p-4 rounded-2xl bg-white">
          <div className="flex items-center gap-2 mb-3">
            <Package className="h-5 w-5 text-[#4f7f2a]" />
            <h3 className="font-semibold">Obsah objednávky</h3>
          </div>
          <div className="space-y-1">
            {order.items.map((item: OrderItem) => (
              <div key={item.id} className="text-sm text-gray-700">
                {item.quantity}× {item.menuItemNameSnapshot}
              </div>
            ))}
          </div>
          {order.kitchenNote && (
            <div className="mt-2 p-2 bg-red-50 rounded-lg text-xs text-red-700">
              Poznámka kuchyňa: {order.kitchenNote}
            </div>
          )}
        </Card>

        {/* Payment */}
        <Card className="p-4 rounded-2xl bg-white">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-[#4f7f2a]" />
              <span className="text-sm font-medium">Platba</span>
            </div>
            <div className="text-right">
              <p className="font-bold">{formatMoney(order.totalAmount)}</p>
              <p className="text-xs text-gray-500">
                {order.paymentMethod === 'CASH' ? 'Hotovosť'
                  : order.paymentMethod === 'CARD_ON_DELIVERY' ? 'Karta pri doručení'
                  : order.paymentMethod}
              </p>
            </div>
          </div>
          {order.paymentMethod === 'CASH' && (
            <div className="mt-2 p-2 bg-amber-50 rounded-lg text-xs text-amber-800 flex items-center gap-2">
              <Clock className="h-3 w-3" />
              Vyberte hotovosť od zákazníka: {formatMoney(order.totalAmount)}
            </div>
          )}
        </Card>

        {/* Action button */}
        <div className="pt-2">
          {order.status === 'ASSIGNED_TO_COURIER' && (
            <Button
              className="w-full h-16 text-base font-bold rounded-2xl bg-[#4f7f2a] hover:bg-[#3d6620] text-white"
              onClick={() => handleAction('PICKED_UP')}
              disabled={action.isPending}
            >
              <Package className="h-5 w-5 mr-2" />
              Vyzdvihnúť objednávku
            </Button>
          )}
          {order.status === 'PICKED_UP' && (
            <Button
              className="w-full h-16 text-base font-bold rounded-2xl bg-[#4f7f2a] hover:bg-[#3d6620] text-white"
              onClick={() => handleAction('ON_THE_WAY')}
              disabled={action.isPending}
            >
              <Navigation className="h-5 w-5 mr-2" />
              Na ceste k zákazníkovi
            </Button>
          )}
          {order.status === 'ON_THE_WAY' && (
            <Button
              className="w-full h-16 text-base font-bold rounded-2xl bg-[#4f7f2a] hover:bg-[#3d6620] text-white"
              onClick={() => handleAction('DELIVERED')}
              disabled={action.isPending}
            >
              <CheckCircle2 className="h-5 w-5 mr-2" />
              Doručiť objednávku
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}

function getStepIndex(status: string): number {
  const map: Record<string, number> = {
    'ASSIGNED_TO_COURIER': 0,
    'PICKED_UP': 3,
    'ON_THE_WAY': 4,
    'DELIVERED': 6,
  }
  return map[status] ?? 0
}

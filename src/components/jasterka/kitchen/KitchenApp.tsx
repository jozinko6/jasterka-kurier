'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { useKitchenOrders, useUpdateOrderStatus, useAcceptOrder, useSetEstimate } from '@/hooks/use-kitchen-orders'
import { useScreenWakeLock } from '@/hooks/use-screen-wake-lock'
import { useNetworkStatus } from '@/hooks/use-network-status'
import { sortByKitchenPriority, calculateKitchenPriority } from '@/lib/kitchen-priority'
import { getMinutesUntilReady } from '@/lib/order-estimates'
import type { KitchenOrderDTO } from '@/lib/kitchen-dto'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
  ChefHat, Clock, Package, AlertTriangle, WifiOff, RefreshCw,
  Sun, Volume2, VolumeX, Check, Plus, Timer, Bike,
} from 'lucide-react'
import { toast } from 'sonner'

// ─── Status tabs ───

const STATUS_TABS = [
  { key: 'NEW', label: 'Nové', color: '#3b82f6' },
  { key: 'ACCEPTED', label: 'Prijaté', color: '#8b5cf6' },
  { key: 'PREPARING', label: 'Príprava', color: '#f97316' },
  { key: 'READY', label: 'Hotové', color: '#22c55e' },
  { key: 'ALL', label: 'Všetky', color: '#6b7280' },
] as const

// ─── Quick preset minutes ───

const QUICK_MINUTES = [15, 20, 25, 30, 40, 45]

// ═══════════════════════════════════════════════════════════════
// Main KitchenApp component
// ═══════════════════════════════════════════════════════════════

export function KitchenApp() {
  const { data: orders, isLoading, refetch, dataUpdatedAt } = useKitchenOrders()
  const { isOnline, wasOffline } = useNetworkStatus()
  const { isActive: wakeLockActive, isSupported: wakeLockSupported, request: requestWakeLock, release: releaseWakeLock } = useScreenWakeLock()
  const [activeTab, setActiveTab] = useState<string>('NEW')
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null)
  const [acceptingOrderId, setAcceptingOrderId] = useState<string | null>(null)
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [notifiedOrderIds] = useState<Set<string>>(new Set())
  const [clock, setClock] = useState(new Date())

  // Update clock every 30s for countdown
  useEffect(() => {
    const interval = setInterval(() => setClock(new Date()), 30000)
    return () => clearInterval(interval)
  }, [])

  // Play sound for new orders
  useEffect(() => {
    if (!orders || !soundEnabled) return
    for (const order of orders) {
      if (order.status === 'NEW' && !notifiedOrderIds.has(order.id)) {
        notifiedOrderIds.add(order.id)
        playNotificationSound()
        if ('vibrate' in navigator) navigator.vibrate(200)
      }
    }
  }, [orders, soundEnabled, notifiedOrderIds])

  // Show "back online" toast
  useEffect(() => {
    if (isOnline && wasOffline) {
      toast.success('Pripojenie obnovené')
      refetch()
    }
  }, [isOnline, wasOffline, refetch])

  // Count orders per tab
  const tabCounts = useMemo<Record<string, number>>(() => {
    if (!orders) return { NEW: 0, ACCEPTED: 0, PREPARING: 0, READY: 0, ALL: 0 }
    return {
      NEW: orders.filter(o => o.status === 'NEW').length,
      ACCEPTED: orders.filter(o => o.status === 'ACCEPTED').length,
      PREPARING: orders.filter(o => ['ACCEPTED', 'IN_KITCHEN', 'PREPARING'].includes(o.status)).length,
      READY: orders.filter(o => o.status === 'READY').length,
      ALL: orders.length,
    }
  }, [orders])

  // Auto-switch to NEW tab if there are new orders and current tab is empty
  const effectiveTab = (tabCounts[activeTab] === 0 && tabCounts.NEW > 0) ? 'NEW' : activeTab

  // Filter orders by active tab (use effectiveTab for auto-switch)
  const filteredOrders = useMemo(() => {
    if (!orders) return []
    const tab = effectiveTab
    let filtered = orders
    if (tab === 'PREPARING') {
      filtered = orders.filter(o => ['ACCEPTED', 'IN_KITCHEN', 'PREPARING'].includes(o.status))
    } else if (tab !== 'ALL') {
      filtered = orders.filter(o => o.status === tab)
    }
    // Sort by kitchen priority using a comparator
    return [...filtered].sort((a, b) => {
      const pa = calculateKitchenPriority({
        id: a.id, status: a.status,
        createdAt: new Date(a.createdAt),
        estimatedReadyAt: a.estimatedReadyAt ? new Date(a.estimatedReadyAt) : null,
        estimateStatus: a.estimateStatus, now: clock,
      })
      const pb = calculateKitchenPriority({
        id: b.id, status: b.status,
        createdAt: new Date(b.createdAt),
        estimatedReadyAt: b.estimatedReadyAt ? new Date(b.estimatedReadyAt) : null,
        estimateStatus: b.estimateStatus, now: clock,
      })
      return pb.score - pa.score
    })
  }, [orders, effectiveTab, clock])

  const selectedOrder = orders?.find(o => o.id === selectedOrderId) ?? null
  const acceptingOrder = orders?.find(o => o.id === acceptingOrderId) ?? null

  return (
    <div className="flex flex-col h-screen max-w-7xl mx-auto bg-gray-50" style={{ touchAction: 'manipulation' }}>
      {/* ─── Offline banner ─── */}
      {!isOnline && (
        <div className="bg-red-600 text-white px-4 py-2 flex items-center gap-2 text-sm font-medium sticky top-0 z-50">
          <WifiOff className="h-4 w-4" />
          Ste offline – zmeny nie je možné uložiť
        </div>
      )}

      {/* ─── Header ─── */}
      <KitchenHeader
        onRefresh={() => refetch()}
        isRefreshing={isLoading}
        lastUpdated={dataUpdatedAt ? new Date(dataUpdatedAt) : null}
        soundEnabled={soundEnabled}
        onToggleSound={() => setSoundEnabled(!soundEnabled)}
        wakeLockSupported={wakeLockSupported}
        wakeLockActive={wakeLockActive}
        onToggleWakeLock={() => wakeLockActive ? releaseWakeLock() : requestWakeLock()}
        clock={clock}
      />

      {/* ─── Status tabs ─── */}
      <KitchenStatusTabs
        activeTab={effectiveTab}
        onTabChange={setActiveTab}
        counts={tabCounts}
      />

      {/* ─── Order grid ─── */}
      <main className="flex-1 overflow-y-auto p-3 sm:p-4 safe-area-bottom">
        {isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {[1, 2, 3, 4, 5, 6].map(i => <Skeleton key={i} className="h-48 rounded-2xl" />)}
          </div>
        ) : filteredOrders.length === 0 ? (
          <div className="text-center py-20 text-gray-400">
            <ChefHat className="h-16 w-16 mx-auto mb-4 opacity-20" />
            <p className="text-lg font-medium">Žiadne objednávky</p>
            <p className="text-sm mt-1">V tejto sekcii nie sú žiadne objednávky</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filteredOrders.map(order => (
              <KitchenOrderCard
                key={order.id}
                order={order}
                now={clock}
                onOpen={() => setSelectedOrderId(order.id)}
                onAccept={() => setAcceptingOrderId(order.id)}
                isOnline={isOnline}
              />
            ))}
          </div>
        )}
      </main>

      {/* ─── Order detail (bottom sheet on mobile, dialog on tablet) ─── */}
      {selectedOrder && (
        <KitchenOrderDetail
          order={selectedOrder}
          open={!!selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
          isOnline={isOnline}
        />
      )}

      {/* ─── Accept + estimate picker ─── */}
      {acceptingOrder && (
        <AcceptEstimateDialog
          order={acceptingOrder}
          open={!!acceptingOrderId}
          onClose={() => setAcceptingOrderId(null)}
        />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Header
// ═══════════════════════════════════════════════════════════════

function KitchenHeader({
  onRefresh, isRefreshing, lastUpdated, soundEnabled, onToggleSound,
  wakeLockSupported, wakeLockActive, onToggleWakeLock, clock,
}: {
  onRefresh: () => void
  isRefreshing: boolean
  lastUpdated: Date | null
  soundEnabled: boolean
  onToggleSound: () => void
  wakeLockSupported: boolean
  wakeLockActive: boolean
  onToggleWakeLock: () => void
  clock: Date
}) {
  return (
    <header className="sticky top-0 z-40 bg-white border-b border-gray-200 px-4 py-2 flex items-center justify-between safe-area-top">
      <div className="flex items-center gap-2">
        <div className="h-9 w-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: '#4f7f2a' }}>
          <ChefHat className="h-5 w-5 text-white" />
        </div>
        <div>
          <h1 className="font-bold text-base" style={{ color: '#4f7f2a' }}>Kuchyňa</h1>
          <p className="text-xs text-gray-400 hidden sm:block">
            {clock.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' })}
            {lastUpdated && ` · Aktualizované ${lastUpdated.toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' })}`}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          onClick={onToggleSound}
          className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors"
          aria-label={soundEnabled ? 'Vypnúť zvuk' : 'Zapnúť zvuk'}
        >
          {soundEnabled ? <Volume2 className="h-5 w-5 text-gray-600" /> : <VolumeX className="h-5 w-5 text-gray-400" />}
        </button>
        {wakeLockSupported && (
          <button
            onClick={onToggleWakeLock}
            className={`h-10 w-10 flex items-center justify-center rounded-lg transition-colors ${
              wakeLockActive ? 'bg-amber-100' : 'hover:bg-gray-100'
            }`}
            aria-label={wakeLockActive ? 'Vypnúť stále zapnutú obrazovku' : 'Zapnúť stále zapnutú obrazovku'}
          >
            <Sun className={`h-5 w-5 ${wakeLockActive ? 'text-amber-600' : 'text-gray-400'}`} />
          </button>
        )}
        <button
          onClick={onRefresh}
          disabled={isRefreshing}
          className="h-10 w-10 flex items-center justify-center rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
          aria-label="Obnoviť"
        >
          <RefreshCw className={`h-5 w-5 text-gray-600 ${isRefreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>
    </header>
  )
}

// ═══════════════════════════════════════════════════════════════
// Status tabs
// ═══════════════════════════════════════════════════════════════

function KitchenStatusTabs({
  activeTab, onTabChange, counts,
}: {
  activeTab: string
  onTabChange: (tab: string) => void
  counts: Record<string, number>
}) {
  return (
    <div className="sticky top-[57px] z-30 bg-white border-b border-gray-200 px-2 py-1 flex gap-1 overflow-x-auto">
      {STATUS_TABS.map(tab => (
        <button
          key={tab.key}
          onClick={() => onTabChange(tab.key)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
            activeTab === tab.key ? 'text-white' : 'text-gray-600 hover:bg-gray-100'
          }`}
          style={activeTab === tab.key ? { backgroundColor: tab.color } : {}}
        >
          {tab.label}
          {counts[tab.key] > 0 && (
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
              activeTab === tab.key ? 'bg-white/25' : 'bg-gray-200'
            }`}>
              {counts[tab.key]}
            </span>
          )}
        </button>
      ))}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Order card
// ═══════════════════════════════════════════════════════════════

function KitchenOrderCard({
  order, now, onOpen, onAccept, isOnline,
}: {
  order: KitchenOrderDTO
  now: Date
  onOpen: () => void
  onAccept: () => void
  isOnline: boolean
}) {
  const updateStatus = useUpdateOrderStatus()
  const setEstimate = useSetEstimate()

  const priority = calculateKitchenPriority({
    id: order.id,
    status: order.status,
    createdAt: new Date(order.createdAt),
    estimatedReadyAt: order.estimatedReadyAt ? new Date(order.estimatedReadyAt) : null,
    estimateStatus: order.estimateStatus,
    now,
  })

  const minutesUntilReady = order.estimatedReadyAt
    ? getMinutesUntilReady(new Date(order.estimatedReadyAt), now)
    : null

  const ageMinutes = Math.floor((now.getTime() - new Date(order.createdAt).getTime()) / 60000)

  // Card color based on status + priority
  const cardBorderColor = priority.isOverdue ? '#ef4444'
    : order.status === 'NEW' ? '#3b82f6'
    : order.status === 'ACCEPTED' ? '#8b5cf6'
    : ['IN_KITCHEN', 'PREPARING'].includes(order.status) ? '#f97316'
    : order.status === 'READY' ? '#22c55e'
    : '#e5e7eb'

  const handleNextStatus = useCallback((e: React.MouseEvent) => {
    e.stopPropagation()
    if (!isOnline) return

    if (order.status === 'ACCEPTED') {
      updateStatus.mutate({ orderId: order.id, status: 'IN_KITCHEN', expectedStatus: 'ACCEPTED' })
    } else if (order.status === 'IN_KITCHEN') {
      updateStatus.mutate({ orderId: order.id, status: 'PREPARING', expectedStatus: 'IN_KITCHEN' })
    } else if (order.status === 'PREPARING') {
      updateStatus.mutate({ orderId: order.id, status: 'READY', expectedStatus: 'PREPARING' })
    }
  }, [order, updateStatus, isOnline])

  const handleQuickDelay = useCallback((e: React.MouseEvent, minutes: number) => {
    e.stopPropagation()
    if (!isOnline) return
    setEstimate.mutate({
      orderId: order.id,
      mode: 'DELAY',
      additionalMinutes: minutes,
      reason: 'HIGH_DEMAND',
      expectedVersion: order.estimateVersion,
    })
  }, [order, setEstimate, isOnline])

  const nextLabel = order.status === 'ACCEPTED' ? 'Začať prípravu'
    : order.status === 'IN_KITCHEN' ? 'Pripravovať'
    : order.status === 'PREPARING' ? 'Hotové'
    : null

  return (
    <div
      onClick={onOpen}
      className="bg-white rounded-2xl border-2 overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
      style={{ borderColor: cardBorderColor }}
    >
      {/* Top bar: order number + priority label */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <span className="font-bold text-sm" style={{ color: '#4f7f2a' }}>
          {order.orderNumber}
        </span>
        <div className="flex items-center gap-1.5">
          {priority.label && (
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              priority.isOverdue ? 'bg-red-100 text-red-700'
              : order.status === 'NEW' ? 'bg-blue-100 text-blue-700'
              : 'bg-gray-100 text-gray-600'
            }`}>
              {priority.label}
            </span>
          )}
          <span className="text-xs text-gray-400 flex items-center gap-0.5">
            <Clock className="h-3 w-3" />
            {ageMinutes < 1 ? 'teraz' : `${ageMinutes} min`}
          </span>
        </div>
      </div>

      {/* Items */}
      <div className="px-3 py-2 space-y-1">
        {order.items.map(item => (
          <div key={item.id} className="text-sm">
            <span className="font-semibold">{item.quantity}×</span>{' '}
            {item.menuItemNameSnapshot}
            {item.selectedSize && (
              <span className="text-gray-500"> ({item.selectedSize})</span>
            )}
            {item.kitchenNote && (
              <div className="text-xs text-red-600 ml-4">⚠ {item.kitchenNote}</div>
            )}
          </div>
        ))}
        {order.kitchenNote && (
          <div className="text-xs text-red-600 bg-red-50 rounded p-1.5 mt-1">
            ⚠ {order.kitchenNote}
          </div>
        )}
      </div>

      {/* ETA / countdown */}
      {order.estimatedReadyAt && (
        <div className="px-3 py-1.5 bg-gray-50 text-xs flex items-center justify-between">
          <span className="text-gray-500">Pripravené:</span>
          <span className={`font-bold ${priority.isOverdue ? 'text-red-600' : minutesUntilReady !== null && minutesUntilReady <= 5 ? 'text-amber-600' : 'text-gray-700'}`}>
            {formatTimeShort(new Date(order.estimatedReadyAt))}
            {minutesUntilReady !== null && !['READY', 'DELIVERED'].includes(order.status) && (
              <span className="ml-1">
                {minutesUntilReady > 0 ? `(${minutesUntilReady} min)` : `(mešká ${Math.abs(minutesUntilReady)} min)`}
              </span>
            )}
          </span>
        </div>
      )}

      {/* Ready state info */}
      {order.status === 'READY' && (
        <div className="px-3 py-1.5 bg-green-50 text-xs flex items-center gap-1 text-green-700">
          <Check className="h-3 w-3" />
          {order.orderType === 'PICKUP' ? 'Pripravené na osobný odber' : 'Čaká na kuriéra'}
        </div>
      )}

      {/* Action buttons */}
      <div className="px-3 py-2 flex gap-2" onClick={e => e.stopPropagation()}>
        {order.status === 'NEW' && (
          <Button
            className="flex-1 h-14 text-base font-bold rounded-xl"
            style={{ backgroundColor: '#4f7f2a', color: 'white' }}
            disabled={!isOnline}
            onClick={onAccept}
          >
            Prijať a nastaviť čas
          </Button>
        )}
        {nextLabel && (
          <Button
            className="flex-1 h-14 text-base font-bold rounded-xl"
            style={{ backgroundColor: '#4f7f2a', color: 'white' }}
            disabled={!isOnline || updateStatus.isPending}
            onClick={handleNextStatus}
          >
            {nextLabel}
          </Button>
        )}
        {['ACCEPTED', 'IN_KITCHEN', 'PREPARING'].includes(order.status) && (
          <div className="flex gap-1">
            {[5, 10, 15].map(min => (
              <button
                key={min}
                onClick={(e) => handleQuickDelay(e, min)}
                disabled={!isOnline || setEstimate.isPending}
                className="h-14 px-2 text-xs font-medium rounded-xl bg-amber-100 text-amber-700 hover:bg-amber-200 transition-colors disabled:opacity-50"
                aria-label={`Pridať ${min} minút`}
              >
                +{min}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════
// Accept + estimate dialog
// ═══════════════════════════════════════════════════════════════

function AcceptEstimateDialog({
  order, open, onClose,
}: {
  order: KitchenOrderDTO
  open: boolean
  onClose: () => void
}) {
  const acceptOrder = useAcceptOrder()
  const [selectedMinutes, setSelectedMinutes] = useState<number>(25)
  const [customMinutes, setCustomMinutes] = useState<string>('')

  const handleAccept = () => {
    const minutes = customMinutes ? parseInt(customMinutes, 10) : selectedMinutes
    if (!minutes || minutes < 5) {
      toast.error('Minimálny čas je 5 minút')
      return
    }
    acceptOrder.mutate(
      { orderId: order.id, prepMinutes: minutes },
      { onSuccess: () => { onClose() } }
    )
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg" style={{ color: '#4f7f2a' }}>
            Prijať objednávku {order.orderNumber}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {/* Order summary */}
          <div className="bg-gray-50 rounded-xl p-3 space-y-1">
            {order.items.map(item => (
              <div key={item.id} className="text-sm">
                <span className="font-semibold">{item.quantity}×</span> {item.menuItemNameSnapshot}
                {item.selectedSize && <span className="text-gray-500"> ({item.selectedSize})</span>}
              </div>
            ))}
          </div>

          {/* Quick presets */}
          <div>
            <p className="text-sm font-medium mb-2 text-gray-700">Čas prípravy</p>
            <div className="grid grid-cols-3 gap-2">
              {QUICK_MINUTES.map(min => (
                <button
                  key={min}
                  onClick={() => { setSelectedMinutes(min); setCustomMinutes('') }}
                  className={`h-14 rounded-xl text-base font-bold transition-colors ${
                    selectedMinutes === min && !customMinutes
                      ? 'text-white'
                      : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                  }`}
                  style={selectedMinutes === min && !customMinutes ? { backgroundColor: '#4f7f2a' } : {}}
                >
                  {min} min
                </button>
              ))}
            </div>
          </div>

          {/* Custom minutes */}
          <div>
            <p className="text-sm font-medium mb-2 text-gray-700">Vlastný čas (minút)</p>
            <input
              type="number"
              min={5}
              max={180}
              value={customMinutes}
              onChange={e => setCustomMinutes(e.target.value)}
              placeholder="napr. 35"
              className="w-full h-14 px-4 text-base rounded-xl border border-gray-300 focus:border-[#4f7f2a] focus:outline-none"
            />
          </div>

          {/* Accept button */}
          <Button
            className="w-full h-14 text-base font-bold rounded-xl"
            style={{ backgroundColor: '#4f7f2a', color: 'white' }}
            disabled={acceptOrder.isPending}
            onClick={handleAccept}
          >
            {acceptOrder.isPending ? 'Prijímam...' : 'Prijať objednávku'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ═══════════════════════════════════════════════════════════════
// Order detail (sheet)
// ═══════════════════════════════════════════════════════════════

function KitchenOrderDetail({
  order, open, onClose, isOnline,
}: {
  order: KitchenOrderDTO
  open: boolean
  onClose: () => void
  isOnline: boolean
}) {
  const updateStatus = useUpdateOrderStatus()
  const setEstimate = useSetEstimate()
  const [customMinutes, setCustomMinutes] = useState('')

  const handleSetEstimate = (minutes: number) => {
    setEstimate.mutate({
      orderId: order.id,
      mode: 'MINUTES',
      minutes,
      expectedVersion: order.estimateVersion,
    })
  }

  const handleCustomEstimate = () => {
    const min = parseInt(customMinutes, 10)
    if (min && min >= 5) {
      handleSetEstimate(min)
      setCustomMinutes('')
    }
  }

  const handleStatusChange = (status: string) => {
    updateStatus.mutate({ orderId: order.id, status, expectedStatus: order.status })
  }

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col" side="bottom">
        <SheetHeader>
          <SheetTitle className="text-lg" style={{ color: '#4f7f2a' }}>
            {order.orderNumber}
          </SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto space-y-4 p-4">
          {/* Items */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm text-gray-700">Položky</h3>
            {order.items.map(item => (
              <div key={item.id} className="bg-gray-50 rounded-lg p-2 text-sm">
                <span className="font-semibold">{item.quantity}×</span> {item.menuItemNameSnapshot}
                {item.selectedSize && <span className="text-gray-500"> ({item.selectedSize})</span>}
                {item.selectedOptions && (
                  <div className="text-xs text-gray-500 mt-0.5">{item.selectedOptions}</div>
                )}
                {item.kitchenNote && (
                  <div className="text-xs text-red-600 mt-0.5">⚠ {item.kitchenNote}</div>
                )}
              </div>
            ))}
          </div>

          {/* Kitchen note */}
          {order.kitchenNote && (
            <div className="bg-red-50 rounded-lg p-3 text-sm text-red-700">
              <strong>Poznámka:</strong> {order.kitchenNote}
            </div>
          )}

          {/* Current ETA */}
          {order.estimatedReadyAt && (
            <div className="bg-blue-50 rounded-lg p-3 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Predpokladané pripravenie:</span>
                <span className="font-bold">{formatTimeShort(new Date(order.estimatedReadyAt))}</span>
              </div>
              {order.estimateStatus === 'DELAYED' && order.publicDelayReason && (
                <div className="text-xs text-amber-700 mt-1">
                  Meškanie: {order.publicDelayReason}
                </div>
              )}
            </div>
          )}

          {/* Estimate controls (if not NEW and not terminal) */}
          {['ACCEPTED', 'IN_KITCHEN', 'PREPARING'].includes(order.status) && (
            <div className="space-y-2">
              <h3 className="font-semibold text-sm text-gray-700">Zmeniť čas</h3>
              <div className="grid grid-cols-4 gap-2">
                {[5, 10, 15, 20].map(min => (
                  <button
                    key={min}
                    onClick={() => handleSetEstimate(min)}
                    disabled={!isOnline || setEstimate.isPending}
                    className="h-12 rounded-xl bg-amber-100 text-amber-700 font-bold text-sm hover:bg-amber-200 disabled:opacity-50"
                  >
                    +{min}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  min={5}
                  max={180}
                  value={customMinutes}
                  onChange={e => setCustomMinutes(e.target.value)}
                  placeholder="Vlastné minúty"
                  className="flex-1 h-12 px-3 rounded-xl border border-gray-300 text-sm"
                />
                <Button
                  onClick={handleCustomEstimate}
                  disabled={!isOnline || setEstimate.isPending}
                  className="h-12 px-4"
                  style={{ backgroundColor: '#4f7f2a', color: 'white' }}
                >
                  Nastaviť
                </Button>
              </div>
            </div>
          )}

          {/* Status actions */}
          <div className="space-y-2 pt-2 border-t">
            <h3 className="font-semibold text-sm text-gray-700">Akcie</h3>
            {order.allowedTransitions.includes('IN_KITCHEN') && (
              <Button
                className="w-full h-14 text-base font-bold rounded-xl"
                disabled={!isOnline || updateStatus.isPending}
                onClick={() => handleStatusChange('IN_KITCHEN')}
                style={{ backgroundColor: '#4f7f2a', color: 'white' }}
              >
                Začať prípravu
              </Button>
            )}
            {order.allowedTransitions.includes('PREPARING') && (
              <Button
                className="w-full h-14 text-base font-bold rounded-xl"
                disabled={!isOnline || updateStatus.isPending}
                onClick={() => handleStatusChange('PREPARING')}
                style={{ backgroundColor: '#4f7f2a', color: 'white' }}
              >
                Pripravovať
              </Button>
            )}
            {order.allowedTransitions.includes('READY') && (
              <Button
                className="w-full h-14 text-base font-bold rounded-xl"
                disabled={!isOnline || updateStatus.isPending}
                onClick={() => handleStatusChange('READY')}
                style={{ backgroundColor: '#22c55e', color: 'white' }}
              >
                Označiť ako hotové
              </Button>
            )}
            {order.allowedTransitions.includes('WAITING_FOR_COURIER') && (
              <Button
                className="w-full h-14 text-base font-bold rounded-xl"
                disabled={!isOnline || updateStatus.isPending}
                onClick={() => handleStatusChange('WAITING_FOR_COURIER')}
                style={{ backgroundColor: '#4f7f2a', color: 'white' }}
              >
                Čaká na kuriéra
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Helpers ───

function formatTimeShort(date: Date): string {
  const bratislava = new Date(date.getTime() + getOffsetMs(date))
  const h = bratislava.getUTCHours().toString().padStart(2, '0')
  const m = bratislava.getUTCMinutes().toString().padStart(2, '0')
  return `${h}:${m}`
}

function getOffsetMs(date: Date): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Bratislava',
    timeZoneName: 'shortOffset',
  })
  const parts = formatter.formatToParts(date)
  const offsetPart = parts.find((p) => p.type === 'timeZoneName')
  if (offsetPart) {
    const match = offsetPart.value.match(/GMT([+-])(\d{1,2}):?(\d{2})?/)
    if (match) {
      const sign = match[1] === '+' ? 1 : -1
      const hours = parseInt(match[2], 10)
      const minutes = match[3] ? parseInt(match[3], 10) : 0
      return sign * (hours * 60 + minutes) * 60 * 1000
    }
  }
  return 60 * 60 * 1000
}

function playNotificationSound() {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.frequency.value = 880
    oscillator.type = 'sine'
    gain.gain.setValueAtTime(0.3, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5)
    oscillator.start(ctx.currentTime)
    oscillator.stop(ctx.currentTime + 0.5)
  } catch {
    // AudioContext not available
  }
}

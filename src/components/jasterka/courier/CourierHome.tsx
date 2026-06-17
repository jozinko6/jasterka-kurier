'use client'

import { useCourierDashboard, useUpdateCourierStatus, useWorkSession } from '@/hooks/use-courier-api'
import { formatMoney } from '@/lib/money'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Bike, Car, Power, Clock, Package, Wallet, TrendingUp, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'

interface CourierHomeProps {
  onGoOnline: () => void
  onNavigate: (tab: 'home' | 'deliveries' | 'earnings' | 'profile') => void
}

export function CourierHome({ onGoOnline, onNavigate }: CourierHomeProps) {
  const { data, isLoading } = useCourierDashboard()
  const updateStatus = useUpdateCourierStatus()
  const workSession = useWorkSession()

  const courier = data?.courier
  const isOnline = courier?.isOnline ?? false

  const handleToggleOnline = (online: boolean) => {
    if (!courier) return
    const newStatus = online ? 'AVAILABLE' : 'OFFLINE'
    updateStatus.mutate(
      { courierId: courier.id, status: newStatus },
      {
        onSuccess: () => {
          if (online) {
            workSession.mutate('start')
            toast.success('Ste online. Pripravený na objednávky.')
          } else {
            workSession.mutate('end')
            toast.info('Ste offline. Smena ukončená.')
          }
        },
        onError: () => toast.error('Nepodarilo sa zmeniť stav'),
      }
    )
  }

  if (isLoading || !courier) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    )
  }

  const vehicleIcon = courier.vehicleType === 'BICYCLE' ? <Bike className="h-5 w-5" />
    : courier.vehicleType === 'SCOOTER' ? <Bike className="h-5 w-5" />
    : <Car className="h-5 w-5" />

  return (
    <div className="p-4 space-y-4">
      {/* Header: courier info + online toggle */}
      <Card className="p-4 bg-white rounded-2xl shadow-sm">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-full bg-[#f0f7ec] flex items-center justify-center text-[#4f7f2a]">
              {vehicleIcon}
            </div>
            <div>
              <h2 className="font-bold text-lg text-gray-900">{courier.displayName}</h2>
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <span className={`inline-block h-2 w-2 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`} />
                {isOnline ? 'Online' : 'Offline'}
              </div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Switch
              checked={isOnline}
              onCheckedChange={handleToggleOnline}
              disabled={updateStatus.isPending}
            />
            <span className="text-xs text-gray-500">{isOnline ? 'Dostupný' : 'Neaktívny'}</span>
          </div>
        </div>
      </Card>

      {/* Earnings hero card */}
      <Card className="p-6 rounded-2xl bg-gradient-to-br from-[#4f7f2a] to-[#3d6620] text-white shadow-lg">
        <p className="text-sm opacity-90 mb-1">Dnes si zarobil</p>
        <p className="text-4xl font-bold mb-3">
          {formatMoney(data.today.earningsEuros)}
        </p>
        <div className="flex items-center gap-4 text-sm opacity-90">
          <div className="flex items-center gap-1">
            <Package className="h-4 w-4" />
            {data.today.deliveryCount} doručení
          </div>
          {data.workSession && (
            <div className="flex items-center gap-1">
              <Clock className="h-4 w-4" />
              {formatDuration(data.workSession.totalActiveSeconds)}
            </div>
          )}
        </div>
        {data.today.pendingEarningsCents > 0 && (
          <div className="mt-3 pt-3 border-t border-white/20 text-sm opacity-90">
            Čakajúce zárobky: {formatMoney(data.today.pendingEarningsCents / 100)}
          </div>
        )}
      </Card>

      {/* Quick stats grid */}
      <div className="grid grid-cols-2 gap-3">
        <Card
          className="p-4 rounded-2xl bg-white cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => onNavigate('earnings')}
        >
          <div className="flex items-center gap-2 text-[#4f7f2a] mb-1">
            <Wallet className="h-4 w-4" />
            <span className="text-xs font-medium">Otvorené obdobie</span>
          </div>
          {data.openPayoutPeriod ? (
            <>
              <p className="text-lg font-bold text-gray-900">
                {formatMoney(data.openPayoutPeriod.payableEuros)}
              </p>
              <p className="text-xs text-gray-500">
                Výplata: {new Date(data.openPayoutPeriod.payoutDueDate).toLocaleDateString('sk-SK')}
              </p>
            </>
          ) : (
            <p className="text-sm text-gray-400">Žiadne otvorené obdobie</p>
          )}
        </Card>

        <Card
          className="p-4 rounded-2xl bg-white cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => onNavigate('deliveries')}
        >
          <div className="flex items-center gap-2 text-[#4f7f2a] mb-1">
            <TrendingUp className="h-4 w-4" />
            <span className="text-xs font-medium">Aktívne doručenia</span>
          </div>
          <p className="text-lg font-bold text-gray-900">
            {data.activeAssignment ? '1' : '0'}
          </p>
          <p className="text-xs text-gray-500">
            {data.activeAssignment ? data.activeAssignment.order.orderNumber : 'Žiadne aktívne'}
          </p>
        </Card>
      </div>

      {/* Cash balance warning */}
      {data.cashBalanceEuros > 0 && (
        <Card className="p-4 rounded-2xl bg-amber-50 border-amber-200">
          <div className="flex items-center gap-2 text-amber-800">
            <AlertCircle className="h-5 w-5" />
            <div className="flex-1">
              <p className="text-sm font-medium">Hotovosť pri sebe</p>
              <p className="text-xs text-amber-700">
                {formatMoney(data.cashBalanceEuros)} — odovzdajte v prevádzke
              </p>
            </div>
          </div>
        </Card>
      )}

      {/* Active delivery CTA */}
      {data.activeAssignment ? (
        <Button
          className="w-full h-14 text-base font-semibold rounded-2xl bg-[#4f7f2a] hover:bg-[#3d6620] text-white"
          onClick={onGoOnline}
        >
          <Package className="h-5 w-5 mr-2" />
          Pokračovať v doručovaní
        </Button>
      ) : isOnline ? (
        <div className="text-center py-8 text-gray-500">
          <Power className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="text-sm">Čakám na pridelenie objednávky...</p>
          <p className="text-xs mt-1">Budete upozornený pri novej objednávke</p>
        </div>
      ) : (
        <Button
          className="w-full h-14 text-base font-semibold rounded-2xl bg-[#4f7f2a] hover:bg-[#3d6620] text-white"
          onClick={() => handleToggleOnline(true)}
          disabled={updateStatus.isPending}
        >
          <Power className="h-5 w-5 mr-2" />
          Prejsť online
        </Button>
      )}
    </div>
  )
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds < 0) return '0 min'
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}min`
  return `${m}min`
}

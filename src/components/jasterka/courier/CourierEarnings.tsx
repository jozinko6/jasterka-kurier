'use client'

import { useState } from 'react'
import { useCourierEarnings, useCourierPayoutPeriods } from '@/hooks/use-courier-api'
import { formatMoney } from '@/lib/money'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Wallet, TrendingUp, Gift, AlertCircle, Clock, Package } from 'lucide-react'

type Range = 'today' | 'week' | 'month' | 'period'

const EARNING_TYPE_LABELS: Record<string, string> = {
  DELIVERY_BASE: 'Základná odmena',
  PICKUP_FEE: 'Vyzdvihnutie',
  DROPOFF_FEE: 'Odovzdanie',
  PICKUP_DISTANCE: 'Vzdialenosť k prevádzke',
  DELIVERY_DISTANCE: 'Vzdialenosť k zákazníkovi',
  ZONE_BONUS: 'Bonus za zónu',
  PEAK_BONUS: 'Bonus za špičku',
  WEEKEND_BONUS: 'Víkendový bonus',
  HOLIDAY_BONUS: 'Sviatočný bonus',
  WEATHER_BONUS: 'Bonus za počasie',
  WAITING_FEE: 'Čakanie',
  MULTI_ORDER_BONUS: 'Bonus za viac objednávok',
  CANCELLATION_COMPENSATION: 'Storno kompenzácia',
  HOURLY_GUARANTEE: 'Garantovaná hodinová odmena',
  TIP: 'Prepitné',
  MANUAL_BONUS: 'Manuálny bonus',
  MANUAL_ADJUSTMENT: 'Manuálna úprava',
  REVERSAL: 'Reverz',
  LEGACY_IMPORT: 'Import',
}

export function CourierEarnings() {
  const [range, setRange] = useState<Range>('today')
  const [periodId, setPeriodId] = useState<string>('')
  const { data: periodsData } = useCourierPayoutPeriods()

  const effectiveRange = range === 'period' && periodId ? 'period' : range === 'period' ? 'today' : range
  const effectiveParams = range === 'period' && periodId ? { periodId } : undefined

  const { data, isLoading } = useCourierEarnings(effectiveRange, effectiveParams)

  return (
    <div className="p-4 space-y-4">
      {/* Range selector */}
      <div className="flex gap-2 overflow-x-auto pb-1">
        {([
          { key: 'today', label: 'Dnes' },
          { key: 'week', label: 'Týždeň' },
          { key: 'month', label: 'Mesiac' },
          { key: 'period', label: 'Obdobie' },
        ] as Array<{ key: Range; label: string }>).map((r) => (
          <button
            key={r.key}
            onClick={() => setRange(r.key)}
            className={`px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap ${
              range === r.key
                ? 'bg-[#4f7f2a] text-white'
                : 'bg-white text-gray-600 border border-gray-200'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Period selector */}
      {range === 'period' && (
        <Select value={periodId} onValueChange={setPeriodId}>
          <SelectTrigger>
            <SelectValue placeholder="Vyberte výplatné obdobie" />
          </SelectTrigger>
          <SelectContent>
            {periodsData?.periods.map((p: any) => (
              <SelectItem key={p.id} value={p.id}>
                {new Date(p.periodStart).toLocaleDateString('sk-SK')} – {new Date(p.periodEnd).toLocaleDateString('sk-SK')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-40 rounded-2xl" />
          <Skeleton className="h-48 rounded-2xl" />
        </div>
      ) : data ? (
        <>
          {/* Summary hero */}
          <Card className="p-6 rounded-2xl bg-gradient-to-br from-[#4f7f2a] to-[#3d6620] text-white shadow-lg">
            <p className="text-sm opacity-90 mb-1">
              {range === 'today' ? 'Dnes' : range === 'week' ? 'Tento týždeň' : range === 'month' ? 'Tento mesiac' : 'Za obdobie'}
            </p>
            <p className="text-4xl font-bold mb-3">
              {formatMoney(data.summary.confirmedEuros)}
            </p>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="flex items-center gap-2">
                <Package className="h-4 w-4 opacity-80" />
                <span>{data.summary.deliveryCount} doručení</span>
              </div>
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4 opacity-80" />
                <span>{formatMoney(data.summary.bonusEuros)} bonusy</span>
              </div>
              {data.summary.tipEuros > 0 && (
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 opacity-80" />
                  <span>{formatMoney(data.summary.tipEuros)} prepitné</span>
                </div>
              )}
              {data.summary.adjustmentEuros !== 0 && (
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 opacity-80" />
                  <span>{formatMoney(data.summary.adjustmentEuros)} úpravy</span>
                </div>
              )}
            </div>
          </Card>

          {/* Pending */}
          {data.summary.pendingEuros > 0 && range === 'today' && (
            <Card className="p-4 rounded-2xl bg-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-gray-600">
                  <Clock className="h-4 w-4" />
                  <span className="text-sm">Čakajúce zárobky</span>
                </div>
                <span className="font-semibold text-gray-900">{formatMoney(data.summary.pendingEuros)}</span>
              </div>
              <p className="text-xs text-gray-400 mt-1">Budú potvrdené po uzávierke obdobia</p>
            </Card>
          )}

          {/* Daily chart */}
          {data.byDay.length > 1 && (
            <Card className="p-4 rounded-2xl bg-white">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Zárobky po dňoch</h3>
              <div className="flex items-end gap-2 h-32">
                {data.byDay.map((day: any) => {
                  const max = Math.max(...data.byDay.map((d: any) => d.cents), 1)
                  const heightPct = (day.cents / max) * 100
                  return (
                    <div key={day.date} className="flex-1 flex flex-col items-center gap-1">
                      <div className="text-xs text-gray-500">
                        {day.euros > 0 ? day.euros.toFixed(0) : ''}
                      </div>
                      <div
                        className="w-full bg-[#4f7f2a] rounded-t min-h-[4px]"
                        style={{ height: `${Math.max(heightPct, 2)}%` }}
                      />
                      <div className="text-xs text-gray-400">
                        {new Date(day.date).toLocaleDateString('sk-SK', { day: 'numeric', month: 'numeric' })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Card>
          )}

          {/* Earnings breakdown */}
          <div>
            <h3 className="text-sm font-semibold text-gray-700 mb-2">Rozpis zárobkov</h3>
            {data.entries.length === 0 ? (
              <div className="text-center py-8 text-gray-400">
                <Wallet className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p className="text-sm">Žiadne zárobky v tomto období</p>
              </div>
            ) : (
              <div className="space-y-2">
                {data.entries.map((entry: any) => (
                  <Card key={entry.id} className="p-3 rounded-xl bg-white">
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900">
                          {EARNING_TYPE_LABELS[entry.type] || entry.type}
                        </p>
                        {entry.description && (
                          <p className="text-xs text-gray-500 truncate">{entry.description}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-0.5">
                          {new Date(entry.occurredAt).toLocaleString('sk-SK', {
                            day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit',
                          })}
                        </p>
                      </div>
                      <span className={`font-semibold text-sm ${entry.amountEuros >= 0 ? 'text-[#4f7f2a]' : 'text-red-600'}`}>
                        {entry.amountEuros >= 0 ? '+' : ''}{formatMoney(entry.amountEuros)}
                      </span>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}

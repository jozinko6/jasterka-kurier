'use client'

import { useState } from 'react'
import { useAuthStore, authFetch } from '@/stores/auth-store'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { toast } from 'sonner'
import { Bike, Car, User, Phone, CreditCard, FileText, Settings, LogOut, Save } from 'lucide-react'
import { formatMoney } from '@/lib/money'

export function CourierProfile({ user }: { user: any }) {
  const { logout } = useAuthStore()
  const { data: couriers, isLoading } = useQuery({
    queryKey: ['couriers'],
    queryFn: () => authFetch('/api/couriers').then(r => r.json()),
  })

  // Find own courier profile
  const myProfile = couriers?.find((c: any) => c.user?.id === user?.id) || couriers?.[0]

  if (isLoading || !myProfile) {
    return (
      <div className="p-4 space-y-3">
        <Skeleton className="h-32 rounded-2xl" />
        <Skeleton className="h-48 rounded-2xl" />
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      {/* Personal info */}
      <Card className="p-4 rounded-2xl bg-white">
        <div className="flex items-center gap-2 mb-3 text-[#4f7f2a]">
          <User className="h-4 w-4" />
          <h3 className="text-sm font-semibold">Osobné údaje</h3>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-500">Meno</dt>
            <dd className="font-medium">{myProfile.displayName}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Email</dt>
            <dd className="font-medium">{myProfile.user?.email || '—'}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-500">Telefón</dt>
            <dd className="font-medium">{myProfile.phone || myProfile.user?.phone || '—'}</dd>
          </div>
        </dl>
      </Card>

      {/* Vehicle */}
      <Card className="p-4 rounded-2xl bg-white">
        <div className="flex items-center gap-2 mb-3 text-[#4f7f2a]">
          {myProfile.vehicleType === 'BICYCLE' ? <Bike className="h-4 w-4" />
            : myProfile.vehicleType === 'SCOOTER' ? <Bike className="h-4 w-4" />
            : <Car className="h-4 w-4" />}
          <h3 className="text-sm font-semibold">Vozidlo</h3>
        </div>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-gray-500">Typ</span>
            <Badge variant="outline">
              {myProfile.vehicleType === 'BICYCLE' ? 'Bicykel'
                : myProfile.vehicleType === 'SCOOTER' ? 'Skúter'
                : 'Auto'}
            </Badge>
          </div>
          {myProfile.vehicleType === 'CAR' && myProfile.licensePlate && (
            <div className="flex justify-between">
              <span className="text-gray-500">SPZ</span>
              <span className="font-medium">{myProfile.licensePlate}</span>
            </div>
          )}
        </div>
      </Card>

      {/* Compensation profile */}
      {myProfile.activeCompensationProfile && (
        <Card className="p-4 rounded-2xl bg-white">
          <div className="flex items-center gap-2 mb-3 text-[#4f7f2a]">
            <Settings className="h-4 w-4" />
            <h3 className="text-sm font-semibold">Spolupráca</h3>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">Typ zmluvy</span>
              <Badge variant="outline">
                {myProfile.activeCompensationProfile.contractType === 'AGREEMENT' ? 'Dohoda' : 'Živnosť'}
              </Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Výplatná periodicita</span>
              <span className="font-medium">
                {myProfile.activeCompensationProfile.payoutFrequency === 'WEEKLY' ? 'Týždenne'
                  : myProfile.activeCompensationProfile.payoutFrequency === 'BIWEEKLY' ? 'Dvojtýždenne'
                  : 'Mesačne'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Sadzobník</span>
              <span className="font-medium">
                {myProfile.activeCompensationProfile.remunerationPlan?.name || 'Štandardný'}
              </span>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">
            Zmeny typu spolupráce a periodicity vyžadujú schválenie adminom.
          </p>
        </Card>
      )}

      {/* Documents */}
      <Card className="p-4 rounded-2xl bg-white">
        <div className="flex items-center gap-2 mb-3 text-[#4f7f2a]">
          <FileText className="h-4 w-4" />
          <h3 className="text-sm font-semibold">Dokumenty</h3>
        </div>
        <DocumentsList />
      </Card>

      {/* Logout */}
      <Button
        variant="outline"
        className="w-full h-12 rounded-2xl text-red-600 border-red-200 hover:bg-red-50"
        onClick={logout}
      >
        <LogOut className="h-4 w-4 mr-2" />
        Odhlásiť sa
      </Button>
    </div>
  )
}

function DocumentsList() {
  const { data, isLoading } = useQuery({
    queryKey: ['courier-documents'],
    queryFn: () => authFetch('/api/courier/documents').then(r => r.json()),
  })

  if (isLoading) return <Skeleton className="h-16 rounded-lg" />

  const invoices = data?.invoices ?? []
  const statements = data?.statements ?? []

  if (invoices.length === 0 && statements.length === 0) {
    return <p className="text-sm text-gray-400">Žiadne dokumenty</p>
  }

  return (
    <div className="space-y-2">
      {invoices.map((inv: any) => (
        <div key={inv.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
          <div>
            <p className="text-sm font-medium">{inv.invoiceNumber}</p>
            <p className="text-xs text-gray-500">
              {new Date(inv.issueDate).toLocaleDateString('sk-SK')} • {formatMoney(inv.totalAmountEuros)}
            </p>
          </div>
          <Badge variant="outline" className="text-xs">{inv.status}</Badge>
        </div>
      ))}
      {statements.map((st: any) => (
        <div key={st.id} className="flex items-center justify-between p-2 bg-gray-50 rounded-lg">
          <div>
            <p className="text-sm font-medium">{st.statementNumber}</p>
            <p className="text-xs text-gray-500">
              {new Date(st.periodStart).toLocaleDateString('sk-SK')} • {formatMoney(st.grossEarningsEuros)}
            </p>
          </div>
          <Badge variant="outline" className="text-xs">{st.status}</Badge>
        </div>
      ))}
    </div>
  )
}

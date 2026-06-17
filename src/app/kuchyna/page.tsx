'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { KitchenApp } from '@/components/jasterka/kitchen/KitchenApp'
import { LoginForm } from '@/components/jasterka/LoginForm'
import { PWAInstallBanner } from '@/components/jasterka/PWAInstallBanner'
import { useServiceWorker } from '@/hooks/useServiceWorker'
import { Button } from '@/components/ui/button'
import { LogOut } from 'lucide-react'

export default function KitchenPage() {
  useServiceWorker('/sw-kuchyna.js')
  const { isAuthenticated, isRestoring, user, logout, restore } = useAuthStore()
  const canOpenKitchen = isAuthenticated && (user?.role === 'KITCHEN' || user?.role === 'ADMIN' || user?.role === 'OWNER')

  useEffect(() => {
    restore()
  }, [restore])

  if (isRestoring) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-400 bg-gray-50">
        Overujem prihlasenie...
      </div>
    )
  }

  if (!canOpenKitchen) {
    return (
      <LoginForm
        requiredRole={['KITCHEN', 'ADMIN', 'OWNER']}
        title="Kuchyňa - Prihlásenie"
        description="Prihláste sa kuchynským účtom"
      />
    )
  }

  return (
    <>
      <div className="hidden sm:flex absolute top-2 right-4 z-50 items-center gap-2">
        <span className="text-xs text-gray-400">{user?.email}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={logout}
          className="text-gray-400 hover:text-gray-700 h-8"
        >
          <LogOut className="h-3 w-3 mr-1" />
          Odhlásiť
        </Button>
      </div>
      <KitchenApp />
      <PWAInstallBanner appName="Kuchyňa" icon="🍳" />
    </>
  )
}

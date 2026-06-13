'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { KitchenSection } from '@/components/jasterka/KitchenSection'
import { LoginForm } from '@/components/jasterka/LoginForm'
import { PWAInstallBanner, PWAInstallInstructions } from '@/components/jasterka/PWAInstallBanner'
import { useServiceWorker } from '@/hooks/useServiceWorker'
import { ChefHat, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function KitchenPage() {
  useServiceWorker('/sw-kuchyna.js')
  const { isAuthenticated, isRestoring, user, logout, restore } = useAuthStore()
  const canOpenKitchen = isAuthenticated && user?.role === 'KITCHEN'

  useEffect(() => {
    restore()
  }, [restore])

  if (isRestoring) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-gray-400" style={{ backgroundColor: '#1a1a1a' }}>
        Overujem prihlasenie...
      </div>
    )
  }

  if (!canOpenKitchen) {
    return (
      <LoginForm
        requiredRole={['KITCHEN']}
        title="Kuchyňa - Prihlásenie"
        description="Prihláste sa kuchynským účtom"
      />
    )
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#1a1a1a' }}>
      <header className="border-b px-4 py-3 flex items-center justify-between" style={{ borderColor: '#333', backgroundColor: '#222' }}>
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full flex items-center justify-center" style={{ backgroundColor: '#4f7f2a' }}>
            <ChefHat className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-white">Kuchyňa - Pizza Jašterka</h1>
            <p className="text-xs text-gray-400">Prihlásený: {user?.email} ({user?.role})</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PWAInstallInstructions appName="Kuchyňa" />
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="text-gray-400 hover:text-white"
          >
            <LogOut className="h-4 w-4 mr-1" />
            Odhlásiť
          </Button>
          <a
            href="/"
            className="text-gray-400 hover:text-white text-sm flex items-center gap-1 transition-colors"
          >
            ← Objednávka
          </a>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <KitchenSection />
      </main>

      <PWAInstallBanner appName="Kuchyňa" icon="🍳" />
    </div>
  )
}

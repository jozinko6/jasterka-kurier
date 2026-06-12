'use client'

import { useAuthStore } from '@/stores/auth-store'
import { CourierSection } from '@/components/jasterka/CourierSection'
import { LoginForm } from '@/components/jasterka/LoginForm'
import { PWAInstallBanner, PWAInstallInstructions } from '@/components/jasterka/PWAInstallBanner'
import { useServiceWorker } from '@/hooks/useServiceWorker'
import { Bike, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function CourierPage() {
  useServiceWorker('/sw-kurier.js')
  const { isAuthenticated, user, logout } = useAuthStore()

  if (!isAuthenticated) {
    return (
      <LoginForm
        requiredRole={['ADMIN', 'COURIER', 'OWNER']}
        title="Kuriér — Prihlásenie"
        description="Prihláste sa pre prístup do kuriérskeho panelu"
      />
    )
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#f0fdf4' }}>
      <header className="border-b px-4 py-3 flex items-center justify-between" style={{ borderColor: '#d1fae5', backgroundColor: 'white' }}>
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full flex items-center justify-center" style={{ backgroundColor: '#4f7f2a' }}>
            <Bike className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg" style={{ color: '#4f7f2a' }}>Kuriér — Pizza Jašterka</h1>
            <p className="text-xs text-muted-foreground">Prihlásený: {user?.email} ({user?.role})</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PWAInstallInstructions appName="Kuriér" />
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            className="text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4 mr-1" />
            Odhlásiť
          </Button>
          <a
            href="/"
            className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1 transition-colors"
          >
            ← Objednávka
          </a>
        </div>
      </header>
      <main className="flex-1 overflow-hidden">
        <CourierSection />
      </main>

      {/* PWA Install Banner */}
      <PWAInstallBanner appName="Kuriér" icon="🚗" />
    </div>
  )
}

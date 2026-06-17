'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { CourierDashboard } from '@/components/jasterka/courier/CourierDashboard'
import { LoginForm } from '@/components/jasterka/LoginForm'
import { PWAInstallBanner } from '@/components/jasterka/PWAInstallBanner'
import { useServiceWorker } from '@/hooks/useServiceWorker'

export default function CourierPage() {
  useServiceWorker('/sw-kurier.js')
  const { isAuthenticated, isRestoring, user, restore } = useAuthStore()
  const canOpenCourier = isAuthenticated && user?.role === 'COURIER'

  useEffect(() => {
    restore()
  }, [restore])

  if (isRestoring) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground" style={{ backgroundColor: '#f0fdf4' }}>
        Overujem prihlasenie...
      </div>
    )
  }

  if (!canOpenCourier) {
    return (
      <LoginForm
        requiredRole={['COURIER']}
        title="Kuriér - Prihlásenie"
        description="Prihláste sa kuriérskym účtom"
      />
    )
  }

  return (
    <>
      <CourierDashboard />
      <PWAInstallBanner appName="Kuriér" icon="🚗" />
    </>
  )
}

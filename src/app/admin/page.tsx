'use client'

import { useEffect } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { AdminSection } from '@/components/jasterka/AdminSection'
import { LoginForm } from '@/components/jasterka/LoginForm'
import { Shield, LogOut } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function AdminPage() {
  const { isAuthenticated, isRestoring, user, logout, restore } = useAuthStore()
  const canOpenAdmin = isAuthenticated && (user?.role === 'ADMIN' || user?.role === 'OWNER')

  useEffect(() => {
    restore()
  }, [restore])

  if (isRestoring) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Overujem prihlasenie...
      </div>
    )
  }

  if (!canOpenAdmin) {
    return (
      <LoginForm
        requiredRole={['ADMIN', 'OWNER']}
        title="Admin - Prihlásenie"
        description="Prihláste sa administrátorským účtom"
      />
    )
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#f8f9fa' }}>
      <header className="border-b px-4 py-3 flex items-center justify-between" style={{ borderColor: '#e0e0e0', backgroundColor: 'white' }}>
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full flex items-center justify-center" style={{ backgroundColor: '#4f7f2a' }}>
            <Shield className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg" style={{ color: '#4f7f2a' }}>Admin - Pizza Jašterka</h1>
            <p className="text-xs text-muted-foreground">Prihlásený: {user?.email} ({user?.role})</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
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
        <AdminSection />
      </main>
    </div>
  )
}

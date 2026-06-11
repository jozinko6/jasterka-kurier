'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { OrderSection } from '@/components/jasterka/OrderSection'
import { KitchenSection } from '@/components/jasterka/KitchenSection'
import { AdminSection } from '@/components/jasterka/AdminSection'
import { CourierSection } from '@/components/jasterka/CourierSection'

function AppContent() {
  const searchParams = useSearchParams()
  const view = searchParams.get('view')

  // ─── Customer page (default) ───
  if (!view || view === 'order') {
    return <CustomerPage />
  }

  // ─── Kitchen panel ───
  if (view === 'kitchen') {
    return <KitchenPage />
  }

  // ─── Admin dashboard ───
  if (view === 'admin') {
    return <AdminPage />
  }

  // ─── Courier view ───
  if (view === 'courier') {
    return <CourierPage />
  }

  // Fallback
  return <CustomerPage />
}

// ─── Customer Page ───
function CustomerPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#fffdf8' }}>
      {/* Customer Header */}
      <header className="border-b" style={{ borderColor: '#e8e0d4', backgroundColor: '#fff4df' }}>
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full flex items-center justify-center overflow-hidden" style={{ backgroundColor: '#4f7f2a' }}>
              <img src="/pizza-lizard.png" alt="Jašterka" className="w-full h-full object-cover" />
            </div>
            <div>
              <h1 className="font-bold text-xl leading-tight" style={{ color: '#4f7f2a' }}>
                Pizza Jašterka
              </h1>
              <p className="text-xs text-muted-foreground">Rozvoz pizze a jedál • Hlohovec</p>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-4 text-sm text-muted-foreground">
            <span className="flex items-center gap-1">
              📞 +421 900 123 456
            </span>
            <span className="flex items-center gap-1">
              📍 Hlavná 45, Hlohovec
            </span>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl mx-auto w-full">
        <OrderSection />
      </main>

      {/* Footer */}
      <footer className="mt-auto border-t py-4 px-4 text-center text-sm" style={{ borderColor: '#e8e0d4', backgroundColor: '#fff4df' }}>
        <div className="max-w-6xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <p className="text-muted-foreground">
            🦎 Pizza Jašterka © {new Date().getFullYear()}
          </p>
          <p className="text-muted-foreground">
            Hlavná 45, 920 01 Hlohovec • +421 900 123 456
          </p>
        </div>
      </footer>
    </div>
  )
}

// ─── Kitchen Page ───
function KitchenPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#1a1a1a' }}>
      <header className="border-b px-4 py-3 flex items-center justify-between" style={{ borderColor: '#333', backgroundColor: '#222' }}>
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full flex items-center justify-center" style={{ backgroundColor: '#4f7f2a' }}>
            <span className="text-white text-sm">👨‍🍳</span>
          </div>
          <div>
            <h1 className="font-bold text-lg text-white">Kuchyňa — Pizza Jašterka</h1>
            <p className="text-xs text-gray-400">Panel pre kuchynský personál</p>
          </div>
        </div>
        <a
          href="/"
          className="text-gray-400 hover:text-white text-sm flex items-center gap-1 transition-colors"
        >
          ← Späť na objednávku
        </a>
      </header>
      <main className="flex-1 overflow-hidden">
        <KitchenSection />
      </main>
    </div>
  )
}

// ─── Admin Page ───
function AdminPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#f8f9fa' }}>
      <header className="border-b px-4 py-3 flex items-center justify-between" style={{ borderColor: '#e0e0e0', backgroundColor: 'white' }}>
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full flex items-center justify-center" style={{ backgroundColor: '#4f7f2a' }}>
            <span className="text-white text-sm">🛡️</span>
          </div>
          <div>
            <h1 className="font-bold text-lg" style={{ color: '#4f7f2a' }}>Admin — Pizza Jašterka</h1>
            <p className="text-xs text-muted-foreground">Správa prevádzky</p>
          </div>
        </div>
        <a
          href="/"
          className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1 transition-colors"
        >
          ← Späť na objednávku
        </a>
      </header>
      <main className="flex-1 overflow-hidden">
        <AdminSection />
      </main>
    </div>
  )
}

// ─── Courier Page ───
function CourierPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#f0fdf4' }}>
      <header className="border-b px-4 py-3 flex items-center justify-between" style={{ borderColor: '#d1fae5', backgroundColor: 'white' }}>
        <div className="flex items-center gap-3">
          <div className="h-8 w-8 rounded-full flex items-center justify-center" style={{ backgroundColor: '#4f7f2a' }}>
            <span className="text-white text-sm">🚗</span>
          </div>
          <div>
            <h1 className="font-bold text-lg" style={{ color: '#4f7f2a' }}>Kuriér — Pizza Jašterka</h1>
            <p className="text-xs text-muted-foreground">Panel pre kuriérov</p>
          </div>
        </div>
        <a
          href="/"
          className="text-muted-foreground hover:text-foreground text-sm flex items-center gap-1 transition-colors"
        >
          ← Späť na objednávku
        </a>
      </header>
      <main className="flex-1 overflow-hidden">
        <CourierSection />
      </main>
    </div>
  )
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: '#fffdf8' }}>
        <div className="text-center">
          <div className="h-12 w-12 rounded-full flex items-center justify-center mx-auto mb-3 animate-pulse" style={{ backgroundColor: '#4f7f2a' }}>
            <span className="text-2xl">🦎</span>
          </div>
          <p className="text-muted-foreground">Načítavam...</p>
        </div>
      </div>
    }>
      <AppContent />
    </Suspense>
  )
}

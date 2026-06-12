'use client'

import { OrderSection } from '@/components/jasterka/OrderSection'

export default function HomePage() {
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

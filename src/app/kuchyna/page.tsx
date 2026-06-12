'use client'

import { KitchenSection } from '@/components/jasterka/KitchenSection'
import { PWAInstallBanner, PWAInstallInstructions } from '@/components/jasterka/PWAInstallBanner'
import { useServiceWorker } from '@/hooks/useServiceWorker'
import { ChefHat } from 'lucide-react'

export default function KitchenPage() {
  useServiceWorker('/sw-kuchyna.js')

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#1a1a1a' }}>
      <header className="border-b px-4 py-3 flex items-center justify-between" style={{ borderColor: '#333', backgroundColor: '#222' }}>
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full flex items-center justify-center" style={{ backgroundColor: '#4f7f2a' }}>
            <ChefHat className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-lg text-white">Kuchyňa — Pizza Jašterka</h1>
            <p className="text-xs text-gray-400">Panel pre kuchynský personál</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <PWAInstallInstructions appName="Kuchyňa" />
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

      {/* PWA Install Banner */}
      <PWAInstallBanner appName="Kuchyňa" icon="👨‍🍳" />
    </div>
  )
}

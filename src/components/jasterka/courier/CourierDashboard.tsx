'use client'

import { useState } from 'react'
import { useAuthStore } from '@/stores/auth-store'
import { CourierHome } from '@/components/jasterka/courier/CourierHome'
import { CourierDeliveries } from '@/components/jasterka/courier/CourierDeliveries'
import { CourierEarnings } from '@/components/jasterka/courier/CourierEarnings'
import { CourierProfile } from '@/components/jasterka/courier/CourierProfile'
import { ActiveDelivery } from '@/components/jasterka/courier/ActiveDelivery'
import { Home, Package, Wallet, User } from 'lucide-react'
import { cn } from '@/lib/utils'

type Tab = 'home' | 'deliveries' | 'earnings' | 'profile'

/**
 * Modern mobile-first courier dashboard with bottom navigation.
 * Inspired by Wolt Partner / Bolt Food Courier UX patterns:
 * - 4 main sections accessible via bottom nav
 * - Large touch targets for one-handed use
 * - Online/offline toggle prominently on home
 * - Active delivery takes full screen when in progress
 */
export function CourierDashboard() {
  const [activeTab, setActiveTab] = useState<Tab>('home')
  const { user } = useAuthStore()

  // If there's an active delivery, show it full-screen regardless of tab
  const [showActiveDelivery, setShowActiveDelivery] = useState(false)

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab)
    setShowActiveDelivery(false)
  }

  return (
    <div className="flex flex-col h-screen max-w-2xl mx-auto bg-gray-50">
      {/* Main content area */}
      <main className="flex-1 overflow-y-auto pb-20 safe-area-bottom">
        {activeTab === 'home' && (
          <CourierHome
            onGoOnline={() => setShowActiveDelivery(true)}
            onNavigate={handleTabChange}
          />
        )}
        {activeTab === 'deliveries' && (
          <CourierDeliveries
            onOpenActive={() => setShowActiveDelivery(true)}
          />
        )}
        {activeTab === 'earnings' && <CourierEarnings />}
        {activeTab === 'profile' && <CourierProfile user={user} />}
      </main>

      {/* Active delivery overlay (full screen) */}
      {showActiveDelivery && (
        <ActiveDelivery onClose={() => setShowActiveDelivery(false)} />
      )}

      {/* Bottom navigation */}
      <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-2xl bg-white border-t border-gray-200 safe-area-bottom z-40">
        <div className="grid grid-cols-4 h-16">
          <NavButton
            active={activeTab === 'home'}
            onClick={() => handleTabChange('home')}
            icon={<Home className="h-5 w-5" />}
            label="Domov"
          />
          <NavButton
            active={activeTab === 'deliveries'}
            onClick={() => handleTabChange('deliveries')}
            icon={<Package className="h-5 w-5" />}
            label="Doručenia"
          />
          <NavButton
            active={activeTab === 'earnings'}
            onClick={() => handleTabChange('earnings')}
            icon={<Wallet className="h-5 w-5" />}
            label="Zárobky"
          />
          <NavButton
            active={activeTab === 'profile'}
            onClick={() => handleTabChange('profile')}
            icon={<User className="h-5 w-5" />}
            label="Profil"
          />
        </div>
      </nav>
    </div>
  )
}

function NavButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean
  onClick: () => void
  icon: React.ReactNode
  label: string
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center justify-center gap-1 transition-colors',
        active ? 'text-[#4f7f2a]' : 'text-gray-400'
      )}
    >
      {icon}
      <span className="text-xs font-medium">{label}</span>
    </button>
  )
}

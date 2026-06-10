'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Separator } from '@/components/ui/separator'
import { OrderSection } from '@/components/jasterka/OrderSection'
import { KitchenSection } from '@/components/jasterka/KitchenSection'
import { AdminSection } from '@/components/jasterka/AdminSection'
import { CourierSection } from '@/components/jasterka/CourierSection'
import {
  ShoppingCart,
  ChefHat,
  Shield,
  Bike,
  Menu,
} from 'lucide-react'

type Section = 'order' | 'kitchen' | 'admin' | 'courier'

const NAV_ITEMS: { id: Section; label: string; icon: React.ReactNode }[] = [
  { id: 'order', label: 'Objednávka', icon: <ShoppingCart className="h-5 w-5" /> },
  { id: 'kitchen', label: 'Kuchyňa', icon: <ChefHat className="h-5 w-5" /> },
  { id: 'admin', label: 'Admin', icon: <Shield className="h-5 w-5" /> },
  { id: 'courier', label: 'Kuriér', icon: <Bike className="h-5 w-5" /> },
]

function NavItems({ activeSection, setActiveSection, onClick }: {
  activeSection: Section
  setActiveSection: (s: Section) => void
  onClick?: () => void
}) {
  return (
    <>
      {NAV_ITEMS.map((item) => (
        <Button
          key={item.id}
          variant={activeSection === item.id ? 'default' : 'ghost'}
          className={`w-full justify-start gap-3 h-12 text-base ${
            activeSection === item.id ? 'text-white font-semibold' : ''
          }`}
          style={activeSection === item.id ? { backgroundColor: '#4f7f2a' } : {}}
          onMouseEnter={(e) => {
            if (activeSection === item.id) e.currentTarget.style.backgroundColor = '#3d6620'
          }}
          onMouseLeave={(e) => {
            if (activeSection === item.id) e.currentTarget.style.backgroundColor = '#4f7f2a'
          }}
          onClick={() => {
            setActiveSection(item.id)
            onClick?.()
          }}
        >
          {item.icon}
          {item.label}
        </Button>
      ))}
    </>
  )
}

export default function Home() {
  const [activeSection, setActiveSection] = useState<Section>('order')
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  const renderSection = () => {
    switch (activeSection) {
      case 'order':
        return <OrderSection />
      case 'kitchen':
        return <KitchenSection />
      case 'admin':
        return <AdminSection />
      case 'courier':
        return <CourierSection />
    }
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#fffdf8' }}>
      {/* Mobile Header */}
      <header className="lg:hidden flex items-center justify-between p-3 border-b" style={{ borderColor: '#e8e0d4' }}>
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 rounded-full flex items-center justify-center overflow-hidden" style={{ backgroundColor: '#4f7f2a' }}>
            <img src="/pizza-lizard.png" alt="Jašterka" className="w-full h-full object-cover" />
          </div>
          <span className="font-bold text-lg" style={{ color: '#4f7f2a' }}>
            Jašterka
          </span>
        </div>

        <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon">
              <Menu className="h-6 w-6" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-4">
            <div className="flex items-center gap-2 mb-6">
              <div className="h-10 w-10 rounded-full flex items-center justify-center overflow-hidden" style={{ backgroundColor: '#4f7f2a' }}>
                <img src="/pizza-lizard.png" alt="Jašterka" className="w-full h-full object-cover" />
              </div>
              <div>
                <h2 className="font-bold text-lg" style={{ color: '#4f7f2a' }}>Pizza Jašterka</h2>
                <p className="text-xs text-muted-foreground">Rozvoz pizze a jedál</p>
              </div>
            </div>
            <Separator className="mb-4" />
            <nav className="space-y-1">
              <NavItems activeSection={activeSection} setActiveSection={setActiveSection} onClick={() => setMobileNavOpen(false)} />
            </nav>
          </SheetContent>
        </Sheet>
      </header>

      {/* Main Layout */}
      <div className="flex-1 flex">
        {/* Desktop Sidebar */}
        <aside className="hidden lg:flex lg:flex-col lg:w-64 border-r p-4" style={{ borderColor: '#e8e0d4', backgroundColor: '#fffdf8' }}>
          <div className="flex items-center gap-2 mb-6">
            <div className="h-10 w-10 rounded-full flex items-center justify-center overflow-hidden" style={{ backgroundColor: '#4f7f2a' }}>
              <img src="/pizza-lizard.png" alt="Jašterka" className="w-full h-full object-cover" />
            </div>
            <div>
              <h2 className="font-bold text-lg" style={{ color: '#4f7f2a' }}>Pizza Jašterka</h2>
              <p className="text-xs text-muted-foreground">Rozvoz pizze a jedál</p>
            </div>
          </div>

          <Separator className="mb-4" />

          <nav className="space-y-1 flex-1">
            <NavItems activeSection={activeSection} setActiveSection={setActiveSection} />
          </nav>

          <Separator className="my-4" />

          <div className="text-xs text-muted-foreground space-y-1">
            <p>🦎 Pizza Jašterka</p>
            <p>Hlavná 45, 920 01 Hlohovec</p>
            <p>+421 900 123 456</p>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden">
          {renderSection()}
        </main>
      </div>

      {/* Footer */}
      <footer className="mt-auto border-t py-3 px-4 text-center text-xs text-muted-foreground" style={{ borderColor: '#e8e0d4', backgroundColor: '#fff4df' }}>
        🦎 Pizza Jašterka © {new Date().getFullYear()} — Hlavná 45, 920 01 Hlohovec
      </footer>
    </div>
  )
}

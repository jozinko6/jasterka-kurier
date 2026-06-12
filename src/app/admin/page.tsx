'use client'

import { AdminSection } from '@/components/jasterka/AdminSection'
import { Shield } from 'lucide-react'

export default function AdminPage() {
  return (
    <div className="min-h-screen flex flex-col" style={{ backgroundColor: '#f8f9fa' }}>
      <header className="border-b px-4 py-3 flex items-center justify-between" style={{ borderColor: '#e0e0e0', backgroundColor: 'white' }}>
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-full flex items-center justify-center" style={{ backgroundColor: '#4f7f2a' }}>
            <Shield className="h-5 w-5 text-white" />
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
          ← Objednávka
        </a>
      </header>
      <main className="flex-1 overflow-hidden">
        <AdminSection />
      </main>
    </div>
  )
}

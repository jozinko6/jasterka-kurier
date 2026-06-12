'use client'

import { useState } from 'react'
import { usePWAInstall } from '@/hooks/usePWAInstall'
import { Button } from '@/components/ui/button'
import { X, Download, Smartphone } from 'lucide-react'

interface PWAInstallBannerProps {
  appName: string
  icon?: string
}

export function PWAInstallBanner({ appName, icon = '📱' }: PWAInstallBannerProps) {
  const { isInstallable, isInstalled, install } = usePWAInstall()
  const [dismissed, setDismissed] = useState(false)

  if (isInstalled || dismissed || !isInstallable) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-3 safe-area-bottom">
      <div className="max-w-lg mx-auto rounded-2xl shadow-2xl border p-4 flex items-center gap-3"
        style={{
          backgroundColor: '#fff4df',
          borderColor: '#e8e0d4',
        }}
      >
        <div className="h-12 w-12 rounded-xl flex items-center justify-center shrink-0 text-2xl"
          style={{ backgroundColor: '#4f7f2a' }}
        >
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-sm" style={{ color: '#4f7f2a' }}>
            Nainštalovať {appName}
          </p>
          <p className="text-xs text-muted-foreground">
            Pridajte si aplikáciu na plochu pre rýchly prístup
          </p>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            onClick={install}
            className="gap-1 text-xs"
            style={{ backgroundColor: '#4f7f2a', color: 'white' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#3d6620')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#4f7f2a')}
          >
            <Download className="h-3.5 w-3.5" />
            Inštalovať
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => setDismissed(true)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

/**
 * Manual install instructions shown when the browser doesn't support
 * the beforeinstallprompt event (e.g. iOS Safari).
 */
export function PWAInstallInstructions({ appName }: { appName: string }) {
  const { isInstalled } = usePWAInstall()
  const [showInstructions, setShowInstructions] = useState(false)

  if (isInstalled) return null

  // Detect iOS
  const isIOS = typeof navigator !== 'undefined' &&
    /iPad|iPhone|iPod/.test(navigator.userAgent)

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        onClick={() => setShowInstructions(true)}
      >
        <Smartphone className="h-4 w-4" />
        Uložiť na plochu
      </Button>

      {showInstructions && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50"
          onClick={() => setShowInstructions(false)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl p-6 space-y-4"
            style={{ backgroundColor: '#fff4df' }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-bold text-lg" style={{ color: '#4f7f2a' }}>
              Ako nainštalovať {appName}
            </h3>

            {isIOS ? (
              <ol className="space-y-3 text-sm">
                <li className="flex gap-2">
                  <span className="font-bold" style={{ color: '#4f7f2a' }}>1.</span>
                  <span>Ťuknite na ikonu <strong>zdieľania</strong> <span className="inline-block">⬆️</span> v spodnom paneli</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold" style={{ color: '#4f7f2a' }}>2.</span>
                  <span>Posuňte nadol a ťuknite na <strong>&quot;Pridať na plochu&quot;</strong></span>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold" style={{ color: '#4f7f2a' }}>3.</span>
                  <span>Potvrďte ťuknutím na <strong>&quot;Pridať&quot;</strong></span>
                </li>
              </ol>
            ) : (
              <ol className="space-y-3 text-sm">
                <li className="flex gap-2">
                  <span className="font-bold" style={{ color: '#4f7f2a' }}>1.</span>
                  <span>Otvorte menu prehliadača <strong>⋮</strong> (vpravo hore)</span>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold" style={{ color: '#4f7f2a' }}>2.</span>
                  <span>Ťuknite na <strong>&quot;Pridať na plochu&quot;</strong> alebo <strong>&quot;Inštalovať aplikáciu&quot;</strong></span>
                </li>
                <li className="flex gap-2">
                  <span className="font-bold" style={{ color: '#4f7f2a' }}>3.</span>
                  <span>Potvrďte inštaláciu</span>
                </li>
              </ol>
            )}

            <Button
              className="w-full"
              onClick={() => setShowInstructions(false)}
              style={{ backgroundColor: '#4f7f2a', color: 'white' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#3d6620')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#4f7f2a')}
            >
              Rozumiem
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

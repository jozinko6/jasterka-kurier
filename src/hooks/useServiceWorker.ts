'use client'

import { useEffect } from 'react'

export function useServiceWorker(swPath: string) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!('serviceWorker' in navigator)) return

    navigator.serviceWorker
      .register(swPath)
      .then((reg) => {
        console.log('SW registered:', reg.scope)
      })
      .catch((err) => {
        console.warn('SW registration failed:', err)
      })
  }, [swPath])
}

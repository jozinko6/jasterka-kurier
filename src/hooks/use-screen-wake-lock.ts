/**
 * Screen Wake Lock API hook.
 *
 * Keeps the screen on while the kitchen app is active.
 * Requires a user interaction to activate (browser requirement).
 * Re-acquires lock on visibility change.
 */

import { useState, useEffect, useCallback } from 'react'

interface WakeLockSentinel {
  released: boolean
  release: () => Promise<void>
  addEventListener: (type: string, listener: () => void) => void
}

export function useScreenWakeLock() {
  const [isActive, setIsActive] = useState(false)
  const [isSupported] = useState(
    typeof navigator !== 'undefined' && 'wakeLock' in navigator
  )
  const [sentinel, setSentinel] = useState<WakeLockSentinel | null>(null)

  const request = useCallback(async () => {
    if (!('wakeLock' in navigator)) return
    try {
      const nav = navigator as Navigator & { wakeLock?: { request: (type: string) => Promise<WakeLockSentinel> } }
      const lock = await nav.wakeLock!.request('screen')
      setSentinel(lock)
      setIsActive(true)

      lock.addEventListener('release', () => {
        setIsActive(false)
        setSentinel(null)
      })
    } catch {
      setIsActive(false)
    }
  }, [])

  const release = useCallback(async () => {
    if (sentinel) {
      try {
        await sentinel.release()
      } catch {
        // ignore
      }
      setSentinel(null)
      setIsActive(false)
    }
  }, [sentinel])

  // Re-acquire on visibility change (wake lock is lost when tab is hidden)
  useEffect(() => {
    if (!isSupported || !isActive) return
    const handleVisibility = async () => {
      if (document.visibilityState === 'visible' && !sentinel) {
        await request()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [isSupported, isActive, sentinel, request])

  return { isActive, isSupported, request, release }
}

import { create } from 'zustand'

export interface AuthUser {
  id: string
  email: string | null
  phone: string | null
  role: 'ADMIN' | 'KITCHEN' | 'COURIER' | 'CUSTOMER' | 'OWNER'
  isActive: boolean
}

interface AuthState {
  user: AuthUser | null
  isAuthenticated: boolean
  isRestoring: boolean
  login: (email: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
  restore: () => Promise<AuthUser | null>
}

export const useAuthStore = create<AuthState>()((set) => ({
  user: null,
  isAuthenticated: false,
  isRestoring: false,

  login: async (email: string, password: string) => {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password }),
    })

    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Prihlasenie zlyhalo')
    }

    const data = await res.json()
    set({
      user: data.user,
      isAuthenticated: true,
    })

    return data.user as AuthUser
  },

  logout: async () => {
    try {
      await fetch('/api/auth', {
        method: 'DELETE',
        credentials: 'include',
      })
    } catch {
      // Ignore logout API errors.
    }
    // Signal all service workers to purge caches so no personal data survives
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      try {
        const regs = await navigator.serviceWorker.getRegistrations()
        for (const reg of regs) {
          reg.active?.postMessage({ type: 'LOGOUT' })
        }
        // Also clear caches directly (belt-and-suspenders)
        if ('caches' in window) {
          const keys = await caches.keys()
          await Promise.all(keys.map((k) => caches.delete(k)))
        }
      } catch {
        // SW not available — ignore
      }
    }
    set({ user: null, isAuthenticated: false })
  },

  restore: async () => {
    set({ isRestoring: true })
    try {
      const res = await fetch('/api/auth', {
        method: 'GET',
        credentials: 'include',
      })

      if (!res.ok) {
        set({ user: null, isAuthenticated: false, isRestoring: false })
        return null
      }

      const data = await res.json()
      set({
        user: data.user,
        isAuthenticated: true,
        isRestoring: false,
      })
      return data.user as AuthUser
    } catch {
      set({ user: null, isAuthenticated: false, isRestoring: false })
      return null
    }
  },
}))

/**
 * Authenticated fetch wrapper. Browser requests rely on the httpOnly session
 * cookie; QA/API scripts can still send Authorization headers directly.
 */
export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {})

  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }

  return fetch(url, {
    ...options,
    credentials: options.credentials || 'include',
    headers,
  })
}

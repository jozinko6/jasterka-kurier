import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface AuthUser {
  id: string
  email: string | null
  phone: string | null
  role: 'ADMIN' | 'KITCHEN' | 'COURIER' | 'CUSTOMER' | 'OWNER'
  isActive: boolean
}

interface AuthState {
  token: string | null
  user: AuthUser | null
  isAuthenticated: boolean
  login: (email: string, password: string) => Promise<AuthUser>
  logout: () => Promise<void>
  setAuth: (token: string, user: AuthUser) => void
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      isAuthenticated: false,

      login: async (email: string, password: string) => {
        const res = await fetch('/api/auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        })

        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.error || 'Prihlásenie zlyhalo')
        }

        const data = await res.json()
        set({
          token: data.token,
          user: data.user,
          isAuthenticated: true,
        })

        return data.user as AuthUser
      },

      logout: async () => {
        const { token } = get()
        if (token) {
          try {
            await fetch('/api/auth', {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${token}` },
            })
          } catch {
            // Ignore logout API errors
          }
        }
        set({ token: null, user: null, isAuthenticated: false })
      },

      setAuth: (token: string, user: AuthUser) => {
        set({ token, user, isAuthenticated: true })
      },
    }),
    {
      name: 'jasterka-auth',
      partialize: (state) => ({
        token: state.token,
        user: state.user,
        isAuthenticated: state.isAuthenticated,
      }),
    }
  )
)

/**
 * Authenticated fetch wrapper that adds the Authorization header.
 * Use this for all protected API calls.
 */
export function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const { token } = useAuthStore.getState()
  const headers = new Headers(options.headers || {})

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  if (!headers.has('Content-Type') && options.body && typeof options.body === 'string') {
    headers.set('Content-Type', 'application/json')
  }

  return fetch(url, {
    ...options,
    headers,
  })
}

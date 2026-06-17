/**
 * Hooks for kitchen order management.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { authFetch } from '@/stores/auth-store'
import { toast } from 'sonner'
import type { KitchenOrderDTO } from '@/lib/kitchen-dto'

/**
 * Fetch kitchen orders with polling.
 * Polls every 4 seconds when tab is visible, pauses when hidden.
 */
export function useKitchenOrders() {
  return useQuery<KitchenOrderDTO[]>({
    queryKey: ['kitchen-orders'],
    queryFn: async () => {
      const res = await authFetch('/api/kitchen')
      if (!res.ok) throw new Error('Nepodarilo sa načítať objednávky')
      return res.json()
    },
    refetchInterval: (query) => {
      // Pause polling when tab is hidden
      if (typeof document !== 'undefined' && document.hidden) return false
      return 4000
    },
  })
}

/**
 * Set order estimate (MINUTES, EXACT_TIME, or DELAY mode).
 */
export function useSetEstimate() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      orderId: string
      mode: 'MINUTES' | 'EXACT_TIME' | 'DELAY'
      minutes?: number
      estimatedReadyAt?: string
      additionalMinutes?: number
      reason?: string
      expectedVersion: number
    }) => {
      const res = await authFetch(`/api/kitchen/orders/${params.orderId}/estimate`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || 'Chyba pri nastavení času')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Chyba pri nastavení času')
    },
  })
}

/**
 * Accept order with preparation time (atomic).
 */
export function useAcceptOrder() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      orderId: string
      prepMinutes: number
      expectedStatus?: string
      expectedEstimateVersion?: number
    }) => {
      const res = await authFetch(`/api/kitchen/orders/${params.orderId}/accept`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || 'Chyba pri prijímaní objednávky')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] })
      toast.success('Objednávka prijatá')
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Chyba pri prijímaní objednávky')
    },
  })
}

/**
 * Update order status (for non-estimate transitions like IN_KITCHEN, PREPARING, READY).
 */
export function useUpdateOrderStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: { orderId: string; status: string; expectedStatus?: string }) => {
      const res = await authFetch(`/api/orders/${params.orderId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: params.status, expectedStatus: params.expectedStatus }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || 'Chyba pri aktualizácii stavu')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : 'Chyba pri aktualizácii stavu')
    },
  })
}

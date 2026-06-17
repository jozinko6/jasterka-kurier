/**
 * React Query hooks for courier API endpoints.
 *
 * Centralizes data fetching so components stay clean and testable.
 * All mutations invalidate the dashboard query so the UI stays fresh.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { authFetch } from '@/stores/auth-store'

// ─── Dashboard ───

export interface CourierDashboardData {
  courier: {
    id: string
    displayName: string
    vehicleType: string
    status: string
    isOnline: boolean
  }
  today: {
    date: string
    earningsCents: number
    earningsEuros: number
    deliveryCount: number
    pendingEarningsCents: number
  }
  workSession: {
    id: string
    startedAt: string
    totalActiveSeconds: number
    status: string
  } | null
  cashBalanceCents: number
  cashBalanceEuros: number
  activeAssignment: {
    assignmentId: string
    assignmentStatus: string
    order: {
      id: string
      orderNumber: string
      status: string
      orderType: string
      paymentMethod: string
      totalAmount: number
      customerName: string
      customerPhone: string
      deliveryAddressLine1: string | null
      deliveryCity: string | null
      deliveryNote: string | null
      kitchenNote: string | null
      items: Array<{ id: string; menuItemNameSnapshot: string; quantity: number }>
      zone: { id: string; name: string } | null
    }
  } | null
  openPayoutPeriod: {
    id: string
    periodStart: string
    periodEnd: string
    payoutDueDate: string
    payableCents: number
    payableEuros: number
    status: string
  } | null
}

export function useCourierDashboard() {
  return useQuery<CourierDashboardData>({
    queryKey: ['courier-dashboard'],
    queryFn: () => authFetch('/api/courier/dashboard').then(r => {
      if (!r.ok) throw new Error('Failed to load dashboard')
      return r.json()
    }),
    refetchInterval: 15000, // Poll every 15 seconds for live updates
  })
}

// ─── Deliveries ───

export function useCourierDeliveries(filter: 'active' | 'scheduled' | 'completed' | 'cancelled' = 'active', range?: string) {
  const params = new URLSearchParams({ filter })
  if (range) params.set('range', range)
  return useQuery({
    queryKey: ['courier-deliveries', filter, range],
    queryFn: () => authFetch(`/api/courier/deliveries?${params}`).then(r => {
      if (!r.ok) throw new Error('Failed to load deliveries')
      return r.json()
    }),
    refetchInterval: filter === 'active' ? 10000 : false,
  })
}

// ─── Earnings ───

export function useCourierEarnings(range: 'today' | 'week' | 'month' | 'period' | 'custom' = 'today', params?: { from?: string; to?: string; periodId?: string }) {
  const searchParams = new URLSearchParams({ range })
  if (params?.from) searchParams.set('from', params.from)
  if (params?.to) searchParams.set('to', params.to)
  if (params?.periodId) searchParams.set('periodId', params.periodId)
  return useQuery({
    queryKey: ['courier-earnings', range, params],
    queryFn: () => authFetch(`/api/courier/earnings?${searchParams}`).then(r => {
      if (!r.ok) throw new Error('Failed to load earnings')
      return r.json()
    }),
  })
}

// ─── Payout Periods ───

export function useCourierPayoutPeriods(status?: string) {
  const params = status ? `?status=${status}` : ''
  return useQuery({
    queryKey: ['courier-payout-periods', status],
    queryFn: () => authFetch(`/api/courier/payout-periods${params}`).then(r => {
      if (!r.ok) throw new Error('Failed to load payout periods')
      return r.json()
    }),
  })
}

export function useCourierPayoutPeriod(periodId: string | null) {
  return useQuery({
    queryKey: ['courier-payout-period', periodId],
    queryFn: () => {
      if (!periodId) return null
      return authFetch(`/api/courier/payout-periods/${periodId}`).then(r => {
        if (!r.ok) throw new Error('Failed to load payout period')
        return r.json()
      })
    },
    enabled: !!periodId,
  })
}

// ─── Cash Balance ───

export function useCourierCashBalance() {
  return useQuery({
    queryKey: ['courier-cash-balance'],
    queryFn: () => authFetch('/api/courier/cash-balance').then(r => {
      if (!r.ok) throw new Error('Failed to load cash balance')
      return r.json()
    }),
  })
}

// ─── Documents ───

export function useCourierDocuments() {
  return useQuery({
    queryKey: ['courier-documents'],
    queryFn: () => authFetch('/api/courier/documents').then(r => {
      if (!r.ok) throw new Error('Failed to load documents')
      return r.json()
    }),
  })
}

// ─── Mutations ───

export function useCourierAction() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ orderId, action }: { orderId: string; action: 'pickup' | 'start-delivery' | 'complete' }) => {
      const res = await authFetch(`/api/courier/orders/${orderId}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || data.error || 'Akcia zlyhala')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courier-dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['courier-deliveries'] })
      queryClient.invalidateQueries({ queryKey: ['courier-earnings'] })
      queryClient.invalidateQueries({ queryKey: ['courier-cash-balance'] })
    },
  })
}

export function useWorkSession() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (action: 'start' | 'end' | 'pause' | 'resume') => {
      const res = await authFetch('/api/courier/work-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.message || data.error || 'Smena zlyhala')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courier-dashboard'] })
    },
  })
}

export function useUpdateCourierStatus() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ courierId, status }: { courierId: string; status: string }) => {
      const res = await authFetch('/api/couriers', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ courierId, status }),
      })
      if (!res.ok) throw new Error('Aktualizácia stavu zlyhala')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courier-dashboard'] })
      queryClient.invalidateQueries({ queryKey: ['couriers'] })
    },
  })
}

export function useAcceptInvoice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (invoiceId: string) => {
      const res = await authFetch(`/api/courier/invoices/${invoiceId}/accept`, { method: 'POST' })
      if (!res.ok) throw new Error('Akceptácia zlyhala')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courier-documents'] })
    },
  })
}

export function useRejectInvoice() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ invoiceId, reason }: { invoiceId: string; reason: string }) => {
      const res = await authFetch(`/api/courier/invoices/${invoiceId}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      })
      if (!res.ok) throw new Error('Odmietnutie zlyhalo')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['courier-documents'] })
    },
  })
}

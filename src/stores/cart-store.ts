import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { CartItem, MenuItem, MenuItemOption } from '@/lib/types'

interface CartState {
  items: CartItem[]
  addItem: (menuItem: MenuItem, selectedSize: MenuItemOption | null, selectedExtras: MenuItemOption[], selectedRemoves: MenuItemOption[], kitchenNote: string, quantity: number) => void
  removeItem: (index: number) => void
  updateQuantity: (index: number, quantity: number) => void
  clearCart: () => void
  getSubtotal: () => number
  getItemCount: () => number
}

function calculateUnitTotal(
  basePrice: number,
  selectedSize: MenuItemOption | null,
  selectedExtras: MenuItemOption[]
): number {
  let total = basePrice
  if (selectedSize) {
    total += selectedSize.priceDelta
  }
  for (const extra of selectedExtras) {
    total += extra.priceDelta
  }
  return total
}

export const useCartStore = create<CartState>()(
  persist(
    (set, get) => ({
      items: [],

      addItem: (menuItem, selectedSize, selectedExtras, selectedRemoves, kitchenNote, quantity) => {
        const unitTotal = calculateUnitTotal(menuItem.basePrice, selectedSize, selectedExtras)
        const lineTotal = unitTotal * quantity

        const newItem: CartItem = {
          menuItem,
          quantity,
          selectedSize,
          selectedExtras,
          selectedRemoves,
          kitchenNote,
          unitTotal,
          lineTotal,
        }

        set((state) => ({
          items: [...state.items, newItem],
        }))
      },

      removeItem: (index) => {
        set((state) => ({
          items: state.items.filter((_, i) => i !== index),
        }))
      },

      updateQuantity: (index, quantity) => {
        if (quantity <= 0) {
          get().removeItem(index)
          return
        }
        set((state) => ({
          items: state.items.map((item, i) =>
            i === index
              ? { ...item, quantity, lineTotal: item.unitTotal * quantity }
              : item
          ),
        }))
      },

      clearCart: () => set({ items: [] }),

      getSubtotal: () => {
        return get().items.reduce((sum, item) => sum + item.lineTotal, 0)
      },

      getItemCount: () => {
        return get().items.reduce((sum, item) => sum + item.quantity, 0)
      },
    }),
    {
      name: 'jasterka-cart',
    }
  )
)

'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import type { MenuCategory, MenuItem, MenuItemOption, DeliveryZone, Order, OrderStatus } from '@/lib/types'
import { formatPrice, getStatusColor, ORDER_STATUS_LABELS, VEHICLE_TYPE_LABELS } from '@/lib/types'
import { useCartStore } from '@/stores/cart-store'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Checkbox } from '@/components/ui/checkbox'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Separator } from '@/components/ui/separator'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ShoppingCart,
  Plus,
  Minus,
  Trash2,
  Pizza,
  Truck,
  User,
  Phone,
  Mail,
  MapPin,
  MessageSquare,
  CreditCard,
  ChevronRight,
  ArrowLeft,
  Check,
  Clock,
  Package,
  X,
  Info,
} from 'lucide-react'

// ─── Menu Browsing ───
export function OrderSection() {
  const [configItem, setConfigItem] = useState<MenuItem | null>(null)
  const [configOpen, setConfigOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)
  const [checkoutOpen, setCheckoutOpen] = useState(false)
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null)

  const { data: categories, isLoading } = useQuery<MenuCategory[]>({
    queryKey: ['menu'],
    queryFn: () => fetch('/api/menu').then(r => {
      if (!r.ok) throw new Error('Failed to fetch menu')
      return r.json()
    }),
  })

  const cartStore = useCartStore()

  const [selectedCategory, setSelectedCategory] = useState<string>('')
  const effectiveCategory = useMemo(() => {
    if (selectedCategory) return selectedCategory
    if (categories && categories.length > 0) return categories[0].id
    return ''
  }, [selectedCategory, categories])

  if (trackingOrderId) {
    return (
      <OrderTracking
        orderId={trackingOrderId}
        onBack={() => setTrackingOrderId(null)}
      />
    )
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with cart icon */}
      <div className="flex items-center justify-between p-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <div>
          <h2 className="text-xl font-bold" style={{ color: '#4f7f2a' }}>Naše menu</h2>
          <p className="text-sm text-muted-foreground">Vyberte si z našej ponuky</p>
        </div>
        <Button
          variant="outline"
          size="icon"
          className="relative"
          onClick={() => setCartOpen(true)}
        >
          <ShoppingCart className="h-5 w-5" />
          {cartStore.getItemCount() > 0 && (
            <Badge
              className="absolute -top-2 -right-2 h-5 w-5 flex items-center justify-center p-0 text-xs"
              style={{ backgroundColor: '#c73325', color: 'white' }}
            >
              {cartStore.getItemCount()}
            </Badge>
          )}
        </Button>
      </div>

      {/* Category tabs */}
      {isLoading ? (
        <div className="p-4 space-y-4">
          <div className="flex gap-2">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-10 w-24 rounded-full" />
            ))}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3, 4, 5, 6].map(i => (
              <Skeleton key={i} className="h-48 rounded-xl" />
            ))}
          </div>
        </div>
      ) : (
        <Tabs value={effectiveCategory} onValueChange={setSelectedCategory} className="flex-1 flex flex-col">
          <div className="px-4 pt-2">
            <TabsList className="w-full flex h-auto flex-wrap gap-1 bg-transparent p-0">
              {categories?.map((cat) => (
                <TabsTrigger
                  key={cat.id}
                  value={cat.id}
                  className="data-[state=active]:text-white data-[state=active]:shadow-sm rounded-full px-4 py-2 text-sm"
                  style={{
                    backgroundColor: effectiveCategory === cat.id ? '#4f7f2a' : 'transparent',
                    color: effectiveCategory === cat.id ? 'white' : undefined,
                  }}
                >
                  {cat.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>

          <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
            {categories?.map((cat) => (
              <TabsContent key={cat.id} value={cat.id} className="mt-0">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {cat.menuItems
                    .filter(item => item.isAvailable)
                    .map((item) => (
                      <MenuCard
                        key={item.id}
                        item={item}
                        categorySlug={cat.slug}
                        onAdd={() => {
                          if (item.options.length > 0) {
                            setConfigItem(item)
                            setConfigOpen(true)
                          } else {
                            cartStore.addItem(item, null, [], [], '', 1)
                            toast.success(`${item.name} pridané do košíka`)
                          }
                        }}
                      />
                    ))}
                </div>
                {cat.menuItems.filter(item => item.isAvailable).length === 0 && (
                  <div className="text-center py-12 text-muted-foreground">
                    <Pizza className="h-12 w-12 mx-auto mb-3 opacity-30" />
                    <p>Žiadne položky v tejto kategórii</p>
                  </div>
                )}
              </TabsContent>
            ))}
          </div>
        </Tabs>
      )}

      {/* Item Configurator Dialog */}
      {configItem && (
        <ItemConfigurator
          item={configItem}
          open={configOpen}
          onOpenChange={setConfigOpen}
        />
      )}

      {/* Cart Sheet */}
      <CartSheet
        open={cartOpen}
        onOpenChange={setCartOpen}
        onCheckout={() => {
          setCartOpen(false)
          setCheckoutOpen(true)
        }}
      />

      {/* Checkout Sheet */}
      <CheckoutSheet
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        onOrderCreated={(orderId) => {
          setCheckoutOpen(false)
          setTrackingOrderId(orderId)
        }}
      />
    </div>
  )
}

// ─── Menu Card ───
function MenuCard({ item, categorySlug, onAdd }: { item: MenuItem; categorySlug: string; onAdd: () => void }) {
  const imgSrc = categorySlug === 'pizza' ? '/pizza-hero.png' : '/pizza-lizard.png'

  return (
    <Card className="group overflow-hidden transition-all hover:shadow-lg cursor-pointer border-border/60" onClick={onAdd}>
      <div
        className="h-36 flex items-center justify-center relative overflow-hidden"
        style={{ backgroundColor: '#fff4df' }}
      >
        <img
          src={imgSrc}
          alt={item.name}
          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
        />
        {item.isFeatured && (
          <Badge className="absolute top-2 right-2 text-xs" style={{ backgroundColor: '#c73325', color: 'white' }}>
            Akcia
          </Badge>
        )}
      </div>
      <CardContent className="p-4">
        <h3 className="font-semibold text-base mb-1">{item.name}</h3>
        {item.description && (
          <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{item.description}</p>
        )}
        <div className="flex items-center justify-between">
          <span className="text-lg font-bold" style={{ color: '#4f7f2a' }}>
            od {formatPrice(item.basePrice)}
          </span>
          <Button
            size="sm"
            className="gap-1"
            style={{ backgroundColor: '#4f7f2a', color: 'white' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#3d6620')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#4f7f2a')}
          >
            <Plus className="h-4 w-4" />
            Pridať
          </Button>
        </div>
        {item.preparationTimeMinutes && item.preparationTimeMinutes > 0 && (
          <div className="flex items-center gap-1 mt-2 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {item.preparationTimeMinutes} min
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ─── Item Configurator ───
function ItemConfigurator({
  item,
  open,
  onOpenChange,
}: {
  item: MenuItem
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const cartStore = useCartStore()
  const sizeOptions = item.options.filter(o => o.optionType === 'SIZE' && o.isActive)
  const defaultSize = sizeOptions.find(o => o.isDefault) || sizeOptions[0] || null
  const [selectedSize, setSelectedSize] = useState<MenuItemOption | null>(defaultSize)
  const [selectedExtras, setSelectedExtras] = useState<MenuItemOption[]>([])
  const [selectedRemoves, setSelectedRemoves] = useState<MenuItemOption[]>([])
  const [kitchenNote, setKitchenNote] = useState('')
  const [quantity, setQuantity] = useState(1)

  const extraOptions = item.options.filter(o => o.optionType === 'EXTRA' && o.isActive)
  const removeOptions = item.options.filter(o => o.optionType === 'REMOVE' && o.isActive)

  const unitTotal = item.basePrice
    + (selectedSize?.priceDelta || 0)
    + selectedExtras.reduce((sum, e) => sum + e.priceDelta, 0)

  const totalPrice = unitTotal * quantity

  const handleAdd = () => {
    cartStore.addItem(item, selectedSize, selectedExtras, selectedRemoves, kitchenNote, quantity)
    toast.success(`${item.name} pridané do košíka`)
    onOpenChange(false)
  }

  const toggleExtra = (option: MenuItemOption) => {
    setSelectedExtras(prev =>
      prev.find(o => o.id === option.id)
        ? prev.filter(o => o.id !== option.id)
        : [...prev, option]
    )
  }

  const toggleRemove = (option: MenuItemOption) => {
    setSelectedRemoves(prev =>
      prev.find(o => o.id === option.id)
        ? prev.filter(o => o.id !== option.id)
        : [...prev, option]
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl" style={{ color: '#4f7f2a' }}>{item.name}</DialogTitle>
          <DialogDescription>{item.description || 'Nastavte si položku podľa chuti'}</DialogDescription>
        </DialogHeader>

        <div className="space-y-6 mt-2">
          {/* Size selection */}
          {sizeOptions.length > 0 && (
            <div>
              <Label className="text-base font-semibold mb-3 block">Veľkosť</Label>
              <RadioGroup
                value={selectedSize?.id || ''}
                onValueChange={(val) => {
                  const opt = sizeOptions.find(o => o.id === val)
                  if (opt) setSelectedSize(opt)
                }}
              >
                {sizeOptions.map((opt) => (
                  <div
                    key={opt.id}
                    className="flex items-center space-x-2 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    style={{
                      borderColor: selectedSize?.id === opt.id ? '#4f7f2a' : undefined,
                      backgroundColor: selectedSize?.id === opt.id ? '#f0f7ec' : undefined,
                    }}
                    onClick={() => setSelectedSize(opt)}
                  >
                    <RadioGroupItem value={opt.id} style={{ color: '#4f7f2a' }} />
                    <Label className="flex-1 cursor-pointer font-normal">{opt.name}</Label>
                    {opt.priceDelta > 0 && (
                      <span className="text-sm font-medium" style={{ color: '#4f7f2a' }}>
                        +{formatPrice(opt.priceDelta)}
                      </span>
                    )}
                    {opt.priceDelta === 0 && (
                      <span className="text-sm text-muted-foreground">základná</span>
                    )}
                  </div>
                ))}
              </RadioGroup>
            </div>
          )}

          {/* Extra ingredients */}
          {extraOptions.length > 0 && (
            <div>
              <Label className="text-base font-semibold mb-3 block">Extra suroviny</Label>
              <div className="space-y-2">
                {extraOptions.map((opt) => (
                  <div
                    key={opt.id}
                    className="flex items-center space-x-2 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    style={{
                      borderColor: selectedExtras.find(o => o.id === opt.id) ? '#4f7f2a' : undefined,
                      backgroundColor: selectedExtras.find(o => o.id === opt.id) ? '#f0f7ec' : undefined,
                    }}
                    onClick={() => toggleExtra(opt)}
                  >
                    <Checkbox
                      checked={!!selectedExtras.find(o => o.id === opt.id)}
                      onCheckedChange={() => toggleExtra(opt)}
                      style={{ color: '#4f7f2a' }}
                    />
                    <Label className="flex-1 cursor-pointer font-normal">{opt.name}</Label>
                    <span className="text-sm font-medium" style={{ color: '#4f7f2a' }}>
                      +{formatPrice(opt.priceDelta)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Remove ingredients */}
          {removeOptions.length > 0 && (
            <div>
              <Label className="text-base font-semibold mb-3 block">Bez suroviny</Label>
              <div className="space-y-2">
                {removeOptions.map((opt) => (
                  <div
                    key={opt.id}
                    className="flex items-center space-x-2 rounded-lg border p-3 cursor-pointer hover:bg-muted/50 transition-colors"
                    style={{
                      borderColor: selectedRemoves.find(o => o.id === opt.id) ? '#c73325' : undefined,
                      backgroundColor: selectedRemoves.find(o => o.id === opt.id) ? '#fef2f0' : undefined,
                    }}
                    onClick={() => toggleRemove(opt)}
                  >
                    <Checkbox
                      checked={!!selectedRemoves.find(o => o.id === opt.id)}
                      onCheckedChange={() => toggleRemove(opt)}
                    />
                    <Label className="flex-1 cursor-pointer font-normal">{opt.name}</Label>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Kitchen note */}
          <div>
            <Label className="text-base font-semibold mb-2 block">Poznámka pre kuchyňu</Label>
            <Textarea
              placeholder="Špeciálne požiadavky, alergie..."
              value={kitchenNote}
              onChange={(e) => setKitchenNote(e.target.value)}
              className="resize-none"
              rows={2}
            />
          </div>

          {/* Quantity */}
          <div>
            <Label className="text-base font-semibold mb-2 block">Množstvo</Label>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                onClick={() => setQuantity(Math.max(1, quantity - 1))}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="text-xl font-bold w-12 text-center">{quantity}</span>
              <Button
                variant="outline"
                size="icon"
                onClick={() => setQuantity(quantity + 1)}
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <Separator />

          {/* Total and add button */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-muted-foreground">Celková cena</p>
              <p className="text-2xl font-bold" style={{ color: '#4f7f2a' }}>
                {formatPrice(totalPrice)}
              </p>
            </div>
            <Button
              size="lg"
              className="gap-2 text-base px-6"
              style={{ backgroundColor: '#4f7f2a', color: 'white' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#3d6620')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#4f7f2a')}
              onClick={handleAdd}
            >
              <ShoppingCart className="h-5 w-5" />
              Pridať do košíka
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

// ─── Cart Sheet ───
function CartSheet({
  open,
  onOpenChange,
  onCheckout,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCheckout: () => void
}) {
  const cartStore = useCartStore()
  const { data: zones } = useQuery<DeliveryZone[]>({
    queryKey: ['zones'],
    queryFn: () => fetch('/api/zones').then(r => r.json()),
  })

  const subtotal = cartStore.getSubtotal()
  // Don't show first zone's fee as actual delivery — it's calculated after zone selection
  const total = subtotal // delivery fee is shown in checkout after zone selection

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <ShoppingCart className="h-5 w-5" style={{ color: '#4f7f2a' }} />
            Košík ({cartStore.getItemCount()} položiek)
          </SheetTitle>
          <SheetDescription>Vaše vybrané položky</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4 custom-scrollbar">
          {cartStore.items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <ShoppingCart className="h-12 w-12 mx-auto mb-3 opacity-30" />
              <p>Váš košík je prázdny</p>
              <p className="text-sm mt-1">Pridajte položky z menu</p>
            </div>
          ) : (
            <div className="space-y-3">
              {cartStore.items.map((ci, index) => (
                <Card key={index} className="p-3">
                  <div className="flex justify-between items-start">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-sm">{ci.menuItem.name}</p>
                      <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                        {ci.selectedSize && <p>Veľkosť: {ci.selectedSize.name}</p>}
                        {ci.selectedExtras.length > 0 && (
                          <p>+ {ci.selectedExtras.map(e => e.name).join(', ')}</p>
                        )}
                        {ci.selectedRemoves.length > 0 && (
                          <p className="text-red-600">- {ci.selectedRemoves.map(r => r.name).join(', ')}</p>
                        )}
                        {ci.kitchenNote && <p>Poznámka: {ci.kitchenNote}</p>}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-red-500"
                      onClick={() => cartStore.removeItem(index)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="flex items-center justify-between mt-2">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => cartStore.updateQuantity(index, ci.quantity - 1)}
                      >
                        <Minus className="h-3 w-3" />
                      </Button>
                      <span className="text-sm font-medium w-6 text-center">{ci.quantity}</span>
                      <Button
                        variant="outline"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => cartStore.updateQuantity(index, ci.quantity + 1)}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                    <span className="font-semibold text-sm" style={{ color: '#4f7f2a' }}>
                      {formatPrice(ci.lineTotal)}
                    </span>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>

        {cartStore.items.length > 0 && (
          <div className="border-t pt-4 space-y-3">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Medzisúčet</span>
              <span>{formatPrice(subtotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Dopravné</span>
              <span className="text-muted-foreground">Dopravné sa vypočíta podľa zóny</span>
            </div>
            <Separator />
            <div className="flex justify-between font-bold text-lg">
              <span>Celkom</span>
              <span style={{ color: '#4f7f2a' }}>{formatPrice(total)}</span>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => cartStore.clearCart()}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Vyčistiť
              </Button>
              <Button
                className="flex-1"
                style={{ backgroundColor: '#4f7f2a', color: 'white' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = '#3d6620')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = '#4f7f2a')}
                onClick={onCheckout}
              >
                Pokračovať
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  )
}

// ─── Checkout Sheet ───
function CheckoutSheet({
  open,
  onOpenChange,
  onOrderCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOrderCreated: (orderId: string) => void
}) {
  const cartStore = useCartStore()
  const queryClient = useQueryClient()

  const [customerName, setCustomerName] = useState('')
  const [customerPhone, setCustomerPhone] = useState('')
  const [customerEmail, setCustomerEmail] = useState('')
  const [orderType, setOrderType] = useState<'DELIVERY' | 'PICKUP'>('DELIVERY')
  const [paymentMethod, setPaymentMethod] = useState<'CASH' | 'CARD_ON_DELIVERY' | 'CARD_ON_PICKUP'>('CASH')
  const [deliveryZoneId, setDeliveryZoneId] = useState('')
  const [deliveryAddress, setDeliveryAddress] = useState('')
  const [deliveryCity, setDeliveryCity] = useState('')
  const [deliveryNote, setDeliveryNote] = useState('')
  const [kitchenNote, setKitchenNote] = useState('')

  const { data: zones } = useQuery<DeliveryZone[]>({
    queryKey: ['zones'],
    queryFn: () => fetch('/api/zones').then(r => r.json()),
  })

  const selectedZone = zones?.find(z => z.id === deliveryZoneId)
  const subtotal = cartStore.getSubtotal()
  const deliveryFee = orderType === 'DELIVERY' ? (selectedZone?.deliveryFee || 0) : 0
  const total = subtotal + deliveryFee
  const meetsMinimum = orderType === 'PICKUP' || !selectedZone || subtotal >= (selectedZone?.minimumOrderAmount || 0)
  const belowMinimumBy = selectedZone ? selectedZone.minimumOrderAmount - subtotal : 0

  const createOrderMutation = useMutation({
    mutationFn: async () => {
      const items = cartStore.items.map(ci => ({
        menuItemId: ci.menuItem.id,
        quantity: ci.quantity,
        selectedSize: ci.selectedSize?.name || null,
        selectedOptions: [
          ...ci.selectedExtras.map(e => e.name),
          ...ci.selectedRemoves.map(r => r.name),
        ],
        kitchenNote: ci.kitchenNote || null,
      }))

      const res = await fetch('/api/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerName,
          customerPhone,
          customerEmail: customerEmail || undefined,
          orderType,
          paymentMethod: orderType === 'PICKUP' && paymentMethod === 'CARD_ON_DELIVERY' ? 'CARD_ON_PICKUP' : paymentMethod,
          deliveryZoneId: orderType === 'DELIVERY' ? deliveryZoneId : undefined,
          deliveryAddressLine1: orderType === 'DELIVERY' ? deliveryAddress : undefined,
          deliveryCity: orderType === 'DELIVERY' ? deliveryCity : undefined,
          deliveryNote: orderType === 'DELIVERY' ? deliveryNote : undefined,
          kitchenNote: kitchenNote || undefined,
          items,
          // NOTE: subtotalAmount, deliveryFee, totalAmount are NOT sent —
          // server computes all prices from menu items + zone
        }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Chyba pri vytváraní objednávky')
      }
      return res.json()
    },
    onSuccess: (order) => {
      toast.success('Objednávka bola vytvorená!')
      cartStore.clearCart()
      queryClient.invalidateQueries({ queryKey: ['orders'] })
      onOrderCreated(order.id)
    },
    onError: (error) => {
      toast.error(error.message || 'Chyba pri vytváraní objednávky')
    },
  })

  const canSubmit = customerName.trim() && customerPhone.trim() && cartStore.items.length > 0
    && (orderType === 'PICKUP' || (deliveryZoneId && deliveryAddress.trim()))
    && meetsMinimum

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-lg flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" style={{ color: '#4f7f2a' }} />
            Dokončenie objednávky
          </SheetTitle>
          <SheetDescription>Vyplňte údaje a odošlite objednávku</SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto py-4 space-y-5 custom-scrollbar">
          {/* Customer info */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <User className="h-4 w-4" style={{ color: '#4f7f2a' }} />
              Kontaktné údaje
            </h3>
            <div className="space-y-2">
              <div>
                <Label htmlFor="name">Meno a priezvisko *</Label>
                <Input
                  id="name"
                  placeholder="Ján Novák"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="phone">Telefón *</Label>
                <Input
                  id="phone"
                  placeholder="+421 900 123 456"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="email">E-mail</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="jan@email.sk"
                  value={customerEmail}
                  onChange={(e) => setCustomerEmail(e.target.value)}
                />
              </div>
            </div>
          </div>

          <Separator />

          {/* Order type */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Truck className="h-4 w-4" style={{ color: '#4f7f2a' }} />
              Spôsob prevzatia
            </h3>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant={orderType === 'DELIVERY' ? 'default' : 'outline'}
                className={orderType === 'DELIVERY' ? 'text-white' : ''}
                style={orderType === 'DELIVERY' ? { backgroundColor: '#4f7f2a' } : {}}
                onClick={() => setOrderType('DELIVERY')}
              >
                <Truck className="h-4 w-4 mr-2" />
                Rozvoz
              </Button>
              <Button
                variant={orderType === 'PICKUP' ? 'default' : 'outline'}
                className={orderType === 'PICKUP' ? 'text-white' : ''}
                style={orderType === 'PICKUP' ? { backgroundColor: '#4f7f2a' } : {}}
                onClick={() => setOrderType('PICKUP')}
              >
                <Package className="h-4 w-4 mr-2" />
                Osobný odber
              </Button>
            </div>
          </div>

          {/* Delivery address */}
          {orderType === 'DELIVERY' && (
            <div className="space-y-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <MapPin className="h-4 w-4" style={{ color: '#4f7f2a' }} />
                Adresa doručenia
              </h3>
              <div className="space-y-2">
                <div>
                  <Label>Zóna doručenia *</Label>
                  <Select value={deliveryZoneId} onValueChange={setDeliveryZoneId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Vyberte zónu" />
                    </SelectTrigger>
                    <SelectContent>
                      {zones?.filter(z => z.isActive).map((zone) => (
                        <SelectItem key={zone.id} value={zone.id}>
                          {zone.name} ({formatPrice(zone.deliveryFee)} - {zone.estimatedDeliveryMinutes} min)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {selectedZone && (
                  <div className="rounded-lg p-3 text-sm space-y-1" style={{ backgroundColor: '#fff4df' }}>
                    <div className="flex justify-between">
                      <span>Dopravné:</span>
                      <span className="font-medium">{formatPrice(selectedZone.deliveryFee)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Min. objednávka:</span>
                      <span className="font-medium">{formatPrice(selectedZone.minimumOrderAmount)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Očakávaný čas:</span>
                      <span className="font-medium">~{selectedZone.estimatedDeliveryMinutes} min</span>
                    </div>
                  </div>
                )}
                {selectedZone && !meetsMinimum && (
                  <div className="rounded-lg p-3 text-sm bg-red-50 text-red-700 border border-red-200">
                    <span className="font-medium">Minimálna objednávka pre túto zónu je {formatPrice(selectedZone.minimumOrderAmount)}.</span>{' '}
                    Pridajte ešte tovar za {formatPrice(belowMinimumBy)}.
                  </div>
                )}
                <div>
                  <Label htmlFor="address">Ulica a číslo *</Label>
                  <Input
                    id="address"
                    placeholder="Hlavná 12"
                    value={deliveryAddress}
                    onChange={(e) => setDeliveryAddress(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="city">Mesto</Label>
                  <Input
                    id="city"
                    placeholder="Hlohovec"
                    value={deliveryCity}
                    onChange={(e) => setDeliveryCity(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="deliveryNote">Poznámka pre kuriéra</Label>
                  <Input
                    id="deliveryNote"
                    placeholder="Zvoňte, 3. poschodie..."
                    value={deliveryNote}
                    onChange={(e) => setDeliveryNote(e.target.value)}
                  />
                </div>
              </div>
            </div>
          )}

          <Separator />

          {/* Payment */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <CreditCard className="h-4 w-4" style={{ color: '#4f7f2a' }} />
              Platba
            </h3>
            <div className="space-y-2">
              <Button
                variant={paymentMethod === 'CASH' ? 'default' : 'outline'}
                className={`w-full justify-start ${paymentMethod === 'CASH' ? 'text-white' : ''}`}
                style={paymentMethod === 'CASH' ? { backgroundColor: '#4f7f2a' } : {}}
                onClick={() => setPaymentMethod('CASH')}
              >
                💵 Hotovosť
              </Button>
              {orderType === 'DELIVERY' && (
                <Button
                  variant={paymentMethod === 'CARD_ON_DELIVERY' ? 'default' : 'outline'}
                  className={`w-full justify-start ${paymentMethod === 'CARD_ON_DELIVERY' ? 'text-white' : ''}`}
                  style={paymentMethod === 'CARD_ON_DELIVERY' ? { backgroundColor: '#4f7f2a' } : {}}
                  onClick={() => setPaymentMethod('CARD_ON_DELIVERY')}
                >
                  💳 Kartou pri doručení
                </Button>
              )}
              {orderType === 'PICKUP' && (
                <Button
                  variant={paymentMethod === 'CARD_ON_PICKUP' ? 'default' : 'outline'}
                  className={`w-full justify-start ${paymentMethod === 'CARD_ON_PICKUP' ? 'text-white' : ''}`}
                  style={paymentMethod === 'CARD_ON_PICKUP' ? { backgroundColor: '#4f7f2a' } : {}}
                  onClick={() => setPaymentMethod('CARD_ON_PICKUP')}
                >
                  💳 Kartou pri odbere
                </Button>
              )}
            </div>
          </div>

          <Separator />

          {/* Kitchen note */}
          <div>
            <Label className="text-sm font-semibold flex items-center gap-2 mb-2">
              <MessageSquare className="h-4 w-4" style={{ color: '#4f7f2a' }} />
              Poznámka k objednávke
            </Label>
            <Textarea
              placeholder="Špeciálne požiadavky..."
              value={kitchenNote}
              onChange={(e) => setKitchenNote(e.target.value)}
              rows={2}
            />
          </div>

          <Separator />

          {/* Summary */}
          <div className="space-y-2">
            <h3 className="font-semibold text-sm">Zhrnutie objednávky</h3>
            {cartStore.items.map((ci, i) => (
              <div key={i} className="flex justify-between text-sm">
                <span className="text-muted-foreground">
                  {ci.quantity}x {ci.menuItem.name}
                  {ci.selectedSize ? ` (${ci.selectedSize.name})` : ''}
                </span>
                <span>{formatPrice(ci.lineTotal)}</span>
              </div>
            ))}
            <Separator />
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Medzisúčet</span>
              <span>{formatPrice(subtotal)}</span>
            </div>
            {orderType === 'DELIVERY' && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Dopravné</span>
                <span>{formatPrice(deliveryFee)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-lg">
              <span>Celkom</span>
              <span style={{ color: '#4f7f2a' }}>{formatPrice(total)}</span>
            </div>
          </div>
        </div>

        <div className="border-t pt-4">
          <Button
            className="w-full text-base py-6"
            disabled={!canSubmit || createOrderMutation.isPending}
            style={{ backgroundColor: canSubmit ? '#4f7f2a' : undefined, color: canSubmit ? 'white' : undefined }}
            onMouseEnter={(e) => canSubmit && (e.currentTarget.style.backgroundColor = '#3d6620')}
            onMouseLeave={(e) => canSubmit && (e.currentTarget.style.backgroundColor = '#4f7f2a')}
            onClick={() => createOrderMutation.mutate()}
          >
            {createOrderMutation.isPending ? 'Odosielam...' : 'Odoslať objednávku'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}

// ─── Order Tracking ───
function OrderTracking({ orderId, onBack }: { orderId: string; onBack: () => void }) {
  const { data: order, isLoading } = useQuery<Order>({
    queryKey: ['order', orderId],
    queryFn: () => fetch(`/api/orders/${orderId}`).then(r => r.json()),
    refetchInterval: 5000,
  })

  const statusSteps: OrderStatus[] = [
    'NEW', 'ACCEPTED', 'IN_KITCHEN', 'PREPARING', 'READY',
    ...(order?.orderType === 'DELIVERY' ? (['WAITING_FOR_COURIER', 'ASSIGNED_TO_COURIER', 'PICKED_UP', 'ON_THE_WAY'] as OrderStatus[]) : []),
    'DELIVERED',
  ]

  const currentStepIndex = order ? statusSteps.indexOf(order.status) : -1
  const deliveryCourier = order?.assignments?.[0]?.courier

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 p-4 border-b">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h2 className="text-lg font-bold" style={{ color: '#4f7f2a' }}>
            Objednávka {order?.orderNumber || '...'}
          </h2>
          <p className="text-sm text-muted-foreground">Sledovanie stavu</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6 custom-scrollbar">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-48 rounded-xl" />
          </div>
        ) : order ? (
          <>
            {/* Status badge */}
            <div className="text-center">
              <Badge className={`text-base px-4 py-2 ${getStatusColor(order.status)}`}>
                {ORDER_STATUS_LABELS[order.status]}
              </Badge>
            </div>

            {/* ETA display */}
            {(order as any).estimatedReadyAt && order.status !== 'CANCELLED' && order.status !== 'REFUNDED' && (
              <Card className="p-4" style={{ backgroundColor: '#f0f7ec' }}>
                <div className="text-center space-y-1">
                  <p className="text-sm text-muted-foreground">Predpokladané pripravenie</p>
                  <p className="text-2xl font-bold" style={{ color: '#4f7f2a' }}>
                    {new Date((order as any).estimatedReadyAt).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' })}
                  </p>
                  {order.orderType === 'DELIVERY' && (order as any).estimatedDeliveryFrom && (order as any).estimatedDeliveryTo && (
                    <>
                      <Separator className="my-2" />
                      <p className="text-sm text-muted-foreground">Predpokladané doručenie</p>
                      <p className="text-xl font-bold" style={{ color: '#4f7f2a' }}>
                        {new Date((order as any).estimatedDeliveryFrom!).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' })}
                        {' – '}
                        {new Date((order as any).estimatedDeliveryTo!).toLocaleTimeString('sk-SK', { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </>
                  )}
                  {(order as any).publicDelayReason && (
                    <p className="text-xs text-amber-600 mt-2">
                      Dôvod meškania: {getDelayLabel((order as any).publicDelayReason)}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground mt-2">
                    Časy sú orientačné a môžu sa mierne zmeniť.
                  </p>
                </div>
              </Card>
            )}

            {!((order as any).estimatedReadyAt) && order.status === 'NEW' && (
              <Card className="p-4 text-center" style={{ backgroundColor: '#fff4df' }}>
                <Clock className="h-8 w-8 mx-auto mb-2 text-amber-500" />
                <p className="text-sm text-muted-foreground">Objednávka bola prijatá.</p>
                <p className="text-sm font-medium">Čakáme na potvrdenie času kuchyňou.</p>
              </Card>
            )}

            {deliveryCourier && (
              <Card className="p-4">
                <div className="flex items-center gap-3">
                  <div className="h-12 w-12 rounded-full flex items-center justify-center overflow-hidden" style={{ backgroundColor: '#f0f7ec' }}>
                    {deliveryCourier.profilePhotoUrl ? (
                      <img
                        src={deliveryCourier.profilePhotoUrl}
                        alt={deliveryCourier.displayName}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Truck className="h-6 w-6" style={{ color: '#4f7f2a' }} />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">Objednávku vezie</p>
                    <h3 className="font-semibold truncate">{deliveryCourier.displayName}</h3>
                    <p className="text-sm text-muted-foreground">
                      {VEHICLE_TYPE_LABELS[deliveryCourier.vehicleType] || deliveryCourier.vehicleType}
                      {deliveryCourier.vehicleType === 'CAR' && deliveryCourier.licensePlate
                        ? ` • SPZ ${deliveryCourier.licensePlate}`
                        : ''}
                    </p>
                  </div>
                </div>
              </Card>
            )}

            {/* Status stepper */}
            <div className="space-y-2">
              {statusSteps.map((step, i) => {
                const isCompleted = i <= currentStepIndex
                const isCurrent = i === currentStepIndex
                const isCancelled = order.status === 'CANCELLED' || order.status === 'REFUNDED'

                return (
                  <div
                    key={step}
                    className={`flex items-center gap-3 p-3 rounded-lg transition-all ${
                      isCurrent ? '' : ''
                    }`}
                    style={{
                      backgroundColor: isCompleted ? (isCancelled && isCurrent ? '#fef2f0' : '#f0f7ec') : '#f9f9f9',
                      ...(isCurrent ? { boxShadow: '0 0 0 2px #4f7f2a' } : {}),
                    }}
                  >
                    <div
                      className="h-8 w-8 rounded-full flex items-center justify-center flex-shrink-0"
                      style={{
                        backgroundColor: isCompleted ? (isCancelled && isCurrent ? '#c73325' : '#4f7f2a') : '#e5e5e5',
                        color: isCompleted ? 'white' : '#999',
                      }}
                    >
                      {isCompleted ? <Check className="h-4 w-4" /> : <span className="text-xs">{i + 1}</span>}
                    </div>
                    <span className={`text-sm font-medium ${isCompleted ? '' : 'text-muted-foreground'}`}>
                      {ORDER_STATUS_LABELS[step]}
                    </span>
                  </div>
                )
              })}
            </div>

            {/* Order details */}
            <Card className="p-4">
              <h3 className="font-semibold mb-3">Detail objednávky</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Číslo:</span>
                  <span className="font-medium">{order.orderNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Typ:</span>
                  <span>{order.orderType === 'DELIVERY' ? 'Rozvoz' : 'Osobný odber'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Platba:</span>
                  <span>
                    {order.paymentMethod === 'CASH' ? 'Hotovosť'
                      : order.paymentMethod === 'CARD_ON_DELIVERY' ? 'Karta pri doručení'
                      : 'Karta pri odbere'}
                  </span>
                </div>
                <Separator />
                {order.items.map((item) => (
                  <div key={item.id} className="flex justify-between">
                    <span className="text-muted-foreground">
                      {item.quantity}x {item.menuItemNameSnapshot}
                    </span>
                    <span>{formatPrice(item.lineTotal)}</span>
                  </div>
                ))}
                <Separator />
                <div className="flex justify-between font-bold">
                  <span>Celkom</span>
                  <span style={{ color: '#4f7f2a' }}>{formatPrice(order.totalAmount)}</span>
                </div>
              </div>
            </Card>
          </>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <p>Objednávka nenájdená</p>
          </div>
        )}
      </div>
    </div>
  )
}

function getDelayLabel(reason: string): string {
  const labels: Record<string, string> = {
    HIGH_DEMAND: 'zvýšený počet objednávok',
    COMPLEX_ORDER: 'náročnejšia príprava objednávky',
    INGREDIENT_DELAY: 'krátke zdržanie pri príprave',
    COURIER_DELAY: 'čakanie na kuriéra',
    TRAFFIC: 'aktuálna dopravná situácia',
    OTHER: 'neočakávané zdržanie',
  }
  return labels[reason] || reason
}

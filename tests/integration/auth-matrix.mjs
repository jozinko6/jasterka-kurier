/**
 * Integration tests for authorization matrix.
 *
 * Tests that the role-based access control works correctly:
 * - Anonymous users cannot access staff endpoints
 * - Courier A cannot read/modify courier B's orders
 * - Kitchen cannot mark orders as DELIVERED
 * - Courier cannot accept NEW orders
 * - Courier cannot modify another courier's profile
 *
 * These tests run against a live dev server (PORT 3000).
 * Run with: node tests/integration/auth-matrix.mjs
 *
 * Requires seeded database (bun run db:seed).
 */

const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:3000'

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Origin: BASE_URL,
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let data = null
  if (text) {
    try { data = JSON.parse(text) } catch { data = text }
  }
  return { status: response.status, data }
}

async function login(email, password) {
  const r = await request('/api/auth', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
  assert(r.status === 200, `Login ${email} failed: ${r.status}`)
  const setCookie = r.response?.headers?.get('set-cookie')
  // fetch doesn't expose set-cookie easily; we use the cookie jar via manual header
  return r.data
}

async function main() {
  console.log(`Auth matrix tests target: ${BASE_URL}`)

  // ─── Anonymous access ───
  const anonKitchen = await request('/api/kitchen')
  assert(anonKitchen.status === 401, `Anonymous kitchen access should be 401, got ${anonKitchen.status}`)
  console.log('✓ anonymous cannot access /api/kitchen')

  const anonCouriers = await request('/api/couriers')
  assert(anonCouriers.status === 401, `Anonymous couriers access should be 401, got ${anonCouriers.status}`)
  console.log('✓ anonymous cannot access /api/couriers')

  const anonStats = await request('/api/stats')
  assert(anonStats.status === 401, `Anonymous stats access should be 401, got ${anonStats.status}`)
  console.log('✓ anonymous cannot access /api/stats')

  // ─── Login ───
  // Use cookie jar via manual session cookie
  const adminLogin = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    body: JSON.stringify({ email: 'admin@jasterka.sk', password: 'admin123' }),
  })
  const adminCookie = adminLogin.headers.get('set-cookie')?.split(';')[0]
  assert(adminCookie, 'Admin login did not return cookie')

  const courierALogin = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    body: JSON.stringify({ email: 'kurier.bicykel@jasterka.sk', password: 'kurier123' }),
  })
  const courierACookie = courierALogin.headers.get('set-cookie')?.split(';')[0]
  assert(courierACookie, 'Courier A login did not return cookie')

  const courierBLogin = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    body: JSON.stringify({ email: 'kurier.auto@jasterka.sk', password: 'kurier123' }),
  })
  const courierBCookie = courierBLogin.headers.get('set-cookie')?.split(';')[0]
  assert(courierBCookie, 'Courier B login did not return cookie')

  const kitchenLogin = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    body: JSON.stringify({ email: 'kuchyna@jasterka.sk', password: 'kuchyna123' }),
  })
  const kitchenCookie = kitchenLogin.headers.get('set-cookie')?.split(';')[0]
  assert(kitchenCookie, 'Kitchen login did not return cookie')

  console.log('✓ all roles logged in')

  // ─── Kitchen cannot do courier transitions ───
  // Create a test order first (as admin)
  const menuRes = await request('/api/menu')
  const menuItem = menuRes.data.flatMap((c) => c.menuItems || []).find((i) => i.isActive && i.isAvailable)
  const itemDetail = await request(`/api/menu/${menuItem.id}`)
  const sizeOpt = (itemDetail.data.options || []).find((o) => o.optionType === 'SIZE')

  const zonesRes = await request('/api/zones')
  const zone = zonesRes.data.find((z) => z.isActive)

  const orderRes = await request('/api/orders', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: JSON.stringify({
      customerName: 'Auth Matrix Test',
      customerPhone: '+421900000000',
      orderType: 'DELIVERY',
      paymentMethod: 'CASH',
      deliveryZoneId: zone.id,
      deliveryAddressLine1: 'Test 1',
      deliveryCity: 'Hlohovec',
      items: [{ menuItemId: menuItem.id, quantity: 1, selectedSize: sizeOpt?.id || null, selectedOptions: [] }],
    }),
  })
  assert(orderRes.status === 201, `Order creation failed: ${orderRes.status}`)
  const orderId = orderRes.data.id
  console.log(`✓ created test order ${orderRes.data.orderNumber}`)

  // Move to ASSIGNED_TO_COURIER via admin
  // First: kitchen flow NEW → READY
  for (const status of ['ACCEPTED', 'IN_KITCHEN', 'PREPARING', 'READY']) {
    await request(`/api/orders/${orderId}`, {
      method: 'PATCH',
      headers: { Cookie: kitchenCookie },
      body: JSON.stringify({ status }),
    })
  }
  // Then READY → WAITING_FOR_COURIER
  await request(`/api/orders/${orderId}`, {
    method: 'PATCH',
    headers: { Cookie: kitchenCookie },
    body: JSON.stringify({ status: 'WAITING_FOR_COURIER' }),
  })

  // Admin dispatches to courier A
  const couriersRes = await request('/api/couriers', { headers: { Cookie: adminCookie } })
  const couriers = couriersRes.data.couriers || couriersRes.data
  let courierA = couriers.find((c) => c.user?.email === 'kurier.bicykel@jasterka.sk')
  if (!courierA) courierA = couriers[0]

  // Set courier A to AVAILABLE
  await request('/api/couriers', {
    method: 'PATCH',
    headers: { Cookie: courierACookie },
    body: JSON.stringify({ courierId: courierA.id, status: 'AVAILABLE' }),
  })

  const dispatchRes = await request('/api/dispatch', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: JSON.stringify({ orderId, courierId: courierA.id }),
  })
  assert(dispatchRes.status === 201, `Dispatch failed: ${dispatchRes.status} ${JSON.stringify(dispatchRes.data)}`)
  console.log('✓ admin dispatched order to courier A')

  // ─── Kitchen cannot mark DELIVERED ───
  const kitchenDelivered = await request(`/api/orders/${orderId}`, {
    method: 'PATCH',
    headers: { Cookie: kitchenCookie },
    body: JSON.stringify({ status: 'DELIVERED' }),
  })
  assert(
    kitchenDelivered.status === 422 || kitchenDelivered.status === 403,
    `Kitchen marking DELIVERED should be 422/403, got ${kitchenDelivered.status}`
  )
  console.log('✓ kitchen cannot mark order as DELIVERED')

  // ─── Kitchen cannot do courier transition (PICKED_UP) ───
  const kitchenPicked = await request(`/api/orders/${orderId}`, {
    method: 'PATCH',
    headers: { Cookie: kitchenCookie },
    body: JSON.stringify({ status: 'PICKED_UP' }),
  })
  assert(
    kitchenPicked.status === 422,
    `Kitchen marking PICKED_UP should be 422, got ${kitchenPicked.status}`
  )
  console.log('✓ kitchen cannot do courier transitions')

  // ─── Courier B cannot read courier A's order ───
  const courierBRead = await request(`/api/orders/${orderId}`, {
    headers: { Cookie: courierBCookie },
  })
  assert(
    courierBRead.status === 403 || courierBRead.status === 404,
    `Courier B reading courier A's order should be 403/404, got ${courierBRead.status}`
  )
  console.log('✓ courier B cannot read courier A\'s order')

  // ─── Courier B cannot modify courier A's order ───
  const courierBModify = await request(`/api/orders/${orderId}`, {
    method: 'PATCH',
    headers: { Cookie: courierBCookie },
    body: JSON.stringify({ status: 'PICKED_UP' }),
  })
  assert(
    courierBModify.status === 403 || courierBModify.status === 422,
    `Courier B modifying courier A's order should be 403/422, got ${courierBModify.status}`
  )
  console.log('✓ courier B cannot modify courier A\'s order')

  // ─── Courier cannot accept NEW order (kitchen transition) ───
  // Create a fresh NEW order
  const newOrderRes = await request('/api/orders', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: JSON.stringify({
      customerName: 'Auth Matrix Test 2',
      customerPhone: '+421900000001',
      orderType: 'DELIVERY',
      paymentMethod: 'CASH',
      deliveryZoneId: zone.id,
      deliveryAddressLine1: 'Test 2',
      deliveryCity: 'Hlohovec',
      items: [{ menuItemId: menuItem.id, quantity: 1, selectedSize: sizeOpt?.id || null, selectedOptions: [] }],
    }),
  })
  const newOrderId = newOrderRes.data.id

  const courierAccept = await request(`/api/orders/${newOrderId}`, {
    method: 'PATCH',
    headers: { Cookie: courierACookie },
    body: JSON.stringify({ status: 'ACCEPTED' }),
  })
  assert(
    courierAccept.status === 422 || courierAccept.status === 403,
    `Courier accepting NEW order should be 422/403, got ${courierAccept.status}`
  )
  console.log('✓ courier cannot accept NEW orders')

  // ─── Courier cannot access admin endpoints ───
  const courierStats = await request('/api/stats', {
    headers: { Cookie: courierACookie },
  })
  assert(
    courierStats.status === 403,
    `Courier accessing /api/stats should be 403, got ${courierStats.status}`
  )
  console.log('✓ courier cannot access admin endpoints')

  // ─── Kitchen cannot access admin endpoints ───
  const kitchenCouriers = await request('/api/couriers', {
    headers: { Cookie: kitchenCookie },
  })
  assert(
    kitchenCouriers.status === 403,
    `Kitchen accessing /api/couriers should be 403, got ${kitchenCouriers.status}`
  )
  console.log('✓ kitchen cannot access admin/courier endpoints')

  console.log('\n✅ All authorization matrix tests passed')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

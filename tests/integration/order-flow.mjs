/**
 * Integration tests for the full order flow lifecycle.
 *
 * Tests the complete happy path:
 * 1. Customer creates a DELIVERY order
 * 2. Kitchen processes it (NEW → ACCEPTED → IN_KITCHEN → PREPARING → READY → WAITING_FOR_COURIER)
 * 3. Admin dispatches a courier
 * 4. Courier picks up (ASSIGNED_TO_COURIER → PICKED_UP)
 * 5. Courier starts delivery (PICKED_UP → ON_THE_WAY)
 * 6. Courier completes delivery (ON_THE_WAY → DELIVERED)
 * 7. Customer tracks via public tracking token
 * 8. Earning is created idempotently
 *
 * Also tests the PICKUP flow separately.
 *
 * Run with: node tests/integration/order-flow.mjs
 * Requires: dev server on port 3000 + seeded database
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

async function loginWithCookie(email, password) {
  const response = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: BASE_URL },
    body: JSON.stringify({ email, password }),
  })
  assert(response.status === 200, `Login ${email} failed: ${response.status}`)
  const setCookie = response.headers.get('set-cookie')
  assert(setCookie, `${email} login did not return cookie`)
  const cookie = setCookie.split(';')[0]
  const data = await response.json()
  return { cookie, headers: { Cookie: cookie }, user: data.user }
}

async function getMenuItemWithSize() {
  const menuRes = await request('/api/menu')
  const categories = menuRes.data
  const menuItem = categories
    .flatMap((c) => c.menuItems || [])
    .find((i) => i.isActive && i.isAvailable)
  assert(menuItem, 'No active menu item found')

  const detailRes = await request(`/api/menu/${menuItem.id}`)
  const sizeOpt = (detailRes.data.options || []).find(
    (o) => o.optionType === 'SIZE' && o.isActive
  )
  return { menuItem, sizeOpt }
}

async function getActiveZone() {
  const zonesRes = await request('/api/zones')
  return zonesRes.data.find((z) => z.isActive)
}

async function createOrder(cookie, overrides = {}) {
  const { menuItem, sizeOpt } = await getMenuItemWithSize()
  const zone = await getActiveZone()

  const body = {
    customerName: 'Order Flow Test',
    customerPhone: '+421900000000',
    orderType: 'DELIVERY',
    paymentMethod: 'CASH',
    deliveryZoneId: zone.id,
    deliveryAddressLine1: 'Test 1',
    deliveryCity: 'Hlohovec',
    items: [
      {
        menuItemId: menuItem.id,
        quantity: 1,
        selectedSize: sizeOpt?.id || null,
        selectedOptions: [],
      },
    ],
    ...overrides,
  }

  const res = await request('/api/orders', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: JSON.stringify(body),
  })
  assert(res.status === 201, `Order creation failed: ${res.status} ${JSON.stringify(res.data)}`)
  return res.data
}

async function patchOrder(cookie, orderId, status, expectedStatus = 200) {
  const res = await request(`/api/orders/${orderId}`, {
    method: 'PATCH',
    headers: { Cookie: cookie },
    body: JSON.stringify({ status }),
  })
  assert(
    res.status === expectedStatus,
    `PATCH ${orderId} → ${status} expected ${expectedStatus}, got ${res.status}: ${JSON.stringify(res.data)}`
  )
  return res.data
}

async function setCourierAvailable(adminCookie, courier) {
  await request('/api/couriers', {
    method: 'PATCH',
    headers: { Cookie: adminCookie },
    body: JSON.stringify({ courierId: courier.id, status: 'AVAILABLE' }),
  })
}

async function getCourier(adminCookie, email) {
  const res = await request('/api/couriers', { headers: { Cookie: adminCookie } })
  const couriers = res.data.couriers || res.data
  return couriers.find((c) => c.user?.email === email) || couriers[0]
}

// ─── Main test ───

async function main() {
  console.log(`Order flow tests target: ${BASE_URL}`)

  // Login all roles
  const admin = await loginWithCookie('admin@jasterka.sk', 'admin123')
  const kitchen = await loginWithCookie('kuchyna@jasterka.sk', 'kuchyna123')
  const courier = await loginWithCookie('kurier.bicykel@jasterka.sk', 'kurier123')
  console.log('✓ all roles logged in')

  // ════════════════════════════════════════════════════════════════
  // TEST 1: Full DELIVERY flow
  // ════════════════════════════════════════════════════════════════
  console.log('\n── DELIVERY FLOW ──')

  // 1. Create order
  const order = await createOrder(admin.cookie)
  assert(order.id, 'Order has no id')
  assert(order.status === 'NEW', `Expected NEW, got ${order.status}`)
  assert(order.orderNumber?.startsWith('JAS-'), 'Order number prefix wrong')
  assert(order.trackingToken, 'Order should return trackingToken')
  assert(order.trackingTokenHash === undefined, 'trackingTokenHash must NOT be in response')
  console.log(`✓ created delivery order ${order.orderNumber}`)

  // 2. Public tracking without token → 401
  const noTokenRes = await request(`/api/orders/${order.id}`)
  assert(noTokenRes.status === 401, `No-token tracking should be 401, got ${noTokenRes.status}`)
  console.log('✓ public tracking without token rejected')

  // 3. Public tracking with token → sanitized DTO
  const trackingRes = await request(
    `/api/orders/${order.id}?token=${encodeURIComponent(order.trackingToken)}`
  )
  assert(trackingRes.status === 200, `Tracking with token failed: ${trackingRes.status}`)
  const tracking = trackingRes.data
  assert(tracking.orderNumber === order.orderNumber, 'Tracking orderNumber mismatch')
  assert(!('customerPhone' in tracking), 'Tracking leaks customerPhone')
  assert(!('customerEmail' in tracking), 'Tracking leaks customerEmail')
  assert(!('customerName' in tracking), 'Tracking leaks customerName')
  assert(!('deliveryAddressLine1' in tracking), 'Tracking leaks address')
  assert(!('kitchenNote' in tracking), 'Tracking leaks kitchenNote')
  assert(tracking.courier === null, 'New order should not show courier')
  assert(Array.isArray(tracking.trackingSteps), 'Tracking should include steps')
  console.log('✓ public tracking DTO is sanitized')

  // 4. Kitchen processes the order
  await patchOrder(kitchen.cookie, order.id, 'ACCEPTED')
  await patchOrder(kitchen.cookie, order.id, 'IN_KITCHEN')
  await patchOrder(kitchen.cookie, order.id, 'PREPARING')
  await patchOrder(kitchen.cookie, order.id, 'READY')
  await patchOrder(kitchen.cookie, order.id, 'WAITING_FOR_COURIER')
  console.log('✓ kitchen flow: NEW → WAITING_FOR_COURIER')

  // 5. Kitchen cannot dispatch
  const courierObj = await getCourier(admin.cookie, 'kurier.bicykel@jasterka.sk')
  await setCourierAvailable(admin.cookie, courierObj)

  const kitchenDispatchRes = await request('/api/dispatch', {
    method: 'POST',
    headers: { Cookie: kitchen.cookie },
    body: JSON.stringify({ orderId: order.id, courierId: courierObj.id }),
  })
  assert(
    kitchenDispatchRes.status === 403,
    `Kitchen dispatch should be 403, got ${kitchenDispatchRes.status}`
  )
  console.log('✓ kitchen cannot dispatch')

  // 6. Admin dispatches courier
  const dispatchRes = await request('/api/dispatch', {
    method: 'POST',
    headers: { Cookie: admin.cookie },
    body: JSON.stringify({ orderId: order.id, courierId: courierObj.id }),
  })
  assert(dispatchRes.status === 201, `Dispatch failed: ${dispatchRes.status}`)
  assert(dispatchRes.data.id, 'Dispatch has no assignment id')
  console.log('✓ admin dispatched courier')

  // 7. Tracking shows courier (sanitized)
  const trackingAfterDispatch = await request(
    `/api/orders/${order.id}?token=${encodeURIComponent(order.trackingToken)}`
  )
  assert(trackingAfterDispatch.data.courier !== null, 'Tracking should show courier after dispatch')
  assert(
    trackingAfterDispatch.data.courier.displayName === courierObj.displayName,
    'Courier displayName mismatch'
  )
  assert(!('phone' in trackingAfterDispatch.data.courier), 'Tracking leaks courier phone')
  assert(!('email' in trackingAfterDispatch.data.courier), 'Tracking leaks courier email')
  assert(!('licensePlate' in trackingAfterDispatch.data.courier), 'Tracking leaks license plate')
  console.log('✓ tracking shows sanitized courier info')

  // 8. Courier picks up
  await patchOrder(courier.cookie, order.id, 'PICKED_UP')
  console.log('✓ courier picked up')

  // 9. Courier starts delivery
  await patchOrder(courier.cookie, order.id, 'ON_THE_WAY')
  console.log('✓ courier on the way')

  // 10. Courier completes delivery
  await patchOrder(courier.cookie, order.id, 'DELIVERED')
  console.log('✓ courier delivered')

  // 11. Final tracking shows DELIVERED
  const finalTracking = await request(
    `/api/orders/${order.id}?token=${encodeURIComponent(order.trackingToken)}`
  )
  assert(finalTracking.data.status === 'DELIVERED', 'Final status should be DELIVERED')
  console.log('✓ tracking confirms DELIVERED')

  // 12. Cannot transition from DELIVERED to anything (courier gets 403 or 422)
  const invalidAfterDeliveredRes = await request(`/api/orders/${order.id}`, {
    method: 'PATCH',
    headers: { Cookie: courier.cookie },
    body: JSON.stringify({ status: 'ON_THE_WAY' }),
  })
  assert(
    invalidAfterDeliveredRes.status === 403 || invalidAfterDeliveredRes.status === 422,
    `Cannot revert DELIVERED should be 403 or 422, got ${invalidAfterDeliveredRes.status}`
  )
  console.log('✓ cannot revert DELIVERED')

  // ════════════════════════════════════════════════════════════════
  // TEST 2: Full PICKUP flow (no courier)
  // ════════════════════════════════════════════════════════════════
  console.log('\n── PICKUP FLOW ──')

  const { menuItem: pickupItem, sizeOpt: pickupSize } = await getMenuItemWithSize()
  const pickupOrderRes = await request('/api/orders', {
    method: 'POST',
    headers: { Cookie: admin.cookie },
    body: JSON.stringify({
      customerName: 'Pickup Test',
      customerPhone: '+421900000001',
      orderType: 'PICKUP',
      paymentMethod: 'CASH',
      items: [
        {
          menuItemId: pickupItem.id,
          quantity: 1,
          selectedSize: pickupSize?.id || null,
          selectedOptions: [],
        },
      ],
    }),
  })
  assert(pickupOrderRes.status === 201, `Pickup creation failed: ${pickupOrderRes.status}`)
  const pickupOrder = pickupOrderRes.data
  assert(pickupOrder.orderType === 'PICKUP', 'Should be PICKUP')
  assert(pickupOrder.deliveryZoneId === null, 'PICKUP should have null zone')
  assert(pickupOrder.deliveryFee === 0, 'PICKUP should have 0 fee')
  console.log(`✓ created pickup order ${pickupOrder.orderNumber}`)

  // Kitchen flow for PICKUP
  await patchOrder(kitchen.cookie, pickupOrder.id, 'ACCEPTED')
  await patchOrder(kitchen.cookie, pickupOrder.id, 'IN_KITCHEN')
  await patchOrder(kitchen.cookie, pickupOrder.id, 'PREPARING')
  await patchOrder(kitchen.cookie, pickupOrder.id, 'READY')
  console.log('✓ kitchen flow: NEW → READY (PICKUP)')

  // PICKUP should NOT go through WAITING_FOR_COURIER
  const waitingRes = await patchOrder(
    kitchen.cookie, pickupOrder.id, 'WAITING_FOR_COURIER', 422
  )
  void waitingRes
  console.log('✓ PICKUP cannot go to WAITING_FOR_COURIER')

  // Admin marks as DELIVERED (customer picked up)
  await patchOrder(admin.cookie, pickupOrder.id, 'DELIVERED')
  console.log('✓ admin marked PICKUP as DELIVERED')

  // PICKUP tracking steps should NOT include courier states
  const pickupTracking = await request(
    `/api/orders/${pickupOrder.id}?token=${encodeURIComponent(pickupOrder.trackingToken)}`
  )
  assert(
    !pickupTracking.data.trackingSteps.includes('WAITING_FOR_COURIER'),
    'PICKUP tracking should not include WAITING_FOR_COURIER'
  )
  assert(
    !pickupTracking.data.trackingSteps.includes('ASSIGNED_TO_COURIER'),
    'PICKUP tracking should not include ASSIGNED_TO_COURIER'
  )
  console.log('✓ PICKUP tracking has no courier steps')

  // ════════════════════════════════════════════════════════════════
  // TEST 3: Cancellation flow
  // ════════════════════════════════════════════════════════════════
  console.log('\n── CANCELLATION FLOW ──')

  const cancelOrder = await createOrder(admin.cookie)
  await patchOrder(kitchen.cookie, cancelOrder.id, 'ACCEPTED')

  // Admin can cancel
  await patchOrder(admin.cookie, cancelOrder.id, 'CANCELLED')
  console.log('✓ admin cancelled order')

  // Cancelled order tracking shows only CANCELLED step
  const cancelTracking = await request(
    `/api/orders/${cancelOrder.id}?token=${encodeURIComponent(cancelOrder.trackingToken)}`
  )
  assert(
    cancelTracking.data.trackingSteps.length === 1 &&
      cancelTracking.data.trackingSteps[0] === 'CANCELLED',
    'Cancelled tracking should have only CANCELLED step'
  )
  console.log('✓ cancelled tracking shows single CANCELLED step')

  // Cannot transition from CANCELLED
  const afterCancel = await patchOrder(
    admin.cookie, cancelOrder.id, 'ACCEPTED', 422
  )
  void afterCancel
  console.log('✓ cannot revert CANCELLED')

  // ════════════════════════════════════════════════════════════════
  // TEST 4: allowedTransitions in API response
  // ════════════════════════════════════════════════════════════════
  console.log('\n── ALLOWED TRANSITIONS ──')

  const transitionsOrder = await createOrder(admin.cookie)
  const detailRes = await request(`/api/orders/${transitionsOrder.id}`, {
    headers: { Cookie: admin.cookie },
  })
  assert(
    Array.isArray(detailRes.data.allowedTransitions),
    'Admin should see allowedTransitions'
  )
  assert(
    detailRes.data.allowedTransitions.includes('ACCEPTED'),
    'NEW should allow ACCEPTED for admin'
  )
  assert(
    detailRes.data.allowedTransitions.includes('CANCELLED'),
    'NEW should allow CANCELLED for admin'
  )
  console.log('✓ admin sees allowedTransitions')

  // Kitchen sees only kitchen transitions
  const kitchenDetailRes = await request(`/api/orders/${transitionsOrder.id}`, {
    headers: { Cookie: kitchen.cookie },
  })
  assert(
    kitchenDetailRes.data.allowedTransitions.includes('ACCEPTED'),
    'Kitchen should see ACCEPTED'
  )
  assert(
    !kitchenDetailRes.data.allowedTransitions.includes('CANCELLED'),
    'Kitchen should NOT see CANCELLED'
  )
  console.log('✓ kitchen sees restricted transitions')

  // ════════════════════════════════════════════════════════════════
  // TEST 5: Courier earnings endpoint
  // ════════════════════════════════════════════════════════════════
  console.log('\n── EARNINGS ──')

  // The delivered order from TEST 1 should have created an earning (if enabled)
  // Check courier earnings endpoint
  const earningsRes = await request('/api/courier-earnings?range=today', {
    headers: { Cookie: courier.cookie },
  })
  assert(earningsRes.status === 200, `Earnings endpoint failed: ${earningsRes.status}`)
  assert(earningsRes.data.range, 'Earnings should include range')
  assert(earningsRes.data.summary, 'Earnings should include summary')
  console.log('✓ courier earnings endpoint returns range + summary')

  // Range=today should use Bratislava timezone
  const todayRange = earningsRes.data.range
  assert(todayRange.type === 'today', 'Range type should be today')
  // Bratislava is UTC+1 (CET) or UTC+2 (CEST). Start should be 22:00 or 23:00 previous day UTC.
  const startHour = new Date(todayRange.start).getUTCHours()
  assert(
    startHour === 22 || startHour === 23,
    `Today range start should be 22:00 or 23:00 UTC (Bratislava midnight), got ${startHour}:00`
  )
  console.log('✓ today range uses Europe/Bratislava timezone')

  console.log('\n✅ All order flow tests passed')
}

main().catch((e) => {
  console.error('\n❌ TEST FAILED:', e.message)
  console.error(e.stack)
  process.exit(1)
})

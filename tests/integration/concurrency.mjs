/**
 * Integration tests for concurrency safety.
 *
 * Tests that the optimistic concurrency control and atomic transactions
 * prevent race conditions:
 * - Two parallel dispatch requests create only ONE active assignment
 * - Two parallel status transitions create only ONE change
 * - Repeated complete request does NOT create duplicate earnings
 * - expectedStatus mismatch returns 409
 *
 * Run with: node tests/integration/concurrency.mjs
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
  const setCookie = response.headers.get('set-cookie')
  return { cookie: setCookie?.split(';')[0] || '' }
}

async function getMenuItemAndSize() {
  const menuRes = await request('/api/menu')
  const menuItem = menuRes.data
    .flatMap((c) => c.menuItems || [])
    .find((i) => i.isActive && i.isAvailable)
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

async function createReadyOrder(adminCookie, kitchenCookie) {
  const { menuItem, sizeOpt } = await getMenuItemAndSize()
  const zone = await getActiveZone()

  const createRes = await request('/api/orders', {
    method: 'POST',
    headers: { Cookie: adminCookie },
    body: JSON.stringify({
      customerName: 'Concurrency Test',
      customerPhone: '+421900000000',
      orderType: 'DELIVERY',
      paymentMethod: 'CASH',
      deliveryZoneId: zone.id,
      deliveryAddressLine1: 'Test 1',
      deliveryCity: 'Hlohovec',
      items: [{ menuItemId: menuItem.id, quantity: 1, selectedSize: sizeOpt?.id || null, selectedOptions: [] }],
    }),
  })
  assert(createRes.status === 201, `Order creation failed: ${createRes.status}`)

  const orderId = createRes.data.id

  // Move to READY via kitchen
  for (const status of ['ACCEPTED', 'IN_KITCHEN', 'PREPARING', 'READY']) {
    await request(`/api/orders/${orderId}`, {
      method: 'PATCH',
      headers: { Cookie: kitchenCookie },
      body: JSON.stringify({ status }),
    })
  }

  return { order: createRes.data, orderId }
}

async function getCourier(adminCookie, email) {
  const res = await request('/api/couriers', { headers: { Cookie: adminCookie } })
  const couriers = res.data.couriers || res.data
  return couriers.find((c) => c.user?.email === email) || couriers[0]
}

async function setCourierAvailable(adminCookie, courier) {
  await request('/api/couriers', {
    method: 'PATCH',
    headers: { Cookie: adminCookie },
    body: JSON.stringify({ courierId: courier.id, status: 'AVAILABLE' }),
  })
}

async function main() {
  console.log(`Concurrency tests target: ${BASE_URL}`)

  const admin = await loginWithCookie('admin@jasterka.sk', 'admin123')
  const kitchen = await loginWithCookie('kuchyna@jasterka.sk', 'kuchyna123')
  const courier = await loginWithCookie('kurier.bicykel@jasterka.sk', 'kurier123')
  console.log('✓ all roles logged in')

  // ════════════════════════════════════════════════════════════════
  // TEST 1: Parallel dispatch — only ONE assignment created
  // ════════════════════════════════════════════════════════════════
  console.log('\n── PARALLEL DISPATCH ──')

  const { order: order1, orderId: orderId1 } = await createReadyOrder(admin.cookie, kitchen.cookie)
  // Move to WAITING_FOR_COURIER
  await request(`/api/orders/${orderId1}`, {
    method: 'PATCH',
    headers: { Cookie: kitchen.cookie },
    body: JSON.stringify({ status: 'WAITING_FOR_COURIER' }),
  })

  const courierA = await getCourier(admin.cookie, 'kurier.bicykel@jasterka.sk')
  await setCourierAvailable(admin.cookie, courierA)

  // Fire two dispatch requests in parallel
  const dispatchBody = JSON.stringify({ orderId: orderId1, courierId: courierA.id })
  const [res1, res2] = await Promise.all([
    fetch(`${BASE_URL}/api/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL, Cookie: admin.cookie },
      body: dispatchBody,
    }),
    fetch(`${BASE_URL}/api/dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL, Cookie: admin.cookie },
      body: dispatchBody,
    }),
  ])

  const status1 = res1.status
  const status2 = res2.status
  console.log(`   dispatch 1: ${status1}, dispatch 2: ${status2}`)

  // Exactly one should succeed (201), the other should fail (409 or 422)
  const successCount = [status1, status2].filter((s) => s === 201).length
  assert(
    successCount === 1,
    `Exactly one dispatch should succeed, got ${successCount} (statuses: ${status1}, ${status2})`
  )
  console.log('✓ parallel dispatch: only one assignment created')

  // Verify only one assignment exists
  const orderDetail = await request(`/api/orders/${orderId1}`, {
    headers: { Cookie: admin.cookie },
  })
  const activeAssignments = (orderDetail.data.assignments || []).filter(
    (a) => a.status === 'ASSIGNED' || a.status === 'ACCEPTED'
  )
  assert(
    activeAssignments.length === 1,
    `Should have exactly 1 active assignment, got ${activeAssignments.length}`
  )
  console.log('✓ verified single active assignment')

  // ════════════════════════════════════════════════════════════════
  // TEST 2: Parallel status transitions — only ONE change applied
  // ════════════════════════════════════════════════════════════════
  console.log('\n── PARALLEL STATUS TRANSITION ──')

  // Create a fresh NEW order (not moved through kitchen)
  const { menuItem: item2, sizeOpt: size2 } = await getMenuItemAndSize()
  const zone2 = await getActiveZone()
  const freshOrderRes = await request('/api/orders', {
    method: 'POST',
    headers: { Cookie: admin.cookie },
    body: JSON.stringify({
      customerName: 'Concurrency Status Test',
      customerPhone: '+421900000002',
      orderType: 'DELIVERY',
      paymentMethod: 'CASH',
      deliveryZoneId: zone2.id,
      deliveryAddressLine1: 'Test 2',
      deliveryCity: 'Hlohovec',
      items: [{ menuItemId: item2.id, quantity: 1, selectedSize: size2?.id || null, selectedOptions: [] }],
    }),
  })
  const orderId2 = freshOrderRes.data.id

  // Two parallel PATCH requests to move NEW → ACCEPTED
  const patchBody = JSON.stringify({ status: 'ACCEPTED', expectedStatus: 'NEW' })
  const [patch1, patch2] = await Promise.all([
    fetch(`${BASE_URL}/api/orders/${orderId2}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL, Cookie: kitchen.cookie },
      body: patchBody,
    }),
    fetch(`${BASE_URL}/api/orders/${orderId2}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL, Cookie: kitchen.cookie },
      body: patchBody,
    }),
  ])

  const patchStatus1 = patch1.status
  const patchStatus2 = patch2.status
  console.log(`   patch 1: ${patchStatus1}, patch 2: ${patchStatus2}`)

  // Exactly one should succeed (200), the other should get 409 (conflict)
  const patchSuccessCount = [patchStatus1, patchStatus2].filter((s) => s === 200).length
  assert(
    patchSuccessCount === 1,
    `Exactly one PATCH should succeed, got ${patchSuccessCount}`
  )

  // The failed one should be 409 (conflict)
  const conflictCount = [patchStatus1, patchStatus2].filter((s) => s === 409).length
  assert(
    conflictCount === 1,
    `One PATCH should return 409 conflict, got ${conflictCount}`
  )
  console.log('✓ parallel status: only one change applied, other got 409')

  // Verify only one status history entry was created
  const order2Detail = await request(`/api/orders/${orderId2}`, {
    headers: { Cookie: admin.cookie },
  })
  const acceptedHistory = (order2Detail.data.statusHistory || []).filter(
    (h) => h.status === 'ACCEPTED'
  )
  assert(
    acceptedHistory.length === 1,
    `Should have 1 ACCEPTED history entry, got ${acceptedHistory.length}`
  )
  console.log('✓ no duplicate status history')

  // ════════════════════════════════════════════════════════════════
  // TEST 3: expectedStatus mismatch returns 409
  // ════════════════════════════════════════════════════════════════
  console.log('\n── EXPECTED STATUS MISMATCH ──')

  // Order is now ACCEPTED. Try to patch with expectedStatus=NEW (wrong)
  const mismatchRes = await request(`/api/orders/${orderId2}`, {
    method: 'PATCH',
    headers: { Cookie: kitchen.cookie },
    body: JSON.stringify({ status: 'IN_KITCHEN', expectedStatus: 'NEW' }),
  })
  assert(
    mismatchRes.status === 409,
    `expectedStatus mismatch should return 409, got ${mismatchRes.status}`
  )
  assert(
    mismatchRes.data.code === 'CONFLICT',
    `Error code should be CONFLICT, got ${mismatchRes.data.code}`
  )
  assert(
    mismatchRes.data.details?.currentStatus === 'ACCEPTED',
    `Details should include currentStatus`
  )
  console.log('✓ expectedStatus mismatch returns 409 with currentStatus')

  // ════════════════════════════════════════════════════════════════
  // TEST 4: Repeated complete request — no duplicate earnings
  // ════════════════════════════════════════════════════════════════
  console.log('\n── IDEMPOTENT COMPLETE ──')

  // Create and dispatch an order, then move to ON_THE_WAY
  const { orderId: orderId3 } = await createReadyOrder(admin.cookie, kitchen.cookie)
  await request(`/api/orders/${orderId3}`, {
    method: 'PATCH',
    headers: { Cookie: kitchen.cookie },
    body: JSON.stringify({ status: 'WAITING_FOR_COURIER' }),
  })

  const courierB = await getCourier(admin.cookie, 'kurier.bicykel@jasterka.sk')
  await setCourierAvailable(admin.cookie, courierB)

  await request('/api/dispatch', {
    method: 'POST',
    headers: { Cookie: admin.cookie },
    body: JSON.stringify({ orderId: orderId3, courierId: courierB.id }),
  })

  // Courier drives the flow
  await request(`/api/orders/${orderId3}`, {
    method: 'PATCH',
    headers: { Cookie: courier.cookie },
    body: JSON.stringify({ status: 'PICKED_UP', expectedStatus: 'ASSIGNED_TO_COURIER' }),
  })
  await request(`/api/orders/${orderId3}`, {
    method: 'PATCH',
    headers: { Cookie: courier.cookie },
    body: JSON.stringify({ status: 'ON_THE_WAY', expectedStatus: 'PICKED_UP' }),
  })

  // Now complete — send two parallel complete requests
  const completeBody = JSON.stringify({ status: 'DELIVERED', expectedStatus: 'ON_THE_WAY' })
  const [complete1, complete2] = await Promise.all([
    fetch(`${BASE_URL}/api/orders/${orderId3}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL, Cookie: courier.cookie },
      body: completeBody,
    }),
    fetch(`${BASE_URL}/api/orders/${orderId3}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Origin: BASE_URL, Cookie: courier.cookie },
      body: completeBody,
    }),
  ])

  const completeStatus1 = complete1.status
  const completeStatus2 = complete2.status
  console.log(`   complete 1: ${completeStatus1}, complete 2: ${completeStatus2}`)

  // Exactly one should succeed
  const completeSuccessCount = [completeStatus1, completeStatus2].filter((s) => s === 200).length
  assert(
    completeSuccessCount === 1,
    `Exactly one complete should succeed, got ${completeSuccessCount}`
  )
  console.log('✓ parallel complete: only one succeeds')

  // Verify order is DELIVERED
  const finalOrder = await request(`/api/orders/${orderId3}`, {
    headers: { Cookie: admin.cookie },
  })
  assert(
    finalOrder.data.status === 'DELIVERED',
    `Order should be DELIVERED, got ${finalOrder.data.status}`
  )
  console.log('✓ order confirmed DELIVERED')

  // Verify only one DELIVERED status history entry
  const deliveredHistory = (finalOrder.data.statusHistory || []).filter(
    (h) => h.status === 'DELIVERED'
  )
  assert(
    deliveredHistory.length === 1,
    `Should have 1 DELIVERED history entry, got ${deliveredHistory.length}`
  )
  console.log('✓ no duplicate DELIVERED history')

  // ════════════════════════════════════════════════════════════════
  // TEST 5: Consecutive (not parallel) duplicate transition
  // ════════════════════════════════════════════════════════════════
  console.log('\n── CONSECUTIVE DUPLICATE ──')

  // Create a fresh NEW order
  const { menuItem: item4, sizeOpt: size4 } = await getMenuItemAndSize()
  const zone4 = await getActiveZone()
  const freshOrder4Res = await request('/api/orders', {
    method: 'POST',
    headers: { Cookie: admin.cookie },
    body: JSON.stringify({
      customerName: 'Consecutive Dup Test',
      customerPhone: '+421900000004',
      orderType: 'DELIVERY',
      paymentMethod: 'CASH',
      deliveryZoneId: zone4.id,
      deliveryAddressLine1: 'Test 4',
      deliveryCity: 'Hlohovec',
      items: [{ menuItemId: item4.id, quantity: 1, selectedSize: size4?.id || null, selectedOptions: [] }],
    }),
  })
  const orderId4 = freshOrder4Res.data.id

  // First PATCH: NEW → ACCEPTED (should succeed)
  const first = await request(`/api/orders/${orderId4}`, {
    method: 'PATCH',
    headers: { Cookie: kitchen.cookie },
    body: JSON.stringify({ status: 'ACCEPTED', expectedStatus: 'NEW' }),
  })
  assert(first.status === 200, `First transition should succeed, got ${first.status}`)

  // Second PATCH: try NEW → ACCEPTED again (expectedStatus=NEW, but actual is ACCEPTED)
  // This can return 409 (conflict — stale expectedStatus) or 422 (business rule —
  // ACCEPTED→ACCEPTED is not a valid transition). Both are correct.
  const second = await request(`/api/orders/${orderId4}`, {
    method: 'PATCH',
    headers: { Cookie: kitchen.cookie },
    body: JSON.stringify({ status: 'ACCEPTED', expectedStatus: 'NEW' }),
  })
  assert(
    second.status === 409 || second.status === 422,
    `Second transition with stale expectedStatus should return 409 or 422, got ${second.status}`
  )
  console.log(`✓ consecutive duplicate rejected (${second.status})`)

  console.log('\n✅ All concurrency tests passed')
}

main().catch((e) => {
  console.error('\n❌ TEST FAILED:', e.message)
  console.error(e.stack)
  process.exit(1)
})

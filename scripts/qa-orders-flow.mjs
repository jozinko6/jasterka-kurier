const BASE_URL = process.env.QA_BASE_URL || 'http://localhost:3000'

const USERS = {
  admin: { email: 'admin@jasterka.sk', password: 'admin123' },
  kitchen: { email: 'kuchyna@jasterka.sk', password: 'kuchyna123' },
  courier: { email: 'kurier.bicykel@jasterka.sk', password: 'kurier123' },
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      // QA scripts send Origin to satisfy CSRF middleware (browser equivalent)
      Origin: BASE_URL,
      ...(options.headers || {}),
    },
  })

  let data = null
  const text = await response.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  if (!response.ok) {
    throw new Error(`${options.method || 'GET'} ${path} failed: ${response.status} ${JSON.stringify(data)}`)
  }

  return data
}

async function requestAllowingStatus(path, expectedStatus, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Origin: BASE_URL,
      ...(options.headers || {}),
    },
  })

  assert(
    response.status === expectedStatus,
    `${options.method || 'GET'} ${path} expected ${expectedStatus}, got ${response.status}`
  )
}

async function requestExpectingStatus(path, expectedStatus, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      Origin: BASE_URL,
      ...(options.headers || {}),
    },
  })

  let data = null
  const text = await response.text()
  if (text) {
    try {
      data = JSON.parse(text)
    } catch {
      data = text
    }
  }

  assert(
    response.status === expectedStatus,
    `${options.method || 'GET'} ${path} expected ${expectedStatus}, got ${response.status}: ${JSON.stringify(data)}`
  )

  return data
}

async function login(userKey) {
  const response = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(USERS[userKey]),
  })

  const auth = await response.json()
  if (!response.ok) {
    throw new Error(`Login ${userKey} failed: ${response.status} ${JSON.stringify(auth)}`)
  }

  const setCookie = response.headers.get('set-cookie')
  assert(setCookie, `${userKey} login did not return a session cookie`)
  assert(auth.user?.role, `${userKey} login did not return a user role`)
  const sessionCookie = setCookie.split(';')[0]

  return {
    cookie: sessionCookie,
    headers: { Cookie: sessionCookie },
    user: auth.user,
  }
}

async function main() {
  console.log(`QA target: ${BASE_URL}`)

  await requestAllowingStatus('/api/kitchen', 401)
  console.log('✓ protected kitchen endpoint rejects anonymous access')

  const admin = await login('admin')
  const kitchen = await login('kitchen')
  const courier = await login('courier')
  console.log('✓ admin, kitchen and courier users can log in')

  const categories = await request('/api/menu')
  const menuItem = categories
    .flatMap((category) => category.menuItems || [])
    .find((item) => item.isActive && item.isAvailable)
  assert(menuItem, 'No active and available menu item found')

  // Load full menu item detail to get option IDs (needed for size selection)
  const menuItemDetail = await request(`/api/menu/${menuItem.id}`)
  const sizeOption = (menuItemDetail.options || []).find((o) => o.optionType === 'SIZE' && o.isActive)
  // For items without SIZE options, selectedSize can be null
  const selectedSize = sizeOption ? sizeOption.id : null

  const zones = await request('/api/zones')
  const zone = zones.find((item) => item.isActive)
  assert(zone, 'No active delivery zone found')
  console.log(`✓ loaded menu item ${menuItem.name} and zone ${zone.name}`)

  const createdOrder = await request('/api/orders', {
    method: 'POST',
    body: JSON.stringify({
      customerName: 'QA Test Zakaznik',
      customerPhone: '+421900000000',
      customerEmail: 'qa@example.test',
      orderType: 'DELIVERY',
      paymentMethod: 'CASH',
      deliveryZoneId: zone.id,
      deliveryAddressLine1: 'QA Ulica 1',
      deliveryCity: 'Hlohovec',
      deliveryNote: 'QA courier note',
      kitchenNote: 'QA kitchen note',
      items: [
        {
          menuItemId: menuItem.id,
          quantity: 1,
          selectedSize,
          selectedOptions: [],
          kitchenNote: 'QA item note',
        },
      ],
    }),
  })

  assert(createdOrder.id, 'Created order has no id')
  assert(createdOrder.status === 'NEW', `Expected new order status NEW, got ${createdOrder.status}`)
  assert(createdOrder.orderNumber?.startsWith('JAS-'), 'Order number does not use JAS prefix')
  console.log(`✓ created order ${createdOrder.orderNumber}`)

  // Public tracking without token should be rejected (P1-15)
  await requestExpectingStatus(`/api/orders/${createdOrder.id}`, 401)
  console.log('✓ public tracking without token is rejected')

  // Public tracking WITH token should return sanitized DTO
  const trackingToken = createdOrder.trackingToken
  assert(trackingToken, 'Created order should return trackingToken')
  const publicTracking = await request(`/api/orders/${createdOrder.id}?token=${encodeURIComponent(trackingToken)}`)
  assert(publicTracking.orderNumber === createdOrder.orderNumber, 'Public tracking returned wrong order')
  assert(!('customerPhone' in publicTracking), 'Public tracking leaks customerPhone')
  assert(!('customerEmail' in publicTracking), 'Public tracking leaks customerEmail')
  assert(!('customerName' in publicTracking), 'Public tracking leaks customerName')
  assert(!('deliveryAddressLine1' in publicTracking), 'Public tracking leaks delivery address')
  assert(!('kitchenNote' in publicTracking), 'Public tracking leaks kitchenNote')
  assert(!('customerId' in publicTracking), 'Public tracking leaks customerId')
  assert(publicTracking.courier === null, 'New public tracking should not show courier before dispatch')
  assert(Array.isArray(publicTracking.trackingSteps), 'Public tracking should include trackingSteps')
  console.log('✓ public order tracking with token is sanitized')

  const kitchenOrders = await request('/api/kitchen', { headers: kitchen.headers })
  assert(
    kitchenOrders.some((order) => order.id === createdOrder.id),
    'Kitchen list does not include the new order'
  )
  console.log('✓ kitchen can see the new order')

  let currentOrder = createdOrder
  for (const status of ['ACCEPTED', 'IN_KITCHEN', 'PREPARING', 'READY']) {
    currentOrder = await request(`/api/orders/${createdOrder.id}`, {
      method: 'PATCH',
      headers: kitchen.headers,
      body: JSON.stringify({ status }),
    })
    assert(currentOrder.status === status, `Expected order status ${status}, got ${currentOrder.status}`)
  }
  console.log('✓ kitchen status flow reaches READY')

  const couriers = await request('/api/couriers', { headers: courier.headers })
  // Find an active courier; if none is AVAILABLE, set one to AVAILABLE via PATCH
  let availableCourier = couriers.find((item) => item.isActive && item.status === 'AVAILABLE')
  if (!availableCourier) {
    availableCourier = couriers.find((item) => item.isActive) || couriers[0]
    assert(availableCourier?.id, 'No courier available for assignment test')
    // Set courier to AVAILABLE
    await request('/api/couriers', {
      method: 'PATCH',
      headers: courier.headers,
      body: JSON.stringify({ courierId: availableCourier.id, status: 'AVAILABLE' }),
    })
  }
  assert(availableCourier?.id, 'No courier available for assignment test')

  await requestExpectingStatus('/api/dispatch', 403, {
    method: 'POST',
    headers: kitchen.headers,
    body: JSON.stringify({
      orderId: createdOrder.id,
      courierId: availableCourier.id,
    }),
  })
  console.log('✓ kitchen cannot dispatch orders')

  const assignment = await request('/api/dispatch', {
    method: 'POST',
    headers: admin.headers,
    body: JSON.stringify({
      orderId: createdOrder.id,
      courierId: availableCourier.id,
    }),
  })
  assert(assignment.id, 'Dispatch did not return an assignment id')
  const assignedPublicTracking = await request(`/api/orders/${createdOrder.id}?token=${encodeURIComponent(trackingToken)}`)
  const publicCourier = assignedPublicTracking.courier
  assert(publicCourier?.displayName === availableCourier.displayName, 'Public tracking does not show assigned courier')
  assert(!('phone' in publicCourier), 'Public tracking leaks courier phone')
  assert(!('user' in publicCourier), 'Public tracking leaks courier user')
  console.log('✓ public order tracking shows the assigned courier only')
  console.log(`✓ admin assigned order to courier ${availableCourier.displayName}`)

  // Duplicate dispatch should be rejected — either 409 (conflict) or 422 (business rule)
  // depending on which check fires first (order status vs existing assignment).
  const dupResponse = await fetch(`${BASE_URL}/api/dispatch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: BASE_URL,
      ...admin.headers,
    },
    body: JSON.stringify({
      orderId: createdOrder.id,
      courierId: availableCourier.id,
    }),
  })
  assert(
    dupResponse.status === 409 || dupResponse.status === 422,
    `Duplicate dispatch expected 409 or 422, got ${dupResponse.status}`
  )
  console.log(`✓ duplicate courier assignment is rejected (${dupResponse.status})`)

  const assignedOrdersResponse = await request('/api/orders?status=ASSIGNED_TO_COURIER', { headers: courier.headers })
  const assignedOrders = assignedOrdersResponse.orders ?? assignedOrdersResponse
  assert(
    Array.isArray(assignedOrders) && assignedOrders.some((order) => order.id === createdOrder.id),
    'Courier cannot see assigned order'
  )
  console.log('✓ courier can see assigned order')

  currentOrder = await request(`/api/orders/${createdOrder.id}`, {
    method: 'PATCH',
    headers: courier.headers,
    body: JSON.stringify({ status: 'PICKED_UP' }),
  })
  assert(currentOrder.status === 'PICKED_UP', `Expected PICKED_UP, got ${currentOrder.status}`)

  currentOrder = await request(`/api/orders/${createdOrder.id}`, {
    method: 'PATCH',
    headers: courier.headers,
    body: JSON.stringify({ status: 'ON_THE_WAY' }),
  })
  assert(currentOrder.status === 'ON_THE_WAY', `Expected ON_THE_WAY, got ${currentOrder.status}`)

  currentOrder = await request(`/api/orders/${createdOrder.id}`, {
    method: 'PATCH',
    headers: courier.headers,
    body: JSON.stringify({ status: 'DELIVERED' }),
  })
  assert(currentOrder.status === 'DELIVERED', `Expected DELIVERED, got ${currentOrder.status}`)
  console.log('✓ courier delivery flow reaches DELIVERED')

  console.log('QA orders/kitchen/courier flow passed')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

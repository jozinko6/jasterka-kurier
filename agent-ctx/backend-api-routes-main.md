# Backend API Routes - Pizza Jašterka

## Task Summary
Created all 15 API route files for the Pizza Jašterka pizza delivery system backend.

## Files Created

### 1. `/api/menu/route.ts` - GET menu categories with items
- Returns active categories with active menu items and their options
- Ordered by category sortOrder then item name

### 2. `/api/menu/[id]/route.ts` - GET single menu item detail
- Returns menu item with category and active options
- 404 if not found

### 3. `/api/orders/route.ts` - GET all orders, POST create order
- GET: Returns all orders with items, status history, zone, customer, assignments
- GET: Supports `?status=` filter
- POST: Creates order with server-side price calculation (NOT trusting client prices)
- POST: Auto-generates orderNumber as JAS-XXXX (incrementing from last order)
- POST: Creates initial status history entry with status NEW

### 4. `/api/orders/[id]/route.ts` - GET single order, PATCH update order
- GET: Returns order with all relations (items, status history, zone, customer, assignments, earnings, kitchen events)
- PATCH: Updates order status and creates status history entry
- PATCH: Sets timestamps based on status (acceptedAt, readyAt, pickedUpAt, deliveredAt)

### 5. `/api/kitchen/route.ts` - GET kitchen orders
- Returns orders in kitchen statuses: NEW, ACCEPTED, IN_KITCHEN, PREPARING, READY
- Ordered by createdAt ascending (oldest first = priority)

### 6. `/api/couriers/route.ts` - GET all couriers, PATCH courier status
- GET: Returns active couriers with user info
- PATCH: Updates courier status (CourierStatus enum)

### 7. `/api/zones/route.ts` - GET delivery zones
- Returns active zones by default
- `?all=true` returns all zones including inactive
- Ordered by priority

### 8. `/api/dispatch/route.ts` - POST assign courier
- Creates DeliveryAssignment record
- Updates order status to ASSIGNED_TO_COURIER with status history
- Increments courier's activeOrderCount

### 9. `/api/settings/route.ts` - GET/PUT restaurant settings
- GET: Returns first RestaurantSettings record (creates default if none)
- PUT: Updates settings (partial update supported)

### 10. `/api/admin/menu/route.ts` - POST create menu item, PUT update menu item
- POST: Creates new menu item with validation and slug uniqueness check
- PUT: Updates menu item (partial update, validates existence)

### 11. `/api/admin/categories/route.ts` - GET/POST categories
- GET: Returns all categories with menu items and options
- POST: Creates new category with slug uniqueness check

### 12. `/api/auth/route.ts` - POST login
- SHA-256 password hash verification matching seed data
- Returns user ID, email, phone, role, isActive

### 13. `/api/stats/route.ts` - GET dashboard stats
- Returns order counts by status
- Returns today's revenue (excluding cancelled/refunded)
- Returns today's order count

### 14. `/api/courier-earnings/route.ts` - GET courier earnings
- Returns all earnings by default
- `?courierId=` returns specific courier earnings with summary aggregation

### 15. `/api/opening-hours/route.ts` - GET/PUT opening hours
- GET: Returns all opening hours ordered by dayOfWeek
- PUT: Accepts array of opening hours, upserts by dayOfWeek

## Key Design Decisions
- **Server-side price calculation**: Order creation calculates prices from DB menu items, never trusts client-sent prices
- **Order number generation**: JAS-XXXX format, incrementing from last order number
- **Password hashing**: SHA-256 to match seed data (simple for dev, should use bcrypt in production)
- **Error handling**: All routes use try/catch with proper status codes (400, 401, 403, 404, 409, 500)
- **Next.js 16 params**: Uses `await params` pattern for dynamic route params

## Testing
All endpoints tested successfully:
- GET endpoints return correct data from seeded database
- POST order creation correctly calculates prices (base + size delta + option deltas)
- PATCH order update correctly sets timestamps and creates status history
- POST dispatch correctly creates assignments, updates order status, increments courier count
- POST auth correctly verifies passwords via SHA-256 hash

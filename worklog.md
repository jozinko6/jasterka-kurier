---
Task ID: debug-report-fixes
Agent: main
Task: Execute all 12 priority fixes from the debug report

Work Log:
- P0-1: Fixed auth route - replaced SHA-256 with bcrypt.compare, added session management (in-memory token store)
- P0-2: Created auth middleware (requireRole, authenticateRequest) and applied to all protected API routes
- P0-3: Removed .env, db/custom.db, tool-results/*, upload/*, .zscripts/* from git tracking; updated .gitignore; created .env.example
- P1-4: Fixed all TypeScript errors (AdminSection reduce type, OrderStatus array spread, ringColor CSS property, opening-hours results type); removed ignoreBuildErrors: true from next.config.ts; excluded examples/ and skills/ from tsconfig
- P1-5: Updated build and vercel-build scripts to use --webpack flag
- P2-6: Wrapped order number generation in db.$transaction for atomicity
- P2-7: Wrapped dispatch (assignment creation + order update + courier update) in db.$transaction
- P2-8: Added status transition validation with ALLOWED_TRANSITIONS graph in auth.ts, applied in PATCH /api/orders/[id]
- P3-9: Created Zod v4 validation schemas for all API request bodies in src/lib/validations.ts; applied to all write endpoints
- P4-10: Created PRISMA.md documenting the dual schema setup (SQLite local / PostgreSQL production)
- P5-11: Fixed lint warnings (unused eslint-disable in opening-hours); carousel.tsx and use-mobile.ts were clean
- P5-12: Verified UTF-8 encoding for all Slovak diacritics files
- Also: Created frontend auth system (auth-store.ts with Zustand persist, LoginForm component, authFetch wrapper)
- Updated Kitchen/Courier/Admin pages to require login with role-based access
- Updated KitchenSection, CourierSection, AdminSection to use authFetch for all API calls
- Installed @types/bcryptjs for proper TypeScript support
- Made GET /api/orders/[id] public for customer order tracking

Stage Summary:
- All 12 debug report issues fixed and verified
- TypeScript compiles cleanly (0 errors)
- ESLint passes (0 errors, 0 warnings)
- Auth system: bcrypt.compare + in-memory session tokens + role-based middleware
- API routes: public (menu, zones, settings, opening-hours, order creation, order tracking) vs protected (all staff routes)
- Frontend: Login gate on /kuchyna, /kurier, /admin pages; authFetch wrapper for token management

---
Task ID: 0-baseline
Agent: main
Task: Set up working branch, install deps, run baseline lint/typecheck/build/qa, document existing errors

Work Log:
- Cloned https://github.com/jozinko6/jasterka-kurier.git into /home/z/my-project (replaced scaffold)
- Reset working tree to origin/main (HEAD = 5d8ed5b)
- Created working branch fix/security-and-order-flow-hardening
- bun install completed (already had lockfile)
- prisma generate + db push + db seed on SQLite (file:/home/z/my-project/db/custom.db) succeeded
- bun run lint: 0 errors, 0 warnings (passes clean)
- bunx tsc --noEmit: 0 errors (passes clean)
- bun run build: passes; output is Next 16 Turbopack with --webpack fallback (per package.json script: "prisma generate --schema=prisma/schema.sqlite.prisma && next build --webpack")
- bun run qa:orders (run via `node scripts/qa-orders-flow.mjs` against dev server on port 3000): ALL CHECKS PASS:
  * protected kitchen endpoint rejects anonymous access (401)
  * admin/kitchen/courier users can log in
  * menu and zones load
  * POST /api/orders creates order JAS-...
  * GET /api/orders/[id] public tracking is sanitized (no customerPhone, no deliveryAddressLine1, assignments array present)
  * kitchen sees new order
  * kitchen can move NEW -> ACCEPTED -> IN_KITCHEN -> PREPARING -> READY
  * kitchen cannot dispatch (403)
  * admin can dispatch (201), public tracking shows courier displayName only (no phone, no user)
  * duplicate dispatch returns 409
  * courier can see assigned order
  * courier can move ASSIGNED_TO_COURIER -> PICKED_UP -> ON_THE_WAY -> DELIVERED
- Inspected both Prisma schemas: prisma/schema.prisma (PostgreSQL) and prisma/schema.sqlite.prisma (SQLite) are identical except for the datasource block. Both still use Float for monetary fields (P1-16 pending).
- Built authorization matrix from current API route handlers (see below).

Existing authorization matrix (current state):
| Endpoint                            | Roles allowed                          | Notes |
|-------------------------------------|----------------------------------------|-------|
| GET  /api/menu                      | public                                 | |
| GET  /api/zones                     | public                                 | |
| GET  /api/settings                  | public                                 | also creates default settings if missing (BUG: GET mutates DB) |
| GET  /api/opening-hours             | public                                 | |
| POST /api/orders                    | public                                 | server computes price from menu items (mostly OK) |
| GET  /api/orders/[id]               | staff (ADMIN/KITCHEN/COURIER/OWNER) full detail, otherwise sanitized public tracking | courier can read ANY order via sanitized public tracking (no ownership check on the public branch!) |
| PATCH /api/orders/[id]              | ADMIN/KITCHEN/COURIER/OWNER            | accepts changedByUserId from client (audit spoofing BUG); no concurrency check; single global transition map; courier can transition any order if role matches (no ownership check); kitchen can transition to DELIVERED (role-awareness BUG) |
| GET  /api/orders                    | ADMIN/KITCHEN/COURIER/OWNER            | courier filtered to assignments.some, but no status scoping; no pagination |
| GET  /api/kitchen                   | ADMIN/KITCHEN/OWNER                    | |
| POST /api/dispatch                  | ADMIN/OWNER                            | transactional; accepts assignedByUserId from client (audit spoofing BUG); uses findFirst->create (race-prone); does not check orderType=DELIVERY, order state, courier.isActive, courier.status, capacity, vehicle/zone compat |
| GET  /api/couriers                  | ADMIN/COURIER/OWNER                    | courier only sees own profile |
| POST /api/couriers                  | ADMIN/OWNER                            | |
| PUT  /api/couriers                  | ADMIN/OWNER/COURIER (own only)         | courier can change own password without currentPassword (BUG) |
| PATCH /api/couriers                 | ADMIN/OWNER/COURIER (own only)         | |
| DELETE /api/couriers                | ADMIN/OWNER                            | soft delete |
| GET  /api/courier-earnings          | ADMIN/COURIER/OWNER                    | no from/to/timezone support; UI sends no date range (BUG: shows lifetime as "today") |
| GET  /api/stats                     | ADMIN/OWNER                            | |
| GET  /api/admin/categories          | ADMIN/OWNER (assumed)                  | |
| POST/PUT/DELETE /api/admin/menu     | ADMIN/OWNER (assumed)                  | |
| POST/DELETE /api/auth               | public                                 | no rate limiting, no email normalization (P1-13 BUG) |

Stage Summary:
- Baseline is GREEN: lint clean, typecheck clean, build clean, QA passes.
- Branch fix/security-and-order-flow-hardening is ready for systematic hardening commits.
- Dev server must be started with setsid (not `bun run dev`) so subsequent `bun run` commands do not kill it.
- All P0/P1/P2 issues identified; will be addressed in subsequent commits following the user's suggested commit ordering.

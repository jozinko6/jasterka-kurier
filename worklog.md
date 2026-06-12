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

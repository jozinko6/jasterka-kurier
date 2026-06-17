# Final Hardening Audit — Pizza Jašterka Kuriér

**Audit date:** 2026-06-17
**Baseline commit:** `d4c631d70754e1c90b2ef213d4b65579f4651837`
**Working branch:** `fix/financial-integrity-and-e2e-hardening`

## Baseline results

| Check | Result |
|-------|--------|
| `bun run lint` | ✅ 0 errors, 0 warnings |
| `bunx tsc --noEmit` | ✅ 0 errors |
| `bun run test` | ✅ 151/151 unit tests pass |
| `bun run build` | ✅ Build succeeds |
| `npx prisma validate` | ✅ Both schemas valid |

## Existing implementation inventory

Confirmed present (from previous work):
- Resource-level order authorization (`src/lib/order-auth.ts`)
- Role-aware state machine (`src/lib/order-policy.ts`)
- Tracking token (SHA-256 hash)
- Service worker network-only for `/api/*`
- Server-side order validation
- Remuneration engine (`src/lib/remuneration.ts`)
- Immutable earning ledger (`src/lib/earning-ledger-service.ts`)
- Cash ledger (`src/lib/cash-ledger-service.ts`)
- Work sessions (`src/lib/work-session-service.ts`)
- Payout periods (`src/lib/payout-period-service.ts`)
- Self-billing invoices (`src/lib/self-billing-invoice-service.ts`)
- Agreement earnings statements (`src/lib/agreement-statement-service.ts`)
- Modern courier mobile PWA (`src/components/jasterka/courier/`)
- Vitest unit tests (151 tests)
- Integration QA scripts (3 `.mjs` files)

## Identified issues (by severity)

### CRITICAL — Race conditions and financial integrity

| # | Issue | Severity | Files affected |
|---|-------|----------|----------------|
| 1 | Order status update uses `expectedStatus` only when client sends it — not unconditional compare-and-swap | CRITICAL | `src/app/api/orders/[id]/route.ts` |
| 2 | `completeDeliveryOrder` is not a single transaction — snapshot, ledger, cash, order update are separate operations | CRITICAL | `src/lib/order-completion-service.ts` |
| 3 | Cash ledger running balance uses read-then-write without transaction lock | CRITICAL | `src/lib/cash-ledger-service.ts` |
| 4 | `createEarningEntriesForOrder` uses find-then-create without P2002 handling | HIGH | `src/lib/earning-ledger-service.ts` |
| 5 | Payout lifecycle operations (lock/approve/mark-paid) don't use conditional updates | HIGH | `src/lib/payout-period-service.ts` |
| 6 | Invoice numbering uses "find highest + 1" without atomic sequence | HIGH | `src/lib/self-billing-invoice-service.ts` |
| 7 | WorkSession model can't represent multiple pause/resume intervals | HIGH | `src/lib/work-session-service.ts`, `prisma/schema.prisma` |
| 8 | Ledger reversal accounting: aggregations exclude `REVERSAL` type but may double-count reversed entries | HIGH | Multiple files |

### HIGH — Privacy and data integrity

| # | Issue | Severity | Files affected |
|---|-------|----------|----------------|
| 9 | `GET /api/orders` returns same Prisma object to all roles — no role-specific DTO | HIGH | `src/app/api/orders/route.ts` |
| 10 | Order money fields still use `Float` (basePrice, subtotalAmount, etc.) | HIGH | `prisma/schema.prisma`, all order code |
| 11 | `selectedSize` accepted by name OR ID — should be ID only | MEDIUM | `src/app/api/orders/route.ts` |
| 12 | Required option groups not enforced (only SIZE) | MEDIUM | `src/app/api/orders/route.ts` |
| 13 | Self-billing uses hardcoded restaurant legal data (IČO 99999999) | HIGH | `src/lib/self-billing-invoice-service.ts` |
| 14 | Self-billing agreement validity not fully checked (dates, acceptedAt) | HIGH | `src/lib/self-billing-invoice-service.ts` |
| 15 | No PDF generation for invoices | MEDIUM | `src/lib/self-billing-invoice-service.ts` |
| 16 | Dispatch capacity check is outside transaction | HIGH | `src/app/api/dispatch/route.ts` |
| 17 | Online/offline status and work session changed by separate requests | MEDIUM | `src/components/jasterka/courier/CourierHome.tsx` |

### MEDIUM — Testing and infrastructure

| # | Issue | Severity | Files affected |
|---|-------|----------|----------------|
| 18 | No PostgreSQL integration tests (all use SQLite) | MEDIUM | `tests/` |
| 19 | No Playwright E2E tests | MEDIUM | `tests/` |
| 20 | No GitHub Actions CI | MEDIUM | `.github/` |
| 21 | Tests depend on seeded accounts (admin@jasterka.sk / admin123) | MEDIUM | `tests/integration/*.mjs` |
| 22 | No schema drift test between PostgreSQL and SQLite schemas | MEDIUM | `prisma/` |
| 23 | `prisma db push` used in production migration script | MEDIUM | `package.json` |

## Fixes applied

(Detailed in commit messages and sections below)

## Results after fixes

(To be filled after implementation)

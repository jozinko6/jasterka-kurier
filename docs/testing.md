# Testing Infrastructure

## Overview

The project uses a multi-layer testing strategy:

| Layer | Runner | Database | Location |
|-------|--------|----------|----------|
| Unit tests | Vitest | SQLite (in-memory) | `tests/unit/` |
| Integration tests | Vitest | SQLite (dev) / PostgreSQL (CI) | `tests/integration/` |
| E2E tests | Playwright (planned) | PostgreSQL test DB | `tests/e2e/` |
| QA smoke tests | Node.js | Dev server | `tests/integration/*.mjs` |

## Running tests

```bash
# All unit tests
bun run test:unit

# Integration tests (requires dev server for .mjs, DB for .ts)
bun run test:integration

# All tests with coverage
bun run test:coverage

# Watch mode
bun run test:watch

# QA smoke tests (requires dev server on :3000)
bun run qa:orders
node tests/integration/order-flow.mjs
node tests/integration/order-validation.mjs
node tests/integration/concurrency.mjs
node tests/integration/auth-matrix.mjs
```

## Test database

### Development (SQLite)

Local development uses SQLite via `prisma/schema.sqlite.prisma`:
```bash
bun run db:push
bun run db:seed
```

### CI (PostgreSQL)

GitHub Actions uses PostgreSQL service container. The CI workflow:
1. Starts PostgreSQL 16
2. Pushes `prisma/schema.prisma` to test DB
3. Runs all tests against PostgreSQL

### Test fixtures

Tests create their own fixtures dynamically — **no test depends on seeded accounts**.
Each test creates its own users, couriers, orders, and plans, then cleans up.

## Coverage thresholds

| Module | Target |
|--------|--------|
| order-auth | ~100% branches |
| order-policy | ~100% branches |
| order-completion-service | ~100% branches |
| earning-ledger-service | ~100% branches |
| cash-ledger-service | ~100% branches |
| payout-period-service | ~100% branches |
| work-session-service | ~100% branches |
| self-billing-invoice-service | ~100% branches |
| money | ~100% branches |
| Overall | 80% statements, 75% branches |

## Playwright E2E (planned)

E2E tests will use:
- Mobile viewport: 390×844
- Real PostgreSQL test database
- Playwright browser contexts for auth

Planned specs:
- `tests/e2e/courier-delivery.spec.ts`
- `tests/e2e/courier-earnings.spec.ts`
- `tests/e2e/admin-payout.spec.ts`
- `tests/e2e/self-billing.spec.ts`
- `tests/e2e/privacy.spec.ts`

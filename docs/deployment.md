# Deployment Guide

## Prerequisites

- Node.js 20+
- PostgreSQL 16+ (Supabase or self-hosted)
- Vercel account (or compatible Next.js host)

## Environment variables

```env
# Database (Supabase PostgreSQL)
DATABASE_URL=postgresql://postgres.xxx:[password]@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?pgbouncer=true
DIRECT_URL=postgresql://postgres:[password]@db.xxx.supabase.co:5432/postgres

# Encryption (32-byte hex for IBAN encryption)
ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# App URL (for CSRF Origin check)
NEXT_PUBLIC_APP_URL=https://your-domain.com

# Node environment
NODE_ENV=production
```

## Deployment steps

### 1. Database migration

```bash
# Apply migrations to production DB
npx prisma migrate deploy --schema=prisma/schema.prisma

# ⚠️ NEVER use `prisma db push` in production
```

### 2. Data migration (if upgrading from legacy)

```bash
# Migrate CourierEarning → EarningLedgerEntry
bunx tsx scripts/migrate-earnings.ts

# Verify financial integrity
bunx tsx scripts/verify-financial-integrity.ts
```

### 3. Bootstrap admin account

```bash
# ⚠️ NEVER run `bun run db:seed` in production (it has weak demo passwords)

# Create admin via secure bootstrap:
ADMIN_BOOTSTRAP_EMAIL=admin@yourdomain.com \
ADMIN_BOOTSTRAP_PASSWORD=<strong-password-min-12-chars> \
bunx tsx scripts/create-admin.ts
```

### 4. Build and deploy

```bash
# Build (uses PostgreSQL schema)
npm run build

# Or via Vercel:
vercel --prod
```

### 5. Post-deployment verification

```bash
# Verify financial integrity
bunx tsx scripts/verify-financial-integrity.ts

# Run QA smoke tests against production
QA_BASE_URL=https://your-domain.com node scripts/qa-orders-flow.mjs
```

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on every push/PR:
1. PostgreSQL service container
2. `npm ci`
3. Prisma generate + db push
4. Lint
5. TypeCheck
6. Unit tests
7. Integration tests
8. Coverage
9. Build

PR cannot be merged without passing CI.

## Restaurant legal profile

Before generating self-billing invoices, create a verified `RestaurantLegalProfile`:
- Business name, legal name, address
- IČO, DIČ, IČ DPH
- VAT status
- IBAN, SWIFT
- Must be verified (`isVerified = true`) by admin

Without a verified legal profile, invoice generation is blocked.

## Self-billing agreement

Before a courier can receive self-billing invoices:
1. Admin creates `SelfBillingAgreement` (DRAFT)
2. Admin sends it to courier (SENT)
3. Courier accepts (ACCEPTED)
4. `CourierBusinessProfile.selfBillingEnabled = true`
5. Agreement must be valid (validFrom ≤ periodEnd, validTo IS NULL OR ≥ periodStart)

⚠️ The `SelfBillingAgreementTemplate` must be approved by a lawyer/accountant before production use.

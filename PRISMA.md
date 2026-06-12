# Prisma Dual Schema Setup

This project uses two Prisma schemas for different environments:

## Schemas

| File | Environment | Database | Notes |
|------|-------------|----------|-------|
| `prisma/schema.prisma` | **Production** (Vercel + Supabase) | PostgreSQL | Uses `@db.Decimal(10,2)`, `@map("snake_case")`, `@@map("table")`, `directUrl` |
| `prisma/schema.sqlite.prisma` | **Local Development** | SQLite | Uses `Float` instead of `Decimal`, no `@map`/`@@map` decorators |

## Why Two Schemas?

1. **PostgreSQL** (production) uses `Decimal` type for financial fields and requires column/table mapping with `@map`/`@@map` for snake_case conventions.
2. **SQLite** (local dev) doesn't support `@db.Decimal` or `@map` natively, so the schema is simplified.

Both schemas define the **same models and enums** — they're structurally identical, just adapted for their respective database engines.

## Local Development

All `db:*` npm scripts use the SQLite schema by default:

```bash
bun run db:push      # Push schema to local SQLite DB
bun run db:generate  # Generate Prisma Client from SQLite schema
bun run db:migrate   # Create migration for SQLite
bun run db:seed      # Seed local database
```

The local database is stored at `db/custom.db` (gitignored).

## Production (Vercel + Supabase)

The `vercel-build` script uses the PostgreSQL schema:

```bash
bun run vercel-build  # prisma generate + prisma migrate deploy + next build --webpack
```

Set these environment variables on Vercel:
- `DATABASE_URL` — Supabase connection pooler URL (port 6543, pgbouncer=true)
- `DIRECT_URL` — Direct database connection (port 5432)

## Adding Schema Changes

When modifying the database schema:

1. **Update BOTH** `schema.prisma` and `schema.sqlite.prisma` to keep them in sync
2. Test locally with SQLite: `bun run db:push`
3. Create a migration for production: `bunx prisma migrate dev --create-only --schema=prisma/schema.prisma`
4. Commit both schema files and the migration

## Key Differences Summary

| Feature | `schema.prisma` (PostgreSQL) | `schema.sqlite.prisma` (SQLite) |
|---------|------------------------------|--------------------------------|
| Financial fields | `Decimal @db.Decimal(10,2)` | `Float` |
| Column naming | `@map("snake_case")` | No `@map` |
| Table naming | `@@map("table_name")` | No `@@map` |
| Connection pooling | `directUrl` for Supabase | N/A |
| Unique constraint | `@@unique([dayOfWeek])` | Same |

## decimalToNumber Utility

Since PostgreSQL returns `Decimal` fields as `Prisma.Decimal` objects (which serialize as strings in JSON), all API routes use the `decimalToNumber()` utility from `src/lib/decimal-utils.ts` to recursively convert Decimal values to plain JavaScript numbers before returning JSON responses.

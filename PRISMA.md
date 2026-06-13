# Prisma Dual Schema Setup

This project uses two Prisma schemas for different environments:

| File | Environment | Database | Notes |
|------|-------------|----------|-------|
| `prisma/schema.prisma` | Production (Vercel + Supabase) | PostgreSQL | Uses PostgreSQL, enums, relations, and `directUrl` |
| `prisma/schema.sqlite.prisma` | Local development | SQLite | Keeps local development fast without Supabase credentials |

Both schemas define the same models and enums and should stay structurally aligned.

## Local Development

All local database scripts use the SQLite schema by default:

```bash
npm run db:push
npm run db:generate
npm run db:migrate
npm run db:seed
```

The local database is stored under `prisma/db/` and is gitignored.

## Production (Vercel + Supabase)

The `vercel-build` script uses the PostgreSQL schema:

```bash
npm run vercel-build
```

Set these environment variables on Vercel:

- `DATABASE_URL` - Supabase transaction pooler URL, port `6543`, with `pgbouncer=true`
- `DIRECT_URL` - direct Supabase database URL, port `5432`

For project `hdtnpmpfwwrvcunwvbpd`:

```bash
DATABASE_URL="postgresql://postgres.hdtnpmpfwwrvcunwvbpd:[password]@aws-0-eu-north-1.pooler.supabase.com:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://postgres:[password]@db.hdtnpmpfwwrvcunwvbpd.supabase.co:5432/postgres"
```

## Adding Schema Changes

When modifying the database schema:

1. Update both `schema.prisma` and `schema.sqlite.prisma` to keep them in sync.
2. Test locally with SQLite.
3. Create or update a production migration from `prisma/schema.prisma`.
4. Commit both schema files and the migration.

## Production Migration

The current production bootstrap SQL is tracked in `supabase/migrations/001_jasterka_schema.sql`.

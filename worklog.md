---
Task ID: 2
Agent: main
Task: Prepare project for Vercel + Supabase deployment

Work Log:
- Migrated Prisma schema from SQLite to PostgreSQL (Supabase-compatible)
- Created dual-schema setup: schema.prisma (PostgreSQL/production) and schema.sqlite.prisma (SQLite/local dev)
- Production schema uses @db.Decimal(10,2) for financial fields, @map for snake_case column names, @@map for table names
- Production schema uses directUrl for Supabase connection pooling
- Created decimalToNumber utility to convert Prisma.Decimal → JS number in API responses
- Updated all 9 API routes that return Decimal fields (menu, orders, orders/[id], kitchen, zones, settings, courier-earnings, admin/menu, menu/[id], stats)
- Fixed arithmetic bugs in orders/route.ts POST (Number() wrapping for basePrice, priceDelta, deliveryFee)
- Fixed arithmetic bug in stats/route.ts (Number() wrapping for totalAmount in reduce)
- Fixed courier-earnings aggregate _sum values (Number() conversion)
- Fixed settings/route.ts minimumOrderAmount (parseFloat for safe input handling)
- Updated package.json: name → pizza-jasterka, added postinstall, vercel-build, db:seed scripts
- Updated next.config.ts: removed output:"standalone" (Vercel handles this)
- Updated db.ts: production-mode logging (error only, not query)
- Created .env.example with Supabase connection string templates
- Replaced crypto SHA-256 with bcryptjs in seed.ts (production-ready password hashing)
- Added bcryptjs + @types/bcryptjs dependencies
- Added prisma.seed config to package.json
- All lint checks pass
- Dev server running with local SQLite schema
- All routes verified working via browser test

Stage Summary:
- Project is now ready for Vercel + Supabase deployment
- Dual-schema: SQLite for local dev, PostgreSQL for production
- All financial fields properly handled for Decimal conversion
- bcrypt password hashing for production security
- Vercel build script handles prisma generate + migrate deploy + next build

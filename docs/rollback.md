# Rollback Guide

## Database rollback

### Prisma migrations

Prisma migrations are forward-only. To rollback:

1. **Create a new migration** that reverses the change:
   ```bash
   npx prisma migrate dev --name reverse_xxx --schema=prisma/schema.prisma
   ```

2. **Never use `prisma migrate reset`** in production — it drops all data.

### Schema changes (db push)

If `prisma db push` was used (development only):
- The schema is applied directly
- To revert, fix the schema and re-push
- Data may be lost if columns are removed

## Application rollback

### Vercel

1. Go to Vercel dashboard → Deployments
2. Find the last known good deployment
3. Click "Promote to Production"

### Manual

```bash
# Checkout previous commit
git checkout <previous-commit-hash>

# Rebuild and deploy
npm run build
# Deploy according to your hosting setup
```

## Financial data rollback

⚠️ **Financial data should NEVER be rolled back** — it's an immutable ledger.

If incorrect entries were created:
1. Create **reversal entries** (negative amounts) — never delete originals
2. Create **correct entries** with new idempotency keys
3. Audit log the correction

If a payout was incorrectly marked as PAID:
1. Do NOT change the PAID status
2. Create a manual adjustment in the next period
3. Document in audit log

## Service worker rollback

If a bad service worker was deployed:
1. The new SW version (CACHE_NAME) automatically purges old caches on activate
2. Users will get the new SW on next page load
3. No manual intervention needed

## Emergency procedures

### Disable order creation

Set `RestaurantSettings.isOpen = false` via admin UI or API:
```bash
curl -X PUT https://your-domain.com/api/settings \
  -H "Cookie: jasterka_session=..." \
  -H "Content-Type: application/json" \
  -d '{"isOpen": false}'
```

### Disable dispatch

All couriers can be set to OFFLINE:
```bash
# Via admin UI or API
```

### Revoke all sessions

```sql
DELETE FROM "AuthSession";
```
All users will need to log in again.

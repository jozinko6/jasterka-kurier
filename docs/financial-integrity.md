# Financial Integrity

## Overview

All financial data follows these invariants:

1. **Money is always integer cents** — never Float
2. **Earning ledger is immutable** — entries are never edited, only reversed
3. **Cash ledger is separate from earnings** — cash collected ≠ earnings
4. **Payout periods are exclusive** — entries don't span periods
5. **Locked periods don't accept new entries**
6. **All financial operations are audit-logged**

## Ledger accounting model

```
Original entry: +200 cents (CONFIRMED, type=DELIVERY_BASE)
Reversal entry: -200 cents (CONFIRMED, type=REVERSAL, sourceEntryId=original)
Net total: 0 cents
```

- Original entries stay CONFIRMED (not deleted, not marked REVERSED in sum)
- Reversal entries are CONFIRMED and negative
- Net = sum of ALL CONFIRMED entries
- Use `calculateLedgerTotals()` from `src/lib/ledger-math.ts` — never ad-hoc filters

## Verification

Run the integrity check:
```bash
bunx tsx scripts/verify-financial-integrity.ts
```

Checks:
- No duplicate CASH_COLLECTED per order
- No duplicate active assignments per order
- No overlapping compensation profiles
- No multiple active work sessions
- Payout period totals match ledger entries
- No late entries in locked periods
- Invoice totals match payout periods

## Idempotency

All financial operations use idempotency keys:

| Operation | Key format |
|-----------|-----------|
| Earning entry | `order:{orderId}:{type}:{index}` |
| Cash collection | `cash:{orderId}` |
| Order completion | `complete:{orderId}:{courierId}` |
| Manual adjustment | `manual:{courierId}:{timestamp}:{random}` |
| Reversal | `reversal:{sourceEntryId}` |

## Migration from legacy CourierEarning

```bash
bunx tsx scripts/migrate-earnings.ts
```

The migration script:
1. Reads all `CourierEarning` records
2. Creates `EarningLedgerEntry` with type `LEGACY_IMPORT`
3. Uses idempotency key `legacy:{id}` — safe to run multiple times
4. Verifies sum before == sum after (0 cent difference)

After migration, `CourierEarning` is read-only (no write paths).

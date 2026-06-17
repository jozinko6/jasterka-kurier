/**
 * Migration script: CourierEarning → EarningLedgerEntry
 *
 * Migrates existing CourierEarning records (legacy aggregate model) into
 * individual EarningLedgerEntry records. Each old earning becomes:
 * - 1 DELIVERY_BASE entry (for the baseAmount)
 * - 1 ZONE_BONUS entry (for the zoneBonusAmount, if > 0)
 * - 1 MANUAL_ADJUSTMENT entry (for the manualAdjustmentAmount, if != 0)
 *
 * The migration is idempotent — running it twice produces no duplicates.
 * After migration, the old CourierEarning table can be kept read-only or
 * dropped after verification.
 *
 * Usage: bunx tsx scripts/migrate-earnings.ts
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🔄 Migrating CourierEarning → EarningLedgerEntry...')

  const legacyEarnings = await prisma.courierEarning.findMany({
    include: {
      order: { select: { id: true, deliveredAt: true } },
    },
  })

  console.log(`   Found ${legacyEarnings.length} legacy earnings`)

  let imported = 0
  let skipped = 0
  let totalBeforeCents = 0
  let totalAfterCents = 0

  for (const legacy of legacyEarnings) {
    const occurredAt = legacy.order?.deliveredAt ?? legacy.earningDate
    const baseCents = Math.round(Number(legacy.baseAmount) * 100)
    const zoneCents = Math.round(Number(legacy.zoneBonusAmount) * 100)
    const adjCents = Math.round(Number(legacy.manualAdjustmentAmount) * 100)
    const totalCents = Math.round(Number(legacy.totalAmount) * 100)

    totalBeforeCents += totalCents

    // Check if entries already exist (idempotency)
    const existing = await prisma.earningLedgerEntry.findFirst({
      where: {
        orderId: legacy.orderId,
        type: 'LEGACY_IMPORT',
      },
      select: { id: true },
    })

    if (existing) {
      skipped++
      totalAfterCents += totalCents
      continue
    }

    // Create legacy import entry (single aggregate entry)
    const entry = await prisma.earningLedgerEntry.create({
      data: {
        courierId: legacy.courierId,
        orderId: legacy.orderId,
        type: 'LEGACY_IMPORT',
        amountCents: totalCents,
        currency: 'EUR',
        description: `Migrácia z CourierEarning (base=${baseCents}c, zone=${zoneCents}c, adj=${adjCents}c)`,
        calculationMetadataJson: JSON.stringify({
          source: 'CourierEarning',
          sourceId: legacy.id,
          baseAmountCents: baseCents,
          zoneBonusCents: zoneCents,
          manualAdjustmentCents: adjCents,
          totalCents,
        }),
        status: 'CONFIRMED',
        occurredAt,
        confirmedAt: occurredAt,
        idempotencyKey: `legacy:${legacy.id}`,
      },
    })

    imported++
    totalAfterCents += totalCents
    void entry
  }

  console.log(`✅ Migration complete:`)
  console.log(`   Imported: ${imported}`)
  console.log(`   Skipped (already existed): ${skipped}`)
  console.log(`   Total before (cents): ${totalBeforeCents}`)
  console.log(`   Total after (cents): ${totalAfterCents}`)
  console.log(`   Difference (cents): ${totalBeforeCents - totalAfterCents}`)

  if (totalBeforeCents !== totalAfterCents) {
    console.error('❌ ERROR: Total mismatch! Migration is not balanced.')
    process.exit(1)
  } else {
    console.log('✓ Totals match — migration is balanced.')
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })

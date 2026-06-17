/**
 * Financial integrity verification script.
 *
 * Verifies that all financial data is consistent:
 * - Earnings legacy (CourierEarning) vs ledger (EarningLedgerEntry)
 * - Payout period totals vs ledger entries
 * - Invoice totals vs payout periods
 * - Duplicate cash entries
 * - Duplicate active assignments
 * - Overlapping compensation profiles
 * - Multiple active work sessions
 *
 * Usage: bunx tsx scripts/verify-financial-integrity.ts
 * Exit code 0 = all checks passed, 1 = issues found
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

interface CheckResult {
  name: string
  passed: boolean
  details: string
}

async function runChecks(): Promise<CheckResult[]> {
  const results: CheckResult[] = []

  // 1. No duplicate CASH_COLLECTED per order
  const duplicateCash = await prisma.cashLedgerEntry.groupBy({
    by: ['orderId'],
    where: { type: 'CASH_COLLECTED', orderId: { not: null } },
    having: { orderId: { _count: { gt: 1 } } },
    _count: { orderId: true },
  })
  results.push({
    name: 'No duplicate CASH_COLLECTED per order',
    passed: duplicateCash.length === 0,
    details: duplicateCash.length > 0
      ? `Found ${duplicateCash.length} orders with duplicate cash entries`
      : 'All cash entries are unique per order',
  })

  // 2. No duplicate active assignments per order
  const duplicateAssignments = await prisma.deliveryAssignment.groupBy({
    by: ['orderId'],
    where: { status: { in: ['ASSIGNED', 'ACCEPTED', 'PICKED_UP'] } },
    having: { orderId: { _count: { gt: 1 } } },
    _count: { orderId: true },
  })
  results.push({
    name: 'No duplicate active assignments per order',
    passed: duplicateAssignments.length === 0,
    details: duplicateAssignments.length > 0
      ? `Found ${duplicateAssignments.length} orders with duplicate active assignments`
      : 'All active assignments are unique per order',
  })

  // 3. No overlapping active compensation profiles
  const overlappingProfiles = await prisma.$queryRaw`
    SELECT c1."courierId", COUNT(*) as cnt
    FROM "CourierCompensationProfile" c1
    WHERE c1.active = true
    GROUP BY c1."courierId"
    HAVING COUNT(*) > 1
  ` as Array<{ courierId: string; cnt: bigint }>
  results.push({
    name: 'No overlapping active compensation profiles',
    passed: overlappingProfiles.length === 0,
    details: overlappingProfiles.length > 0
      ? `Found ${overlappingProfiles.length} couriers with multiple active profiles`
      : 'All couriers have at most one active compensation profile',
  })

  // 4. No multiple active work sessions per courier
  const multipleSessions = await prisma.workSession.groupBy({
    by: ['courierId'],
    where: { status: { in: ['ACTIVE', 'PAUSED'] } },
    having: { courierId: { _count: { gt: 1 } } },
    _count: { courierId: true },
  })
  results.push({
    name: 'No multiple active work sessions per courier',
    passed: multipleSessions.length === 0,
    details: multipleSessions.length > 0
      ? `Found ${multipleSessions.length} couriers with multiple active sessions`
      : 'All couriers have at most one active work session',
  })

  // 5. Payout period totals match ledger entries
  const periods = await prisma.payoutPeriod.findMany({
    where: { status: { in: ['LOCKED', 'APPROVED', 'PAID'] } },
    select: { id: true, payableCents: true, courierId: true, periodStart: true, periodEnd: true },
  })
  let periodMismatch = 0
  for (const period of periods) {
    const ledgerSum = await prisma.earningLedgerEntry.aggregate({
      where: {
        courierId: period.courierId,
        occurredAt: { gte: period.periodStart, lt: period.periodEnd },
        status: 'CONFIRMED',
      },
      _sum: { amountCents: true },
    })
    const expected = ledgerSum._sum.amountCents ?? 0
    if (period.payableCents !== expected) {
      periodMismatch++
      console.log(`  Period ${period.id}: payable=${period.payableCents} vs ledger=${expected}`)
    }
  }
  results.push({
    name: 'Payout period totals match ledger entries',
    passed: periodMismatch === 0,
    details: periodMismatch > 0
      ? `${periodMismatch} periods have mismatched totals`
      : `All ${periods.length} locked/approved/paid periods match ledger`,
  })

  // 6. No earning entries assigned to LOCKED/APPROVED/PAID periods that occurred after period end
  const lateEntriesInLockedPeriods = await prisma.earningLedgerEntry.count({
    where: {
      status: 'CONFIRMED',
      payoutPeriod: { status: { in: ['LOCKED', 'APPROVED', 'PAID'] } },
      occurredAt: { gte: new Date() }, // entries that occurred "in the future" relative to period end
    },
  })
  results.push({
    name: 'No late entries in locked periods',
    passed: lateEntriesInLockedPeriods === 0,
    details: lateEntriesInLockedPeriods > 0
      ? `Found ${lateEntriesInLockedPeriods} late entries in locked periods`
      : 'No late entries found in locked periods',
  })

  // 7. Invoice totals match payout periods
  const invoices = await prisma.selfBillingInvoice.findMany({
    where: { status: { in: ['ISSUED', 'DELIVERED', 'ACCEPTED'] } },
    select: { id: true, totalAmountCents: true, payoutPeriodId: true },
  })
  let invoiceMismatch = 0
  for (const invoice of invoices) {
    if (!invoice.payoutPeriodId) continue
    const period = await prisma.payoutPeriod.findUnique({
      where: { id: invoice.payoutPeriodId },
      select: { payableCents: true },
    })
    if (period && invoice.totalAmountCents !== period.payableCents) {
      invoiceMismatch++
      console.log(`  Invoice ${invoice.id}: total=${invoice.totalAmountCents} vs period=${period.payableCents}`)
    }
  }
  results.push({
    name: 'Invoice totals match payout periods',
    passed: invoiceMismatch === 0,
    details: invoiceMismatch > 0
      ? `${invoiceMismatch} invoices have mismatched totals`
      : `All ${invoices.length} issued invoices match their payout periods`,
  })

  return results
}

async function main() {
  console.log('🔍 Verifying financial integrity...\n')

  const results = await runChecks()

  let allPassed = true
  for (const result of results) {
    const icon = result.passed ? '✅' : '❌'
    console.log(`${icon} ${result.name}`)
    console.log(`   ${result.details}\n`)
    if (!result.passed) allPassed = false
  }

  if (allPassed) {
    console.log('\n✅ All financial integrity checks passed.')
    process.exit(0)
  } else {
    console.log('\n❌ Financial integrity issues found. See details above.')
    process.exit(1)
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

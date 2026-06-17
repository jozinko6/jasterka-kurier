/**
 * Agreement earnings statement service.
 *
 * For dohodári (AGREEMENT contract type), generates a "výkaz odmeny" — an
 * earnings statement that is NOT an invoice. It summarizes:
 * - delivery count
 * - work time (from work sessions)
 * - base earnings
 * - bonuses
 * - manual adjustments
 * - gross earnings
 * - net paid (imported from payroll system by admin)
 *
 * The statement is created after a payout period is locked. It can be
 * downloaded as PDF by the courier.
 */

import { db } from '@/lib/db'
import { getActiveWorkSeconds } from '@/lib/work-session-service'
import type { AgreementStatementStatus } from '@prisma/client'

export interface StatementData {
  statementId: string
  statementNumber: string
  courierId: string
  courierName: string
  payoutPeriodId: string
  periodStart: Date
  periodEnd: Date
  deliveryCount: number
  totalActiveSeconds: number
  baseEarningsCents: number
  bonusEarningsCents: number
  adjustmentCents: number
  grossEarningsCents: number
  netPaidCents: number | null
  paidAt: Date | null
  status: AgreementStatementStatus
  payrollExportCode: string | null
}

/**
 * Generate an agreement earnings statement for a locked payout period.
 * Only works for couriers with AGREEMENT contract type.
 */
export async function generateAgreementStatement(
  payoutPeriodId: string,
  actorUserId: string
): Promise<StatementData> {
  const period = await db.payoutPeriod.findUnique({
    where: { id: payoutPeriodId },
    include: {
      courier: {
        include: {
          agreementProfile: true,
          activeCompensationProfile: true,
        },
      },
      agreementStatement: true,
    },
  })

  if (!period) {
    throw new StatementError('NOT_FOUND', 'Výplatné obdobie nebolo nájdené')
  }

  // Verify contract type is AGREEMENT
  const contractType = period.courier.activeCompensationProfile?.contractType
  if (contractType !== 'AGREEMENT') {
    throw new StatementError(
      'INVALID_CONTRACT_TYPE',
      'Výkaz odmeny je dostupný iba pre dohodárov (AGREEMENT)'
    )
  }

  // Period must be locked
  if (period.status === 'OPEN' || period.status === 'CANCELLED') {
    throw new StatementError(
      'INVALID_STATUS',
      `Obdobie musí byť uzamknuté (aktuálny stav: ${period.status})`
    )
  }

  // If statement already exists, return it
  if (period.agreementStatement) {
    return mapStatement(period.agreementStatement, period)
  }

  // Load all confirmed entries in the period
  const entries = await db.earningLedgerEntry.findMany({
    where: {
      courierId: period.courierId,
      occurredAt: { gte: period.periodStart, lt: period.periodEnd },
      status: 'CONFIRMED',
    },
    select: { type: true, amountCents: true },
  })

  let baseEarningsCents = 0
  let bonusEarningsCents = 0
  let adjustmentCents = 0
  let deliveryCount = 0

  const bonusTypes = new Set([
    'ZONE_BONUS', 'PEAK_BONUS', 'WEEKEND_BONUS', 'HOLIDAY_BONUS',
    'WEATHER_BONUS', 'MULTI_ORDER_BONUS', 'MANUAL_BONUS',
  ])

  for (const entry of entries) {
    if (entry.type === 'REVERSAL') continue
    if (entry.type === 'MANUAL_ADJUSTMENT') {
      adjustmentCents += entry.amountCents
    } else if (bonusTypes.has(entry.type)) {
      bonusEarningsCents += entry.amountCents
    } else if (entry.type === 'TIP') {
      // Tips are separate, not included in gross
    } else {
      baseEarningsCents += entry.amountCents
      if (entry.type === 'DELIVERY_BASE') deliveryCount++
    }
  }

  const grossEarningsCents = baseEarningsCents + bonusEarningsCents + adjustmentCents

  // Get work time
  const totalActiveSeconds = await getActiveWorkSeconds(
    period.courierId,
    period.periodStart,
    period.periodEnd
  )

  // Generate statement number
  const year = period.periodStart.getFullYear()
  const statementNumber = `VYK-${year}-${String(period.periodStart.getMonth() + 1).padStart(2, '0')}-${period.courierId.slice(-6).toUpperCase()}`

  const statement = await db.agreementEarningsStatement.create({
    data: {
      statementNumber,
      courierId: period.courierId,
      payoutPeriodId: period.id,
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
      deliveryCount,
      totalActiveSeconds,
      baseEarningsCents,
      bonusEarningsCents,
      adjustmentCents,
      grossEarningsCents,
      status: 'ISSUED',
      createdByUserId: actorUserId,
    },
  })

  return mapStatement(statement, period)
}

/**
 * Import the net paid amount from the payroll system.
 * This is the actual amount transferred to the courier's bank account
 * after payroll taxes and deductions (computed by the external payroll system).
 */
export async function importNetPaid(
  statementId: string,
  netPaidCents: number,
  paidAt: Date,
  actorUserId: string
): Promise<void> {
  const statement = await db.agreementEarningsStatement.findUnique({
    where: { id: statementId },
    select: { id: true, status: true, payoutPeriodId: true, courierId: true },
  })

  if (!statement) {
    throw new StatementError('NOT_FOUND', 'Výkaz nebol nájdený')
  }

  if (statement.status === 'PAID' || statement.status === 'VOID') {
    throw new StatementError('INVALID_STATUS', `Výkaz v stave ${statement.status} nemožno aktualizovať`)
  }

  await db.$transaction(async (tx) => {
    await tx.agreementEarningsStatement.update({
      where: { id: statementId },
      data: {
        netPaidCents,
        paidAt,
        status: 'PAID',
      },
    })

    // Also update the payout period
    if (statement.payoutPeriodId) {
      await tx.payoutPeriod.update({
        where: { id: statement.payoutPeriodId },
        data: { paidAt, status: 'PAID' },
      })
    }

    await tx.courierAuditLog.create({
      data: {
        courierId: statement.courierId,
        action: 'PAYOUT_MARK_PAID',
        oldValueJson: JSON.stringify({ status: statement.status }),
        newValueJson: JSON.stringify({ status: 'PAID', netPaidCents, paidAt }),
        reason: `Import čistej sumy z mzdového systému`,
        actorUserId,
      },
    })
  })
}

/**
 * Export statement data as CSV for payroll system import.
 * Returns CSV string with Slovak headers.
 */
export function statementToCsv(statements: StatementData[]): string {
  const headers = [
    'ExportovyKod',
    'MenoKuriera',
    'CisloVykazu',
    'ObdobieOd',
    'ObdobieDo',
    'PocetDoruceni',
    'PracovnyCasSekundy',
    'PracovnyCasHodiny',
    'ZakladnaOdmenaCents',
    'BonusyCents',
    'UpravyCents',
    'HrubaOdmenaCents',
    'CistaSumaCents',
    'DatumPlatby',
    'Status',
  ]

  const rows = statements.map((s) => [
    s.payrollExportCode ?? '',
    s.courierName,
    s.statementNumber,
    s.periodStart.toISOString().slice(0, 10),
    s.periodEnd.toISOString().slice(0, 10),
    String(s.deliveryCount),
    String(s.totalActiveSeconds),
    (s.totalActiveSeconds / 3600).toFixed(2),
    String(s.baseEarningsCents),
    String(s.bonusEarningsCents),
    String(s.adjustmentCents),
    String(s.grossEarningsCents),
    s.netPaidCents !== null ? String(s.netPaidCents) : '',
    s.paidAt ? s.paidAt.toISOString().slice(0, 10) : '',
    s.status,
  ])

  return [headers, ...rows].map((row) => row.join(';')).join('\n')
}

function mapStatement(s: {
  id: string
  statementNumber: string
  courierId: string
  payoutPeriodId: string
  periodStart: Date
  periodEnd: Date
  deliveryCount: number
  totalActiveSeconds: number
  baseEarningsCents: number
  bonusEarningsCents: number
  adjustmentCents: number
  grossEarningsCents: number
  netPaidCents: number | null
  paidAt: Date | null
  status: AgreementStatementStatus
}, period: { courier: { displayName: string; agreementProfile: { payrollExportCode: string | null } | null } }): StatementData {
  return {
    statementId: s.id,
    statementNumber: s.statementNumber,
    courierId: s.courierId,
    courierName: period.courier.displayName,
    payoutPeriodId: s.payoutPeriodId,
    periodStart: s.periodStart,
    periodEnd: s.periodEnd,
    deliveryCount: s.deliveryCount,
    totalActiveSeconds: s.totalActiveSeconds,
    baseEarningsCents: s.baseEarningsCents,
    bonusEarningsCents: s.bonusEarningsCents,
    adjustmentCents: s.adjustmentCents,
    grossEarningsCents: s.grossEarningsCents,
    netPaidCents: s.netPaidCents,
    paidAt: s.paidAt,
    status: s.status,
    payrollExportCode: period.courier.agreementProfile?.payrollExportCode ?? null,
  }
}

export class StatementError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
    this.name = 'StatementError'
  }
}

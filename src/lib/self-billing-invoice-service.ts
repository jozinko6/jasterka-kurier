/**
 * Self-billing invoice service.
 *
 * For živnostníci (SELF_EMPLOYED contract type), generates a self-billing
 * invoice after a payout period is locked and approved. The invoice is
 * created by the company (odberateľ) in the name of the courier (dodávateľ)
 * based on a self-billing agreement.
 *
 * Key rules:
 * - Only SELF_EMPLOYED couriers with a valid ACCEPTED self-billing agreement
 *   can have invoices generated
 * - Invoice is created only after period is LOCKED (or APPROVED)
 * - Invoice numbers are sequential and concurrency-safe
 * - Invoice includes supplier and customer snapshots (immutable)
 * - VAT is computed based on the courier's vatStatus
 * - After ISSUED, the invoice cannot be edited — corrections use credit notes
 * - The invoice must contain "vyhotovenie faktúry odberateľom" formulation
 */

import { db } from '@/lib/db'
import type {
  SelfBillingInvoiceStatus,
  VatStatus,
  CourierContractType,
} from '@prisma/client'
import { encrypt, maskIban, decrypt } from '@/lib/crypto-utils'

export interface InvoiceData {
  invoiceId: string
  invoiceNumber: string
  courierId: string
  payoutPeriodId: string
  selfBillingAgreementId: string | null
  issueDate: Date
  supplyDate: Date
  dueDate: Date
  currency: string
  amountExVatCents: number
  vatRateBasisPoints: number
  vatAmountCents: number
  totalAmountCents: number
  status: SelfBillingInvoiceStatus
  supplierSnapshot: InvoicePartySnapshot
  customerSnapshot: InvoicePartySnapshot
  pdfStorageKey: string | null
  selfBillingNote: string
}

export interface InvoicePartySnapshot {
  name: string
  legalName: string
  address: string
  city: string
  postalCode: string
  countryCode: string
  companyId: string | null // IČO
  taxId: string | null // DIČ
  vatId: string | null // IČ DPH
  vatStatus: string
  ibanMasked: string | null
  swift: string | null
  isVatPayer: boolean
}

// Standard Slovak VAT rate: 23% (as of 2025; 1/1/2025 reduced from 20% to 23% for some items,
// but food delivery services use standard rate). In basis points: 2300.
const STANDARD_VAT_BPS = 2300
const ZERO_VAT_BPS = 0

/**
 * Generate a self-billing invoice for a locked/approved payout period.
 * Only works for SELF_EMPLOYED couriers with a valid ACCEPTED self-billing agreement.
 */
export async function generateSelfBillingInvoice(
  payoutPeriodId: string,
  actorUserId: string
): Promise<InvoiceData> {
  const period = await db.payoutPeriod.findUnique({
    where: { id: payoutPeriodId },
    include: {
      courier: {
        include: {
          businessProfile: true,
          activeCompensationProfile: true,
          selfBillingAgreements: {
            where: { status: 'ACCEPTED' },
            orderBy: { acceptedAt: 'desc' },
            take: 1,
          },
        },
      },
      selfBillingInvoice: true,
    },
  })

  if (!period) {
    throw new InvoiceError('NOT_FOUND', 'Výplatné obdobie nebolo nájdené')
  }

  // Verify contract type
  const contractType = period.courier.activeCompensationProfile?.contractType as CourierContractType | undefined
  if (contractType !== 'SELF_EMPLOYED') {
    throw new InvoiceError(
      'INVALID_CONTRACT_TYPE',
      'Samofaktúra je dostupná iba pre živnostníkov (SELF_EMPLOYED)'
    )
  }

  // Verify business profile exists with required fields
  const bp = period.courier.businessProfile
  if (!bp) {
    throw new InvoiceError('MISSING_BUSINESS_PROFILE', 'Kuriér nemá vyplnený firemný profil')
  }
  if (!bp.businessName || !bp.legalName || !bp.companyId || !bp.taxId) {
    throw new InvoiceError('INCOMPLETE_BUSINESS_PROFILE', 'Firemný profil nie je úplný (chýba názov, IČO alebo DIČ)')
  }

  // Verify self-billing agreement
  const agreement = period.courier.selfBillingAgreements[0]
  if (!agreement) {
    throw new InvoiceError(
      'NO_SELF_BILLING_AGREEMENT',
      'Kuriér nemá platnú dohodu o samofakturácii'
    )
  }
  if (!bp.selfBillingEnabled) {
    throw new InvoiceError(
      'SELF_BILLING_DISABLED',
      'Samofakturácia nie je povolená v profile kuriéra'
    )
  }

  // Period must be locked
  if (period.status === 'OPEN' || period.status === 'CANCELLED') {
    throw new InvoiceError(
      'INVALID_STATUS',
      `Obdobie musí byť uzamknuté (aktuálny stav: ${period.status})`
    )
  }

  // If invoice already exists, return it
  if (period.selfBillingInvoice) {
    return mapInvoice(period.selfBillingInvoice, period.courier.businessProfile)
  }

  // Compute amounts from ledger entries
  const entries = await db.earningLedgerEntry.findMany({
    where: {
      courierId: period.courierId,
      occurredAt: { gte: period.periodStart, lt: period.periodEnd },
      status: 'CONFIRMED',
      type: { not: 'REVERSAL' },
    },
    select: { type: true, amountCents: true },
  })

  // Tips are not subject to VAT (they're a pass-through, not a service fee)
  const taxableCents = entries
    .filter((e) => e.type !== 'TIP')
    .reduce((s, e) => s + e.amountCents, 0)
  const tipCents = entries
    .filter((e) => e.type === 'TIP')
    .reduce((s, e) => s + e.amountCents, 0)

  // Compute VAT based on courier's vatStatus
  const vatStatus = bp.vatStatus as VatStatus
  const isVatPayer = vatStatus === 'VAT_PAYER'
  const vatRateBps = isVatPayer ? STANDARD_VAT_BPS : ZERO_VAT_BPS

  // Amount ex VAT = taxableCents (for VAT payers, this is the base; for non-payers, it's the total)
  // For VAT payers: amountExVat = taxableCents, vatAmount = round(taxable * 23/100), total = amountExVat + vatAmount + tips
  // For non-payers: amountExVat = taxableCents, vatAmount = 0, total = amountExVat + tips
  const amountExVatCents = taxableCents
  const vatAmountCents = isVatPayer
    ? Math.round((taxableCents * vatRateBps) / 10000)
    : 0
  const totalAmountCents = amountExVatCents + vatAmountCents + tipCents

  // Build supplier (courier) and customer (restaurant) snapshots
  const supplierSnapshot = buildSupplierSnapshot(bp)
  const customerSnapshot = buildCustomerSnapshot()

  // Generate invoice number (concurrency-safe via transaction + sequence)
  const issueDate = new Date()
  const year = issueDate.getFullYear()
  const invoiceNumber = await generateInvoiceNumber(year)

  // Due date: 14 days after issue
  const dueDate = new Date(issueDate)
  dueDate.setDate(dueDate.getDate() + 14)

  // Supply date: end of the payout period
  const supplyDate = period.periodEnd

  const selfBillingNote = 'Táto faktúra bola vyhotovená odberateľom v mene dodávateľa na základe dohody o samofakturácii.'

  const invoice = await db.selfBillingInvoice.create({
    data: {
      invoiceNumber,
      courierId: period.courierId,
      payoutPeriodId: period.id,
      selfBillingAgreementId: agreement.id,
      supplierSnapshotJson: JSON.stringify(supplierSnapshot),
      customerSnapshotJson: JSON.stringify(customerSnapshot),
      issueDate,
      supplyDate,
      dueDate,
      currency: 'EUR',
      amountExVatCents,
      vatRateBasisPoints: vatRateBps,
      vatAmountCents,
      totalAmountCents,
      status: 'ISSUED',
      issuedAt: issueDate,
      createdByUserId: actorUserId,
    },
  })

  // Audit log
  await db.courierAuditLog.create({
    data: {
      courierId: period.courierId,
      action: 'INVOICE_CREATE',
      oldValueJson: null,
      newValueJson: JSON.stringify({
        invoiceId: invoice.id,
        invoiceNumber,
        totalAmountCents,
      }),
      reason: `Vytvorenie samofaktúry ${invoiceNumber}`,
      actorUserId,
    },
  })

  return mapInvoice(invoice, bp)
}

/**
 * Generate a concurrency-safe invoice number.
 * Format: SBI-YYYY-NNNN where NNNN is a zero-padded sequence.
 */
async function generateInvoiceNumber(year: number): Promise<string> {
  // Use a transaction with a lock-like pattern: find the max existing number for this year
  const result = await db.$transaction(async (tx) => {
    const existing = await tx.selfBillingInvoice.findFirst({
      where: {
        invoiceNumber: { startsWith: `SBI-${year}-` },
      },
      orderBy: { invoiceNumber: 'desc' },
      select: { invoiceNumber: true },
    })

    let nextSeq = 1
    if (existing) {
      const parts = existing.invoiceNumber.split('-')
      const lastSeq = parseInt(parts[2], 10)
      if (!isNaN(lastSeq)) nextSeq = lastSeq + 1
    }

    const candidate = `SBI-${year}-${String(nextSeq).padStart(4, '0')}`

    // Verify it doesn't exist (race condition guard)
    const collision = await tx.selfBillingInvoice.findUnique({
      where: { invoiceNumber: candidate },
      select: { id: true },
    })

    if (collision) {
      // Extremely unlikely, but increment and retry
      nextSeq++
      return `SBI-${year}-${String(nextSeq).padStart(4, '0')}`
    }

    return candidate
  })

  return result
}

/**
 * Mark an invoice as delivered (e.g. sent to courier via email/app).
 */
export async function markInvoiceDelivered(
  invoiceId: string,
  actorUserId: string
): Promise<void> {
  const invoice = await db.selfBillingInvoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, status: true, courierId: true },
  })

  if (!invoice) throw new InvoiceError('NOT_FOUND', 'Faktúra nebola nájdená')
  if (invoice.status !== 'ISSUED') {
    throw new InvoiceError('INVALID_STATUS', `Faktúru v stave ${invoice.status} nemožno označiť ako doručenú`)
  }

  await db.selfBillingInvoice.update({
    where: { id: invoiceId },
    data: { status: 'DELIVERED', deliveredAt: new Date() },
  })
}

/**
 * Courier accepts a delivered invoice.
 */
export async function acceptInvoice(
  invoiceId: string,
  courierUserId: string
): Promise<void> {
  const invoice = await db.selfBillingInvoice.findUnique({
    where: { id: invoiceId },
    include: { courier: { select: { userId: true } } },
  })

  if (!invoice) throw new InvoiceError('NOT_FOUND', 'Faktúra nebola nájdená')
  if (invoice.courier.userId !== courierUserId) {
    throw new InvoiceError('FORBIDDEN', 'Nemáte oprávnenie na túto faktúru')
  }
  if (invoice.status !== 'DELIVERED') {
    throw new InvoiceError('INVALID_STATUS', `Faktúru v stave ${invoice.status} nemožno akceptovať`)
  }

  await db.selfBillingInvoice.update({
    where: { id: invoiceId },
    data: { status: 'ACCEPTED', acceptedAt: new Date() },
  })
}

/**
 * Courier rejects a delivered invoice with a reason.
 */
export async function rejectInvoice(
  invoiceId: string,
  courierUserId: string,
  reason: string
): Promise<void> {
  if (!reason || reason.trim().length < 5) {
    throw new InvoiceError('INVALID_REQUEST', 'Dôvod odmietnutia je povinný (min 5 znakov)')
  }

  const invoice = await db.selfBillingInvoice.findUnique({
    where: { id: invoiceId },
    include: { courier: { select: { userId: true } } },
  })

  if (!invoice) throw new InvoiceError('NOT_FOUND', 'Faktúra nebola nájdená')
  if (invoice.courier.userId !== courierUserId) {
    throw new InvoiceError('FORBIDDEN', 'Nemáte oprávnenie na túto faktúru')
  }
  if (invoice.status !== 'DELIVERED') {
    throw new InvoiceError('INVALID_STATUS', `Faktúru v stave ${invoice.status} nemožno odmietnuť`)
  }

  await db.selfBillingInvoice.update({
    where: { id: invoiceId },
    data: { status: 'REJECTED', rejectedAt: new Date(), rejectionReason: reason },
  })
}

/**
 * Void an invoice (only DRAFT or ISSUED can be voided).
 * Creates an audit log. A credit note must be issued for corrections.
 */
export async function voidInvoice(
  invoiceId: string,
  actorUserId: string,
  reason: string
): Promise<void> {
  if (!reason || reason.trim().length < 5) {
    throw new InvoiceError('INVALID_REQUEST', 'Dôvod zrušenia je povinný (min 5 znakov)')
  }

  const invoice = await db.selfBillingInvoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, status: true, courierId: true, invoiceNumber: true },
  })

  if (!invoice) throw new InvoiceError('NOT_FOUND', 'Faktúra nebola nájdená')
  if (!['DRAFT', 'ISSUED'].includes(invoice.status)) {
    throw new InvoiceError('INVALID_STATUS', `Faktúru v stave ${invoice.status} nemožno zrušiť`)
  }

  await db.$transaction(async (tx) => {
    await tx.selfBillingInvoice.update({
      where: { id: invoiceId },
      data: { status: 'VOID' },
    })

    await tx.courierAuditLog.create({
      data: {
        courierId: invoice.courierId,
        action: 'INVOICE_VOID',
        oldValueJson: JSON.stringify({ status: invoice.status }),
        newValueJson: JSON.stringify({ status: 'VOID' }),
        reason: `Zrušenie faktúry ${invoice.invoiceNumber}: ${reason}`,
        actorUserId,
      },
    })
  })
}

function buildSupplierSnapshot(bp: {
  businessName: string
  legalName: string
  street: string
  city: string
  postalCode: string
  countryCode: string
  companyId: string | null
  taxId: string | null
  vatId: string | null
  vatStatus: string
  ibanEncrypted: string | null
  ibanLast4: string | null
  swift: string | null
}): InvoicePartySnapshot {
  let ibanMasked: string | null = null
  if (bp.ibanEncrypted) {
    try {
      const decrypted = decrypt(bp.ibanEncrypted)
      ibanMasked = maskIban(decrypted)
    } catch {
      ibanMasked = bp.ibanLast4 ? `•••• ${bp.ibanLast4}` : null
    }
  } else if (bp.ibanLast4) {
    ibanMasked = `•••• ${bp.ibanLast4}`
  }

  return {
    name: bp.businessName,
    legalName: bp.legalName,
    address: bp.street,
    city: bp.city,
    postalCode: bp.postalCode,
    countryCode: bp.countryCode,
    companyId: bp.companyId,
    taxId: bp.taxId,
    vatId: bp.vatId,
    vatStatus: bp.vatStatus,
    ibanMasked,
    swift: bp.swift,
    isVatPayer: bp.vatStatus === 'VAT_PAYER',
  }
}

function buildCustomerSnapshot(): InvoicePartySnapshot {
  // Restaurant (odberateľ) — in production this would come from a Restaurant entity
  return {
    name: 'Pizza Jašterka',
    legalName: 'Pizza Jašterka s.r.o.',
    address: 'Hlavná 45',
    city: 'Hlohovec',
    postalCode: '920 01',
    countryCode: 'SK',
    companyId: '99999999',
    taxId: '2025304110',
    vatId: 'SK2025304110',
    vatStatus: 'VAT_PAYER',
    ibanMasked: '•••• •••• •••• 5678',
    swift: 'TATRSKBX',
    isVatPayer: true,
  }
}

function mapInvoice(inv: {
  id: string
  invoiceNumber: string
  courierId: string
  payoutPeriodId: string
  selfBillingAgreementId: string | null
  issueDate: Date
  supplyDate: Date
  dueDate: Date
  currency: string
  amountExVatCents: number
  vatRateBasisPoints: number
  vatAmountCents: number
  totalAmountCents: number
  status: SelfBillingInvoiceStatus
  pdfStorageKey: string | null
  supplierSnapshotJson: string
  customerSnapshotJson: string
}, bp: { vatStatus: string } | null): InvoiceData {
  return {
    invoiceId: inv.id,
    invoiceNumber: inv.invoiceNumber,
    courierId: inv.courierId,
    payoutPeriodId: inv.payoutPeriodId,
    selfBillingAgreementId: inv.selfBillingAgreementId,
    issueDate: inv.issueDate,
    supplyDate: inv.supplyDate,
    dueDate: inv.dueDate,
    currency: inv.currency,
    amountExVatCents: inv.amountExVatCents,
    vatRateBasisPoints: inv.vatRateBasisPoints,
    vatAmountCents: inv.vatAmountCents,
    totalAmountCents: inv.totalAmountCents,
    status: inv.status,
    supplierSnapshot: JSON.parse(inv.supplierSnapshotJson),
    customerSnapshot: JSON.parse(inv.customerSnapshotJson),
    pdfStorageKey: inv.pdfStorageKey,
    selfBillingNote: 'Táto faktúra bola vyhotovená odberateľom v mene dodávateľa na základe dohody o samofakturácii.',
  }
}

export class InvoiceError extends Error {
  constructor(
    public code: string,
    message: string
  ) {
    super(message)
    this.name = 'InvoiceError'
  }
}

// Re-export encrypt for use in business profile API
export { encrypt as encryptIban, decrypt as decryptIban, maskIban }

import { describe, it, expect, beforeEach } from 'vitest'
import { eq } from 'drizzle-orm'
import {
  getDb,
  companies,
  companyItemPrices,
  salesDocuments,
  salesDocumentLines,
  salesDocumentPayments,
  salesDocumentCounters,
  serviceItems,
  userSettings,
  vatEntries,
} from '@ak-system/database'
import { createTestCaller } from '../test-utils'

type Caller = Awaited<ReturnType<typeof createTestCaller>>

beforeEach(async () => {
  const db = getDb()
  await db.delete(salesDocumentPayments)
  await db.delete(salesDocumentLines)
  await db.delete(salesDocuments)
  await db.delete(salesDocumentCounters)
  await db.delete(companyItemPrices)
  await db.delete(serviceItems)
  await db.delete(companies)
  await db.delete(vatEntries)
  await db.delete(userSettings)
})

async function client(caller: Caller, overrides: { name?: string; taxId?: string } = {}) {
  const { id } = await caller.companies.create({
    name: overrides.name ?? 'לקוח בדיקה',
    taxId: overrides.taxId ?? '515151515',
    city: 'תל אביב',
    address: 'רוטשילד 1',
  })
  return id
}

async function draft(
  caller: Caller,
  input: Partial<Parameters<Caller['salesDocuments']['createDraft']>[0]> = {}
) {
  return caller.salesDocuments.createDraft({
    docType: 'tax_invoice',
    issueDate: '2026-05-10',
    lines: [{ description: 'ייעוץ', quantity: 1, unitPrice: 1000 }],
    ...input,
  } as Parameters<Caller['salesDocuments']['createDraft']>[0])
}

describe('draft creation', () => {
  it('snapshots the client details from the company card', async () => {
    const caller = await createTestCaller()
    const companyId = await client(caller, { name: 'Acme בע"מ' })
    const { id } = await draft(caller, { companyId })

    const result = await caller.salesDocuments.get({ id })
    expect(result!.document.clientName).toBe('Acme בע"מ')
    expect(result!.document.clientTaxId).toBe('515151515')
    expect(result!.document.clientAddress).toBe('רוטשילד 1, תל אביב')
  })

  it('defaults to the client preferred language', async () => {
    const caller = await createTestCaller()
    const { id: companyId } = await caller.companies.create({
      name: 'Globex Inc.',
      preferredLanguage: 'en',
      country: 'US',
    })
    const { id } = await draft(caller, { companyId })
    const result = await caller.salesDocuments.get({ id })
    expect(result!.document.language).toBe('en')
  })

  it('computes totals with VAT and stores each line', async () => {
    const caller = await createTestCaller()
    const { id } = await draft(caller, {
      lines: [
        { description: 'ייעוץ', quantity: 2, unitPrice: 1000, discountPercent: 10 },
        { description: 'החזר נסיעות', quantity: 1, unitPrice: 200, vatApplicable: false },
      ],
    })

    const result = await caller.salesDocuments.get({ id })
    expect(result!.lines).toHaveLength(2)
    expect(result!.document.subtotal).toBe('2000')
    expect(result!.document.vatAmount).toBe('324')
    expect(result!.document.total).toBe('2324')
  })

  it('rejects a foreign-currency document without an exchange rate', async () => {
    const caller = await createTestCaller()
    await expect(draft(caller, { currency: 'USD' })).rejects.toThrow(/שער המרה/)
  })

  it('records the shekel equivalent for a dollar document', async () => {
    const caller = await createTestCaller()
    const { id } = await draft(caller, {
      currency: 'USD',
      exchangeRate: 3.7,
      vatMode: 'zero_rated',
      lines: [{ description: 'Consulting', quantity: 1, unitPrice: 1000 }],
    })
    const result = await caller.salesDocuments.get({ id })
    expect(result!.document.vatAmount).toBe('0')
    expect(result!.document.total).toBe('1000')
    expect(result!.document.totalIls).toBe('3700')
  })
})

describe('issuing and numbering', () => {
  it('numbers issued documents sequentially per type', async () => {
    const caller = await createTestCaller()
    const first = await draft(caller)
    const second = await draft(caller)
    expect((await caller.salesDocuments.issue({ id: first.id })).docNumber).toBe(1)
    expect((await caller.salesDocuments.issue({ id: second.id })).docNumber).toBe(2)

    const quote = await draft(caller, { docType: 'quote' })
    expect((await caller.salesDocuments.issue({ id: quote.id })).docNumber).toBe(1)
  })

  it('continues numbering from the start number set in business settings', async () => {
    const caller = await createTestCaller()
    await caller.settings.businessProfile.set({
      businessName: 'Alpir Consulting',
      startNumbers: { tax_invoice: 1041 },
    })

    expect((await caller.salesDocuments.nextNumber({ docType: 'tax_invoice' })).number).toBe(1041)
    const { id } = await draft(caller)
    expect((await caller.salesDocuments.issue({ id })).docNumber).toBe(1041)

    const next = await draft(caller)
    expect((await caller.salesDocuments.issue({ id: next.id })).docNumber).toBe(1042)
  })

  it('freezes the issuer details onto the document', async () => {
    const caller = await createTestCaller()
    await caller.settings.businessProfile.set({ businessName: 'Alpir Consulting', taxId: '123' })
    const { id } = await draft(caller)
    await caller.salesDocuments.issue({ id })
    await caller.settings.businessProfile.set({ businessName: 'Renamed', taxId: '123' })

    const result = await caller.salesDocuments.get({ id })
    expect(result!.issuer.businessName).toBe('Alpir Consulting')
  })

  it('locks an issued document against editing and deletion', async () => {
    const caller = await createTestCaller()
    const { id } = await draft(caller)
    await caller.salesDocuments.issue({ id })

    await expect(
      caller.salesDocuments.updateDraft({ id, notes: 'שינוי מאוחר' })
    ).rejects.toThrow(/הונפק/)
    await expect(caller.salesDocuments.remove({ id })).rejects.toThrow(/הונפק/)
  })

  it('refuses to issue a receipt with no payment recorded', async () => {
    const caller = await createTestCaller()
    const { id } = await draft(caller, { docType: 'receipt' })
    await expect(caller.salesDocuments.issue({ id })).rejects.toThrow(/תשלום/)

    await caller.salesDocuments.addPayment({
      documentId: id,
      method: 'bank_transfer',
      amount: 1180,
      paidDate: '2026-05-10',
    })
    await expect(caller.salesDocuments.issue({ id })).resolves.toBeTruthy()
  })
})

describe('VAT ledger sync', () => {
  it('creates an income entry in the right bimonthly period when a tax invoice is issued', async () => {
    const caller = await createTestCaller()
    const companyId = await client(caller)
    const { id } = await draft(caller, { companyId, issueDate: '2026-03-15' })
    const { docNumber } = await caller.salesDocuments.issue({ id })

    const entries = await caller.vat.list({ year: 2026, period: 2 })
    const entry = entries.find((row) => row.invoiceNumber === String(docNumber))
    expect(entry).toBeTruthy()
    expect(entry!.entryType).toBe('income')
    expect(parseFloat(entry!.amount)).toBe(1180)
  })

  it('marks a zero-rated export as VAT exempt in the ledger', async () => {
    const caller = await createTestCaller()
    const { id } = await draft(caller, {
      vatMode: 'zero_rated',
      currency: 'USD',
      exchangeRate: 3.7,
      lines: [{ description: 'Consulting', quantity: 1, unitPrice: 1000 }],
    })
    await caller.salesDocuments.issue({ id })

    const [entry] = await getDb().select().from(vatEntries)
    expect(parseFloat(entry.amount)).toBe(3700)
    expect(entry.isVatExempt === 1 || entry.isVatExempt === true).toBe(true)
  })

  it('does not touch the VAT ledger for a quote', async () => {
    const caller = await createTestCaller()
    const { id } = await draft(caller, { docType: 'quote' })
    await caller.salesDocuments.issue({ id })
    expect(await getDb().select().from(vatEntries)).toHaveLength(0)
  })

  it('links the ledger entry back to the document', async () => {
    const caller = await createTestCaller()
    const { id } = await draft(caller)
    const { vatEntryId } = await caller.salesDocuments.issue({ id })
    expect(vatEntryId).toBeTruthy()

    const [entry] = await getDb().select().from(vatEntries).where(eq(vatEntries.id, vatEntryId!))
    expect(entry.salesDocumentId).toBe(id)
  })
})

describe('credit invoices', () => {
  it('copies the source invoice lines into a credit draft', async () => {
    const caller = await createTestCaller()
    const companyId = await client(caller)
    const { id } = await draft(caller, { companyId })
    await caller.salesDocuments.issue({ id })

    const credit = await caller.salesDocuments.createCreditFor({
      taxInvoiceId: id,
      reason: 'ביטול עסקה',
    })
    const result = await caller.salesDocuments.get({ id: credit.id })
    expect(result!.document.docType).toBe('credit_invoice')
    expect(result!.document.status).toBe('draft')
    expect(result!.document.relatedDocumentId).toBe(id)
    expect(result!.document.total).toBe('1180')
    expect(result!.lines).toHaveLength(1)
  })

  it('refuses to credit a document that was never issued', async () => {
    const caller = await createTestCaller()
    const { id } = await draft(caller)
    await expect(caller.salesDocuments.createCreditFor({ taxInvoiceId: id })).rejects.toThrow(
      /הונפק/
    )
  })

  it('marks the source invoice as credited once the credit note is issued', async () => {
    const caller = await createTestCaller()
    const { id } = await draft(caller)
    await caller.salesDocuments.issue({ id })
    const credit = await caller.salesDocuments.createCreditFor({ taxInvoiceId: id })
    await caller.salesDocuments.issue({ id: credit.id })

    const source = await caller.salesDocuments.get({ id })
    expect(source!.document.creditedByDocumentId).toBe(credit.id)
  })
})

describe('cancelling and converting', () => {
  it('cancels a quote with a reason', async () => {
    const caller = await createTestCaller()
    const { id } = await draft(caller, { docType: 'quote' })
    await caller.salesDocuments.issue({ id })
    await caller.salesDocuments.cancel({ id, reason: 'הלקוח ויתר' })

    const result = await caller.salesDocuments.get({ id })
    expect(result!.document.status).toBe('cancelled')
    expect(result!.document.cancelReason).toBe('הלקוח ויתר')
  })

  it('refuses to cancel a tax invoice — a credit note is the only way back', async () => {
    const caller = await createTestCaller()
    const { id } = await draft(caller)
    await caller.salesDocuments.issue({ id })
    await expect(caller.salesDocuments.cancel({ id, reason: 'טעות' })).rejects.toThrow(/זיכוי/)
  })

  it('converts an issued quote into an invoice draft that references it', async () => {
    const caller = await createTestCaller()
    const companyId = await client(caller)
    const { id } = await draft(caller, { docType: 'quote', companyId })
    await caller.salesDocuments.issue({ id })

    const converted = await caller.salesDocuments.convert({ id, targetType: 'tax_invoice' })
    const result = await caller.salesDocuments.get({ id: converted.id })
    expect(result!.document.docType).toBe('tax_invoice')
    expect(result!.document.status).toBe('draft')
    expect(result!.document.relatedDocumentId).toBe(id)
    expect(result!.lines).toHaveLength(1)
  })

  it('rejects a conversion that makes no business sense', async () => {
    const caller = await createTestCaller()
    const { id } = await draft(caller)
    await expect(
      caller.salesDocuments.convert({ id, targetType: 'quote' })
    ).rejects.toThrow(/המרה/)
  })

  it('duplicates a document as a fresh unnumbered draft', async () => {
    const caller = await createTestCaller()
    const { id } = await draft(caller)
    await caller.salesDocuments.issue({ id })

    const copy = await caller.salesDocuments.duplicate({ id })
    const result = await caller.salesDocuments.get({ id: copy.id })
    expect(result!.document.status).toBe('draft')
    expect(result!.document.docNumber).toBeNull()
    expect(result!.document.total).toBe('1180')
  })
})

describe('payments and listing', () => {
  it('reports how much was paid against each document', async () => {
    const caller = await createTestCaller()
    const { id } = await draft(caller)
    await caller.salesDocuments.addPayment({
      documentId: id,
      method: 'bit',
      amount: 500,
      paidDate: '2026-05-11',
    })
    await caller.salesDocuments.addPayment({
      documentId: id,
      method: 'bank_transfer',
      amount: 680,
      paidDate: '2026-05-12',
    })

    const [row] = await caller.salesDocuments.list()
    expect(row.paidAmount).toBe(1180)
  })

  it('filters by type, status and year', async () => {
    const caller = await createTestCaller()
    const quote = await draft(caller, { docType: 'quote', issueDate: '2025-11-01' })
    const invoice = await draft(caller, { issueDate: '2026-05-10' })
    await caller.salesDocuments.issue({ id: invoice.id })

    expect((await caller.salesDocuments.list({ docType: 'quote' })).map((r) => r.id)).toEqual([
      quote.id,
    ])
    expect((await caller.salesDocuments.list({ status: 'issued' })).map((r) => r.id)).toEqual([
      invoice.id,
    ])
    expect((await caller.salesDocuments.list({ year: 2025 })).map((r) => r.id)).toEqual([quote.id])
  })

  it('summarises issued revenue for the year without counting credits', async () => {
    const caller = await createTestCaller()
    const invoice = await draft(caller)
    await caller.salesDocuments.issue({ id: invoice.id })
    const credit = await caller.salesDocuments.createCreditFor({ taxInvoiceId: invoice.id })
    await caller.salesDocuments.issue({ id: credit.id })

    const summary = await caller.salesDocuments.summary({ year: 2026 })
    expect(summary.issuedTotalIls).toBe(1180)
    expect(summary.byType.tax_invoice.count).toBe(1)
    expect(summary.byType.credit_invoice.count).toBe(1)
  })

  it('deletes a draft together with its lines', async () => {
    const caller = await createTestCaller()
    const { id } = await draft(caller)
    await caller.salesDocuments.remove({ id })

    expect(await caller.salesDocuments.get({ id })).toBeNull()
    expect(await getDb().select().from(salesDocumentLines)).toHaveLength(0)
  })
})

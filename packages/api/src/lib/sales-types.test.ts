import { describe, it, expect } from 'vitest'
import {
  allocationThresholdFor,
  allowedConversions,
  buildDocumentFileName,
  canCancel,
  computeDocumentTotals,
  computeLineTotal,
  documentTypeLabel,
  interpolate,
  isTaxDocument,
  requiresAllocationNumber,
  requiresPayment,
  requiresReference,
  signedAmount,
  DOCUMENT_STRINGS,
  SALES_DOCUMENT_TYPES,
} from '@ak-system/types'

describe('computeLineTotal', () => {
  it('applies a percentage discount to the gross line amount', () => {
    expect(computeLineTotal({ quantity: 2, unitPrice: 1000, discountPercent: 10 })).toBe(1800)
  })

  it('rounds to agorot', () => {
    expect(computeLineTotal({ quantity: 3, unitPrice: 33.335 })).toBe(100.01)
  })
})

describe('computeDocumentTotals', () => {
  it('adds 18% VAT on a standard document', () => {
    const totals = computeDocumentTotals([{ quantity: 1, unitPrice: 1000 }])
    expect(totals.subtotal).toBe(1000)
    expect(totals.vatAmount).toBe(180)
    expect(totals.total).toBe(1180)
  })

  it('charges no VAT on a zero-rated export document', () => {
    const totals = computeDocumentTotals([{ quantity: 1, unitPrice: 1000 }], {
      vatMode: 'zero_rated',
    })
    expect(totals.vatAmount).toBe(0)
    expect(totals.total).toBe(1000)
  })

  it('excludes non-vatable lines from the VAT base but not from the subtotal', () => {
    const totals = computeDocumentTotals([
      { quantity: 1, unitPrice: 1000 },
      { quantity: 1, unitPrice: 500, vatApplicable: false },
    ])
    expect(totals.subtotal).toBe(1500)
    expect(totals.vatAmount).toBe(180)
    expect(totals.total).toBe(1680)
  })
})

describe('document type rules', () => {
  it('marks only tax documents as tax documents', () => {
    expect(isTaxDocument('tax_invoice')).toBe(true)
    expect(isTaxDocument('tax_invoice_receipt')).toBe(true)
    expect(isTaxDocument('credit_invoice')).toBe(true)
    expect(isTaxDocument('quote')).toBe(false)
    expect(isTaxDocument('proforma')).toBe(false)
  })

  it('requires a payment only where money actually changed hands', () => {
    expect(requiresPayment('receipt')).toBe(true)
    expect(requiresPayment('tax_invoice_receipt')).toBe(true)
    expect(requiresPayment('tax_invoice')).toBe(false)
  })

  it('requires a source reference only for credit invoices', () => {
    expect(requiresReference('credit_invoice')).toBe(true)
    expect(requiresReference('tax_invoice')).toBe(false)
  })

  it('allows cancelling only non-tax documents', () => {
    expect(canCancel('quote')).toBe(true)
    expect(canCancel('proforma')).toBe(true)
    expect(canCancel('tax_invoice')).toBe(false)
  })

  it('lets a quote become a proforma or an invoice, but never the reverse', () => {
    expect(allowedConversions('quote')).toContain('tax_invoice')
    expect(allowedConversions('proforma')).toContain('tax_invoice_receipt')
    expect(allowedConversions('tax_invoice')).not.toContain('quote')
    expect(allowedConversions('credit_invoice')).toHaveLength(0)
  })

  it('negates credit amounts for display only', () => {
    expect(signedAmount('credit_invoice', 1180)).toBe(-1180)
    expect(signedAmount('tax_invoice', 1180)).toBe(1180)
  })
})

describe('allocation number', () => {
  it('tracks the Israeli threshold schedule', () => {
    expect(allocationThresholdFor('2025-06-01')).toBe(20000)
    expect(allocationThresholdFor('2026-02-01')).toBe(10000)
    expect(allocationThresholdFor('2026-08-01')).toBe(5000)
  })

  it('is required above the threshold for a business client', () => {
    expect(
      requiresAllocationNumber({
        issueDate: '2026-08-01',
        subtotal: 6000,
        clientTaxId: '515151515',
        docType: 'tax_invoice',
      })
    ).toBe(true)
  })

  it('is not required below the threshold, without a tax ID, or on a zero-rated export', () => {
    const base = {
      issueDate: '2026-08-01',
      clientTaxId: '515151515',
      docType: 'tax_invoice' as const,
    }
    expect(requiresAllocationNumber({ ...base, subtotal: 4000 })).toBe(false)
    expect(requiresAllocationNumber({ ...base, subtotal: 6000, clientTaxId: null })).toBe(false)
    expect(requiresAllocationNumber({ ...base, subtotal: 6000, vatMode: 'zero_rated' })).toBe(false)
    expect(
      requiresAllocationNumber({ ...base, subtotal: 6000, docType: 'quote' })
    ).toBe(false)
  })
})

describe('bilingual strings', () => {
  it('covers every document type in both languages', () => {
    for (const type of SALES_DOCUMENT_TYPES) {
      expect(DOCUMENT_STRINGS.he.documentTypes[type]).toBeTruthy()
      expect(DOCUMENT_STRINGS.en.documentTypes[type]).toBeTruthy()
    }
    expect(documentTypeLabel('tax_invoice', 'he')).toBe('חשבונית מס')
    expect(documentTypeLabel('tax_invoice', 'en')).toBe('Tax Invoice')
  })

  it('interpolates placeholders and leaves unknown keys intact', () => {
    expect(interpolate('{a} / {b}', { a: '1', b: '2' })).toBe('1 / 2')
    expect(interpolate('{missing}', {})).toBe('{missing}')
  })
})

describe('buildDocumentFileName', () => {
  it('prefixes the issue date so saved PDFs sort chronologically', () => {
    expect(
      buildDocumentFileName({
        docType: 'tax_invoice',
        docNumber: 10029,
        issueDate: '2026-08-06',
      })
    ).toBe('2026_08_06_Tax_Invoice_10029')
  })

  it('always uses English type labels to keep filenames LTR', () => {
    expect(
      buildDocumentFileName({
        docType: 'quote',
        docNumber: 1100009,
        issueDate: '2026-08-06T09:15:00.000Z',
        language: 'he',
      })
    ).toBe('2026_08_06_Quotation_1100009')
  })

  it('marks an unissued document as a draft', () => {
    expect(
      buildDocumentFileName({ docType: 'quote', docNumber: null, issueDate: '2026-01-02' })
    ).toBe('2026_01_02_Quotation_draft')
  })

  it('drops the prefix when the issue date is unusable', () => {
    expect(buildDocumentFileName({ docType: 'receipt', docNumber: 30021, issueDate: '' })).toBe(
      'Receipt_30021'
    )
  })
})

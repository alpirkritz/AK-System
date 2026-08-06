import { VAT_RATE } from './vat'

// ─── Document types ─────────────────────────────────────────────────────────

export const SALES_DOCUMENT_TYPES = [
  'quote',
  'proforma',
  'tax_invoice',
  'tax_invoice_receipt',
  'credit_invoice',
  'receipt',
] as const

export type SalesDocumentType = (typeof SALES_DOCUMENT_TYPES)[number]

export const SALES_DOCUMENT_STATUSES = ['draft', 'issued', 'cancelled'] as const
export type SalesDocumentStatus = (typeof SALES_DOCUMENT_STATUSES)[number]

export type DocumentLanguage = 'he' | 'en'

export const VAT_MODES = ['standard', 'zero_rated', 'exempt'] as const
export type VatMode = (typeof VAT_MODES)[number]

export const PAYMENT_METHODS = [
  'cash',
  'bank_transfer',
  'check',
  'credit_card',
  'bit',
  'paypal',
  'other',
] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const SERVICE_UNITS = ['hour', 'session', 'day', 'month', 'project', 'item'] as const
export type ServiceUnit = (typeof SERVICE_UNITS)[number]

export const PRICE_SOURCES = ['pinned', 'history', 'catalog', 'manual'] as const
export type PriceSource = (typeof PRICE_SOURCES)[number]

export const DOCUMENT_CURRENCIES = ['ILS', 'USD', 'EUR', 'GBP'] as const
export type DocumentCurrency = (typeof DOCUMENT_CURRENCIES)[number]

/** Short prefix used in list views and file names. */
export const SALES_DOCUMENT_ABBR: Record<SalesDocumentType, string> = {
  quote: 'הצ',
  proforma: 'עס',
  tax_invoice: 'חמ',
  tax_invoice_receipt: 'חק',
  credit_invoice: 'זכ',
  receipt: 'קב',
}

/** Tax documents are locked on issue and sync to the VAT ledger. */
export function isTaxDocument(type: SalesDocumentType): boolean {
  return type === 'tax_invoice' || type === 'tax_invoice_receipt' || type === 'credit_invoice'
}

/** Documents that are meaningless without at least one recorded payment. */
export function requiresPayment(type: SalesDocumentType): boolean {
  return type === 'tax_invoice_receipt' || type === 'receipt'
}

/** Documents that must point at an already-issued document. */
export function requiresReference(type: SalesDocumentType): boolean {
  return type === 'credit_invoice'
}

/** Only quotes and proformas can be voided outright; tax documents need a credit note. */
export function canCancel(type: SalesDocumentType): boolean {
  return type === 'quote' || type === 'proforma'
}

const CONVERSIONS: Record<SalesDocumentType, SalesDocumentType[]> = {
  quote: ['proforma', 'tax_invoice', 'tax_invoice_receipt'],
  proforma: ['tax_invoice', 'tax_invoice_receipt'],
  tax_invoice: ['receipt'],
  tax_invoice_receipt: [],
  credit_invoice: [],
  receipt: [],
}

export function allowedConversions(type: SalesDocumentType): SalesDocumentType[] {
  return CONVERSIONS[type] ?? []
}

// ─── Totals ─────────────────────────────────────────────────────────────────

export type DocumentLineInput = {
  quantity: number
  unitPrice: number
  /** Percent in 0–100 (not a 0–1 fraction, unlike VAT deductionPercent). */
  discountPercent?: number | null
  vatApplicable?: boolean
}

export type DocumentTotals = {
  subtotal: number
  vatAmount: number
  total: number
  lineTotals: number[]
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

export function computeLineTotal(line: DocumentLineInput): number {
  const gross = (line.quantity || 0) * (line.unitPrice || 0)
  const discount = line.discountPercent ? gross * (line.discountPercent / 100) : 0
  return round2(gross - discount)
}

/**
 * Zero-rated and exempt documents carry no VAT component at all, which also
 * exempts them from the Israel Invoices allocation-number requirement.
 */
export function computeDocumentTotals(
  lines: DocumentLineInput[],
  options: { vatRate?: number; vatMode?: VatMode } = {},
): DocumentTotals {
  const vatMode = options.vatMode ?? 'standard'
  const vatRate = vatMode === 'standard' ? (options.vatRate ?? VAT_RATE) : 0

  const lineTotals = lines.map(computeLineTotal)
  const subtotal = round2(lineTotals.reduce((sum, value) => sum + value, 0))

  const vatableBase = lines.reduce((sum, line, index) => {
    const applicable = line.vatApplicable !== false
    return applicable ? sum + lineTotals[index] : sum
  }, 0)

  const vatAmount = round2(vatableBase * vatRate)
  return { subtotal, vatAmount, total: round2(subtotal + vatAmount), lineTotals }
}

/** Credit notes are stored with positive amounts and negated only for display. */
export function signedAmount(type: SalesDocumentType, amount: number): number {
  return type === 'credit_invoice' ? -amount : amount
}

// ─── Israel Invoices allocation number ──────────────────────────────────────

/** Threshold in ILS excluding VAT, effective from the given date onward. */
export const ALLOCATION_THRESHOLDS = [
  { from: '2024-05-05', amount: 25000 },
  { from: '2025-01-01', amount: 20000 },
  { from: '2026-01-01', amount: 10000 },
  { from: '2026-06-01', amount: 5000 },
] as const

export function allocationThresholdFor(issueDate: string): number {
  let threshold = Number.POSITIVE_INFINITY
  for (const step of ALLOCATION_THRESHOLDS) {
    if (issueDate >= step.from) threshold = step.amount
  }
  return threshold
}

export function requiresAllocationNumber(input: {
  issueDate: string
  subtotal: number
  clientTaxId?: string | null
  docType: SalesDocumentType
  vatMode?: VatMode
}): boolean {
  if (input.docType !== 'tax_invoice' && input.docType !== 'tax_invoice_receipt') return false
  if ((input.vatMode ?? 'standard') !== 'standard') return false
  if (!input.clientTaxId || !input.clientTaxId.trim()) return false
  return input.subtotal > allocationThresholdFor(input.issueDate)
}

// ─── Bilingual document strings ─────────────────────────────────────────────

export type DocumentStrings = {
  documentTypes: Record<SalesDocumentType, string>
  paymentMethods: Record<PaymentMethod, string>
  units: Record<ServiceUnit, string>
  documentNumber: string
  issueDate: string
  dueDate: string
  validUntil: string
  allocationNumber: string
  billTo: string
  taxId: string
  phone: string
  email: string
  website: string
  colDescription: string
  colQuantity: string
  colUnitPrice: string
  colDiscount: string
  colLineTotal: string
  subtotal: string
  vat: string
  total: string
  amountReceived: string
  documentDetails: string
  thankYou: string
  paymentsTitle: string
  paymentMethodLabel: string
  paymentDate: string
  paymentReference: string
  notes: string
  bankDetails: string
  /** `{amount}` and `{rate}` placeholders. */
  ilsEquivalent: string
  zeroRatedNote: string
  exemptNote: string
  /** `{number}` placeholder. */
  creditReferenceNote: string
  cancelled: string
  page: string
}

export const DOCUMENT_STRINGS: Record<DocumentLanguage, DocumentStrings> = {
  he: {
    documentTypes: {
      quote: 'הצעת מחיר',
      proforma: 'חשבון עסקה',
      tax_invoice: 'חשבונית מס',
      tax_invoice_receipt: 'חשבונית מס קבלה',
      credit_invoice: 'חשבונית מס זיכוי',
      receipt: 'קבלה',
    },
    paymentMethods: {
      cash: 'מזומן',
      bank_transfer: 'העברה בנקאית',
      check: 'שיק',
      credit_card: 'כרטיס אשראי',
      bit: 'ביט',
      paypal: 'PayPal',
      other: 'אחר',
    },
    units: {
      hour: 'שעה',
      session: 'מפגש',
      day: 'יום',
      month: 'חודש',
      project: 'פרויקט',
      item: 'יחידה',
    },
    documentNumber: 'מספר מסמך',
    issueDate: 'תאריך',
    dueDate: 'לתשלום עד',
    validUntil: 'בתוקף עד',
    allocationNumber: 'מספר הקצאה',
    billTo: 'לכבוד',
    taxId: 'ח.פ. / עוסק מורשה',
    phone: 'טלפון',
    email: 'דוא"ל',
    website: 'אתר',
    colDescription: 'פירוט',
    colQuantity: 'כמות',
    colUnitPrice: 'מחיר יחידה',
    colDiscount: 'הנחה',
    colLineTotal: 'סה"כ',
    subtotal: 'סה"כ לפני מע"מ',
    vat: 'מע"מ',
    total: 'סה"כ לתשלום',
    amountReceived: 'סה"כ התקבל',
    documentDetails: 'פרטי המסמך',
    thankYou: 'תודה שבחרתם לעבוד איתנו',
    paymentsTitle: 'פרטי תשלום',
    paymentMethodLabel: 'אמצעי תשלום',
    paymentDate: 'תאריך תשלום',
    paymentReference: 'אסמכתא',
    notes: 'הערות',
    bankDetails: 'פרטי חשבון לתשלום',
    ilsEquivalent: 'שווה ערך בשקלים: {amount} (שער {rate})',
    zeroRatedNote: 'עסקה בשיעור מע"מ אפס — יצוא שירותים',
    exemptNote: 'עסקה פטורה ממע"מ',
    creditReferenceNote: 'זיכוי בגין חשבונית מס מספר {number}',
    cancelled: 'מבוטל',
    page: 'עמוד',
  },
  en: {
    documentTypes: {
      quote: 'Quotation',
      proforma: 'Proforma Invoice',
      tax_invoice: 'Tax Invoice',
      tax_invoice_receipt: 'Tax Invoice / Receipt',
      credit_invoice: 'Credit Invoice',
      receipt: 'Receipt',
    },
    paymentMethods: {
      cash: 'Cash',
      bank_transfer: 'Bank transfer',
      check: 'Check',
      credit_card: 'Credit card',
      bit: 'Bit',
      paypal: 'PayPal',
      other: 'Other',
    },
    units: {
      hour: 'Hour',
      session: 'Session',
      day: 'Day',
      month: 'Month',
      project: 'Project',
      item: 'Unit',
    },
    documentNumber: 'Document No.',
    issueDate: 'Date',
    dueDate: 'Due date',
    validUntil: 'Valid until',
    allocationNumber: 'Allocation number',
    billTo: 'Bill to',
    taxId: 'Tax ID',
    phone: 'Phone',
    email: 'Email',
    website: 'Website',
    colDescription: 'Description',
    colQuantity: 'Qty',
    colUnitPrice: 'Unit price',
    colDiscount: 'Discount',
    colLineTotal: 'Amount',
    subtotal: 'Subtotal',
    vat: 'VAT',
    total: 'Total due',
    amountReceived: 'Amount received',
    documentDetails: 'Document details',
    thankYou: 'Thank you for working with us',
    paymentsTitle: 'Payment details',
    paymentMethodLabel: 'Method',
    paymentDate: 'Payment date',
    paymentReference: 'Reference',
    notes: 'Notes',
    bankDetails: 'Bank details',
    ilsEquivalent: 'ILS equivalent: {amount} (rate {rate})',
    zeroRatedNote: 'Zero-rated VAT — export of services',
    exemptNote: 'VAT exempt transaction',
    creditReferenceNote: 'Credit for tax invoice no. {number}',
    cancelled: 'Cancelled',
    page: 'Page',
  },
}

export function documentTypeLabel(
  type: SalesDocumentType,
  language: DocumentLanguage = 'he',
): string {
  return DOCUMENT_STRINGS[language].documentTypes[type]
}

// ─── Internal (Hebrew-only) UI labels ───────────────────────────────────────

export const SALES_DOCUMENT_STATUS_LABELS: Record<SalesDocumentStatus, string> = {
  draft: 'טיוטה',
  issued: 'הונפק',
  cancelled: 'בוטל',
}

export const VAT_MODE_LABELS: Record<VatMode, string> = {
  standard: 'מע"מ רגיל (18%)',
  zero_rated: 'מע"מ בשיעור אפס (יצוא)',
  exempt: 'פטור ממע"מ',
}

export const SERVICE_UNIT_LABELS: Record<ServiceUnit, string> = {
  hour: 'שעה',
  session: 'מפגש',
  day: 'יום',
  month: 'חודש',
  project: 'פרויקט',
  item: 'יחידה',
}

/** Shown under an auto-filled price field so money is never filled silently. */
export const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
  pinned: 'מחיר קבוע ללקוח',
  history: 'מחיר אחרון ללקוח זה',
  catalog: 'ברירת מחדל מהקטלוג',
  manual: 'הוזן ידנית',
}

// ─── Formatting ─────────────────────────────────────────────────────────────

const LOCALES: Record<DocumentLanguage, string> = { he: 'he-IL', en: 'en-GB' }

export function formatDocumentMoney(
  amount: number,
  currency: string = 'ILS',
  language: DocumentLanguage = 'he',
): string {
  return new Intl.NumberFormat(LOCALES[language], {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount)
}

export function formatDocumentDate(iso: string, language: DocumentLanguage = 'he'): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(LOCALES[language], {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date)
}

/** `YYYY_MM_DD`, so saved PDFs sort chronologically inside a Drive folder. */
function fileNameDatePrefix(iso: string | null | undefined): string {
  if (!iso) return ''
  const parsed = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  if (parsed) return `${parsed[1]}_${parsed[2]}_${parsed[3]}`
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}_${pad(date.getMonth() + 1)}_${pad(date.getDate())}`
}

/**
 * Chrome uses document.title as the suggested PDF file name.
 * Always English (LTR) for type + draft so Drive/OS never mix RTL labels with dates.
 */
export function buildDocumentFileName(doc: {
  docType: SalesDocumentType
  docNumber?: number | null
  issueDate?: string | null
  language?: DocumentLanguage
}): string {
  const parts = [
    fileNameDatePrefix(doc.issueDate),
    DOCUMENT_STRINGS.en.documentTypes[doc.docType],
    doc.docNumber != null ? String(doc.docNumber) : 'draft',
  ]
  return parts
    .filter(Boolean)
    .join('_')
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '_')
}

export function interpolate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (match, key: string) => values[key] ?? match)
}

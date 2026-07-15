export const VAT_RATE = 0.18

export type VatCategoryDef = {
  id: string
  taxCode: string
  label: string
  defaultDeductionPercent: number
  vatApplicable: boolean
  entryType: 'income' | 'expense'
}

export const VAT_CATEGORIES: VatCategoryDef[] = [
  { id: 'income',        taxCode: '1',  label: 'הכנסות',                                      defaultDeductionPercent: 1,    vatApplicable: true,  entryType: 'income' },
  { id: 'cogs',          taxCode: '2',  label: 'קניות - עלות המכירות',                         defaultDeductionPercent: 1,    vatApplicable: true,  entryType: 'expense' },
  { id: 'maintenance',   taxCode: '8',  label: 'אחזקה תיקונים שוטפים (חשמל, מים)',             defaultDeductionPercent: 0.25, vatApplicable: true,  entryType: 'expense' },
  { id: 'office',        taxCode: '9',  label: 'משרדיות (דואר, טלפון)',                         defaultDeductionPercent: 0.67, vatApplicable: true,  entryType: 'expense' },
  { id: 'accounting',    taxCode: '10', label: 'הנהלת חשבונות',                                 defaultDeductionPercent: 1,    vatApplicable: true,  entryType: 'expense' },
  { id: 'travel',        taxCode: '12', label: 'נסיעה אשל חניה',                                defaultDeductionPercent: 1,    vatApplicable: true,  entryType: 'expense' },
  { id: 'vehicle',       taxCode: '12', label: 'רכב דלק ותיקונים',                              defaultDeductionPercent: 0.67, vatApplicable: true,  entryType: 'expense' },
  { id: 'taxes',         taxCode: '13', label: 'מיסים (ארנונה)',                                 defaultDeductionPercent: 0.67, vatApplicable: false, entryType: 'expense' },
  { id: 'communication', taxCode: '9',  label: 'תקשורת',                                        defaultDeductionPercent: 0.67, vatApplicable: true,  entryType: 'expense' },
  { id: 'coffee',        taxCode: '2',  label: 'קפה',                                           defaultDeductionPercent: 0.67, vatApplicable: true,  entryType: 'expense' },
  { id: 'parking',       taxCode: '12', label: 'חניה ותחבצ',                                     defaultDeductionPercent: 1,    vatApplicable: true,  entryType: 'expense' },
  { id: 'consulting',    taxCode: '2',  label: 'יעוץ',                                          defaultDeductionPercent: 1,    vatApplicable: true,  entryType: 'expense' },
]

export const BIMONTHLY_PERIODS = [
  { index: 1, label: 'ינו-פבר', months: [1, 2] },
  { index: 2, label: 'מרץ-אפר', months: [3, 4] },
  { index: 3, label: 'מאי-יוני', months: [5, 6] },
  { index: 4, label: 'יולי-אוג', months: [7, 8] },
  { index: 5, label: 'ספט-אוק', months: [9, 10] },
  { index: 6, label: 'נוב-דצמ', months: [11, 12] },
] as const

export function getCurrentPeriod(): { year: number; period: number } {
  const now = new Date()
  const month = now.getMonth() + 1
  const period = Math.ceil(month / 2)
  return { year: now.getFullYear(), period }
}

/**
 * Fix common OCR century typos (e.g. 2006-05-01 → 2026-05-01) when the
 * year is clearly misplaced relative to "now".
 */
export function sanitizeInvoiceDate(date: string, now = new Date()): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})(.*)$/.exec(date.trim())
  if (!m) return date
  let year = Number(m[1])
  const rest = `-${m[2]}-${m[3]}${m[4] ?? ''}`
  const currentYear = now.getFullYear()
  // OCR often reads 2026 as 2006 (missing the middle digit). Remap 200Y → 202Y
  // when we're in the 2020s and the gap is large.
  if (year >= 2000 && year <= 2015 && currentYear >= 2020 && currentYear - year >= 10) {
    year = 2000 + (year % 100) + 20 // 2006 → 2026
  }
  return `${year}${rest}`
}

/** Derive calendar year + bimonthly VAT period from an ISO date (YYYY-MM-DD). */
export function periodFromDate(date: string): { year: number; period: number } {
  const cleaned = sanitizeInvoiceDate(date)
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(cleaned.trim())
  if (m) {
    const year = Number(m[1])
    const month = Number(m[2])
    if (month >= 1 && month <= 12) {
      return { year, period: Math.ceil(month / 2) }
    }
  }
  const d = new Date(cleaned)
  if (Number.isNaN(d.getTime())) {
    return getCurrentPeriod()
  }
  return { year: d.getFullYear(), period: Math.ceil((d.getMonth() + 1) / 2) }
}

export type VatBreakdown = {
  incomeInclVat: number
  incomeExclVat: number
  vatExemptIncome: number
  vatFromIncome: number
  rawExpense: number
  computedExpense: number
  expenseExclVat: number
  vatExemptExpense: number
  vatFromExpenses: number
  totalExpenseForAnnual: number
}

export function computeVatBreakdown(
  entryType: 'income' | 'expense',
  amount: number,
  deductionPercent: number,
  isVatExempt: boolean,
): VatBreakdown {
  const result: VatBreakdown = {
    incomeInclVat: 0,
    incomeExclVat: 0,
    vatExemptIncome: 0,
    vatFromIncome: 0,
    rawExpense: 0,
    computedExpense: 0,
    expenseExclVat: 0,
    vatExemptExpense: 0,
    vatFromExpenses: 0,
    totalExpenseForAnnual: 0,
  }

  if (entryType === 'income') {
    if (isVatExempt) {
      result.vatExemptIncome = amount
    } else {
      result.incomeInclVat = amount
      result.incomeExclVat = amount / (1 + VAT_RATE)
      result.vatFromIncome = amount - result.incomeExclVat
    }
  } else {
    result.rawExpense = amount
    if (isVatExempt) {
      result.vatExemptExpense = amount
      result.totalExpenseForAnnual = amount
    } else {
      result.computedExpense = amount * deductionPercent
      result.expenseExclVat = result.computedExpense / (1 + VAT_RATE)
      result.vatFromExpenses = result.computedExpense - result.expenseExclVat
      result.totalExpenseForAnnual = result.expenseExclVat
    }
  }

  return result
}

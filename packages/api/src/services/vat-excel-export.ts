import { computeVatBreakdown, BIMONTHLY_PERIODS } from '@ak-system/types'

export type VatEntryForExport = {
  taxCode: string
  category: string
  entryType: string
  date: string
  invoiceNumber: string | null
  description: string
  amount: string
  isVatExempt: number | boolean
  deductionPercent: string | null
}

const HEADERS = [
  'סידורי',
  'קטגוריה',
  'תאריך',
  'חשבונית',
  'פרטים',
  'הכנסה כולל מעמ',
  'תגבולים ללא המעמ',
  'הכנסה פטורת מעמ',
  'מעמ מהכנסות',
  'אחוז',
  'הוצאה כוללת מעמ',
  'הוצאה כולל מעמ מחושב',
  'ההוצאות ללא המעמ',
  'הוצאה פטורת מהמעמ',
  'מעמ מהוצאות',
  'סהכ הוצאות ללא מעמ',
] as const

function numCell(n: number): string {
  if (!n) return ''
  // Fixed 2 decimals; Excel will parse as number when opening CSV
  return (Math.round(n * 100) / 100).toFixed(2)
}

function escapeCsv(value: string | number): string {
  const s = String(value ?? '')
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

function fmtDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = d.getFullYear()
  return `${dd}/${mm}/${yyyy}`
}

function periodLabel(period: number): string {
  const p = BIMONTHLY_PERIODS.find((x) => x.index === period)
  return p?.label ?? `תקופה-${period}`
}

export function buildVatExcelFileName(year: number, period?: number): string {
  if (period == null) return `ספר-תגבולים-${year}-שנתי.csv`
  return `ספר-תגבולים-${year}-${periodLabel(period)}.csv`
}

/** Build Excel-compatible CSV (UTF-8 BOM) matching the ספר תגבולים columns. */
export function buildVatExcelExport(
  entries: VatEntryForExport[],
  year: number,
  period?: number,
): { fileName: string; csv: string } {
  const rows: string[] = [HEADERS.join(',')]

  entries.forEach((entry, idx) => {
    const amount = parseFloat(entry.amount) || 0
    const deduction =
      entry.deductionPercent != null ? parseFloat(entry.deductionPercent) : 1
    const exempt =
      entry.isVatExempt === 1 || (entry.isVatExempt as unknown) === true
    const entryType = entry.entryType === 'income' ? 'income' : 'expense'
    const b = computeVatBreakdown(entryType, amount, deduction, exempt)

    const cells = [
      idx + 1,
      entry.category,
      fmtDate(entry.date),
      entry.invoiceNumber ?? '',
      entry.description,
      numCell(b.incomeInclVat),
      numCell(b.incomeExclVat),
      numCell(b.vatExemptIncome),
      numCell(b.vatFromIncome),
      entryType === 'expense' && !exempt ? String(deduction) : '',
      entryType === 'expense' && !exempt ? numCell(amount) : '',
      numCell(b.computedExpense),
      numCell(b.expenseExclVat),
      numCell(b.vatExemptExpense),
      numCell(b.vatFromExpenses),
      numCell(b.totalExpenseForAnnual),
    ]
    rows.push(cells.map(escapeCsv).join(','))
  })

  // BOM so Excel opens Hebrew correctly
  const csv = '\uFEFF' + rows.join('\r\n') + '\r\n'
  return { fileName: buildVatExcelFileName(year, period), csv }
}

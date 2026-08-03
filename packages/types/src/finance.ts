/**
 * Personal cash-flow categories — the single source of truth for
 * `finance_transactions.category` labels, their chart colors, and which of them
 * are excluded from totals or eligible for reduction advice.
 *
 * Distinct from VAT_CATEGORIES in ./vat, which is the business tax ledger taxonomy.
 * The stored value is the Hebrew label itself, matching the data written by the
 * importers since the feature shipped.
 */

/** `internal` categories move money without consuming it — never counted as income or expense. */
export type CashflowCategoryKind = 'expense' | 'income' | 'internal'

export interface CashflowCategoryDef {
  label: string
  color: string
  kind: CashflowCategoryKind
}

export const CASHFLOW_CATEGORIES: readonly CashflowCategoryDef[] = [
  { label: 'מזון', color: '#2dd4bf', kind: 'expense' },
  { label: 'אוכל בחוץ', color: '#fbbf24', kind: 'expense' },
  { label: 'רכב', color: '#38bdf8', kind: 'expense' },
  { label: 'ביגוד', color: '#f472b6', kind: 'expense' },
  { label: 'בריאות', color: '#4ade80', kind: 'expense' },
  { label: 'חשבונות', color: '#a78bfa', kind: 'expense' },
  { label: 'מנויים', color: '#fb923c', kind: 'expense' },
  { label: 'עמלות בנק', color: '#94a3b8', kind: 'expense' },
  { label: 'שכירות', color: '#60a5fa', kind: 'expense' },
  { label: 'משכנתא', color: '#818cf8', kind: 'expense' },
  { label: 'הלוואות', color: '#f87171', kind: 'expense' },
  { label: 'ביטוח', color: '#5eead4', kind: 'expense' },
  { label: 'חינוך', color: '#c084fc', kind: 'expense' },
  { label: 'אחר', color: '#647399', kind: 'expense' },
  { label: 'משכורת', color: '#34d399', kind: 'income' },
  { label: 'הכנסה אחרת', color: '#22d3ee', kind: 'income' },
  { label: 'העברות', color: '#7a89ab', kind: 'internal' },
  { label: 'כרטיס אשראי', color: '#9a7bc4', kind: 'internal' },
  { label: 'חיסכון והשקעות', color: '#67e8f9', kind: 'internal' },
] as const

/** Fallback category written by the categorizer when nothing matches. */
export const CATEGORY_FALLBACK = 'אחר'

/** Shown for `category IS NULL`. Deliberately not 'אחר', which is a real category. */
export const CATEGORY_UNCATEGORIZED = 'ללא סיווג'

/** Donut label for pooled sub-threshold slices. Deliberately not 'אחר'. */
export const CATEGORY_SMALL_SLICE = 'קטגוריות קטנות'

export const CASHFLOW_CATEGORY_LABELS: readonly string[] = CASHFLOW_CATEGORIES.map((c) => c.label)

export const CATEGORY_COLORS: Readonly<Record<string, string>> = Object.fromEntries(
  CASHFLOW_CATEGORIES.map((c) => [c.label, c.color])
)

/**
 * Excluded from income, expense, net and category charts.
 *
 * `כרטיס אשראי` is here because the bank shows one lump charge for the card while the
 * card connection reports the same money as itemised transactions — counting both
 * would double every shekel spent on the card.
 */
export const INTERNAL_CATEGORIES: readonly string[] = CASHFLOW_CATEGORIES.filter(
  (c) => c.kind === 'internal'
).map((c) => c.label)

export const INCOME_CATEGORIES: readonly string[] = CASHFLOW_CATEGORIES.filter(
  (c) => c.kind === 'income'
).map((c) => c.label)

/** Only these are ever targeted by reduction advice — fixed commitments are not "cut back" material. */
export const DISCRETIONARY_CATEGORIES: readonly string[] = ['אוכל בחוץ', 'מנויים', 'ביגוד']

export function categoryColor(label: string | null | undefined): string {
  if (!label) return '#647399'
  return CATEGORY_COLORS[label] ?? '#647399'
}

export function isInternalCategory(label: string | null | undefined): boolean {
  return !!label && INTERNAL_CATEGORIES.includes(label)
}

export function isDiscretionaryCategory(label: string | null | undefined): boolean {
  return !!label && DISCRETIONARY_CATEGORIES.includes(label)
}

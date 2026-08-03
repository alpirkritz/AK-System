export const PRIORITY_COLORS = {
  high: '#fb7185',
  medium: '#2dd4bf',
  low: '#38bdf8',
} as const

export const PRIORITY_LABELS = {
  high: 'גבוהה',
  medium: 'בינונית',
  low: 'נמוכה',
} as const

export const DAYS_HE: Record<string, string> = {
  Monday: 'שני',
  Tuesday: 'שלישי',
  Wednesday: 'רביעי',
  Thursday: 'חמישי',
  Friday: 'שישי',
}

/** Canonical task statuses (Notion-faithful), in lifecycle order — defines UI chip order. */
export const TASK_STATUS_ORDER = [
  'not_started',
  'pending',
  'in_progress',
  'blocked',
  'done',
  'cancelled',
] as const

export const STATUS_COLORS = {
  not_started: '#7a89ab',
  pending: '#f472b6',
  in_progress: '#38bdf8',
  blocked: '#f59e0b',
  done: '#2dd4bf',
  cancelled: '#9a7bc4',
} as const

/** One Hebrew term per concept: `blocked` is "חסום" so it never reads the same as `pending`. */
export const STATUS_LABELS = {
  not_started: 'לא התחיל',
  pending: 'בהמתנה',
  in_progress: 'בתהליך',
  blocked: 'חסום',
  done: 'הושלם',
  cancelled: 'בוטל',
} as const

export type Priority = keyof typeof PRIORITY_COLORS
export type RecurrenceDay = keyof typeof DAYS_HE
export type TaskStatus = keyof typeof STATUS_COLORS

export {
  VAT_RATE,
  VAT_CATEGORIES,
  BIMONTHLY_PERIODS,
  getCurrentPeriod,
  periodFromDate,
  sanitizeInvoiceDate,
  computeVatBreakdown,
} from './vat'
export type { VatCategoryDef, VatBreakdown } from './vat'

export {
  CASHFLOW_CATEGORIES,
  CASHFLOW_CATEGORY_LABELS,
  CATEGORY_COLORS,
  CATEGORY_FALLBACK,
  CATEGORY_UNCATEGORIZED,
  CATEGORY_SMALL_SLICE,
  INTERNAL_CATEGORIES,
  INCOME_CATEGORIES,
  DISCRETIONARY_CATEGORIES,
  categoryColor,
  isInternalCategory,
  isDiscretionaryCategory,
} from './finance'
export type { CashflowCategoryDef, CashflowCategoryKind } from './finance'

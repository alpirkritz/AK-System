export const PRIORITY_COLORS = {
  high: '#e8477a',
  medium: '#e8c547',
  low: '#47b8e8',
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

export type Priority = keyof typeof PRIORITY_COLORS
export type RecurrenceDay = keyof typeof DAYS_HE

export {
  VAT_RATE,
  VAT_CATEGORIES,
  BIMONTHLY_PERIODS,
  getCurrentPeriod,
  computeVatBreakdown,
} from './vat'
export type { VatCategoryDef, VatBreakdown } from './vat'

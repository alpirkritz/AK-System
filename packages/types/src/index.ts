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

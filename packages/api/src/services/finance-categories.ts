import {
  CASHFLOW_CATEGORIES,
  CATEGORY_COLORS,
  type CashflowCategoryKind,
} from '@ak-system/types'

export interface FinanceCategoryOption {
  /** null for built-in categories */
  id: string | null
  label: string
  color: string
  kind: CashflowCategoryKind
  builtin: boolean
}

export interface CustomCategoryRow {
  id: string
  label: string
  color: string
  kind: string
}

export const CUSTOM_CATEGORY_COLOR_PRESETS = [
  '#f59e0b',
  '#e879f9',
  '#86efac',
  '#fcd34d',
  '#fca5a5',
  '#93c5fd',
] as const

const DEFAULT_CUSTOM_COLOR = '#647399'

export function normalizeCategoryLabel(label: string): string {
  return label.trim().replace(/\s+/g, ' ')
}

export function mergeFinanceCategories(custom: readonly CustomCategoryRow[]): FinanceCategoryOption[] {
  const builtin: FinanceCategoryOption[] = CASHFLOW_CATEGORIES.map((c) => ({
    id: null,
    label: c.label,
    color: c.color,
    kind: c.kind,
    builtin: true,
  }))
  const customOpts: FinanceCategoryOption[] = custom.map((c) => ({
    id: c.id,
    label: c.label,
    color: c.color,
    kind: c.kind === 'income' ? 'income' : 'expense',
    builtin: false,
  }))
  return [...builtin, ...customOpts]
}

export function categoryLabels(options: readonly FinanceCategoryOption[]): string[] {
  return options.map((c) => c.label)
}

export function buildCategoryColorMap(options: readonly FinanceCategoryOption[]): Record<string, string> {
  const map: Record<string, string> = { ...CATEGORY_COLORS }
  for (const c of options) map[c.label] = c.color
  return map
}

/** True when label matches a built-in or existing custom category (case-insensitive). */
export function isDuplicateCategoryLabel(
  label: string,
  custom: readonly CustomCategoryRow[],
): boolean {
  const normalized = normalizeCategoryLabel(label).toLowerCase()
  if (!normalized) return true
  if (CASHFLOW_CATEGORIES.some((c) => c.label.toLowerCase() === normalized)) return true
  return custom.some((c) => c.label.toLowerCase() === normalized)
}

export function resolveCustomCategoryColor(color: string | undefined): string {
  const trimmed = (color ?? '').trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed
  return DEFAULT_CUSTOM_COLOR
}

export function pickDefaultCustomColor(existingCount: number): string {
  return CUSTOM_CATEGORY_COLOR_PRESETS[existingCount % CUSTOM_CATEGORY_COLOR_PRESETS.length] ?? DEFAULT_CUSTOM_COLOR
}

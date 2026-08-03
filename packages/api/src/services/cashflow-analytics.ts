import {
  CATEGORY_UNCATEGORIZED,
  DISCRETIONARY_CATEGORIES,
  isInternalCategory,
} from '@ak-system/types'

/**
 * Pure cash-flow aggregation and the deterministic insight engine.
 *
 * No DB access and no LLM — every figure here is reproducible from its inputs, which is
 * what makes the insight rules testable. Follows the precedent of pnl.ts.
 *
 * Money that only moves between the user's own accounts (internal categories) is excluded
 * from every total. The most important case is the monthly credit-card charge: the bank
 * reports it as one lump sum while the card connection reports the same money as itemised
 * transactions, so counting both would double it.
 */

export interface AnalyticsTxn {
  amount: number
  direction: 'income' | 'expense'
  category: string | null
  description: string | null
  transactionDate: string
}

export interface MonthlyPoint {
  month: string
  income: number
  expense: number
  net: number
}

export interface CategorySlice {
  category: string
  total: number
  count: number
  share: number
  trailingAvg: number
  deltaAbs: number
  deltaPct: number | null
}

export interface RecurringItem {
  label: string
  category: string | null
  occurrences: number
  avgAmount: number
  lastAmount: number
  lastDate: string
  cadence: 'monthly' | 'irregular'
  annualizedCost: number
  increasedPct: number | null
  firstDate: string
}

export type InsightKind =
  | 'overspend'
  | 'savings_potential'
  | 'new_recurring'
  | 'price_increase'
  | 'commitment_load'
  | 'savings_rate'

export interface Insight {
  id: string
  kind: InsightKind
  severity: 'info' | 'warn' | 'opportunity'
  title: string
  body: string
  amount: number | null
  category: string | null
  href: string | null
}

const MS_PER_DAY = 86_400_000

// ─── helpers ────────────────────────────────────────────────────────────────

export function monthKey(iso: string): string {
  return (iso ?? '').slice(0, 7)
}

/** Walk back `count` months from `from`, oldest first, as 'YYYY-MM' keys. */
export function monthWindow(count: number, from: Date): string[] {
  const keys: string[] = []
  const y = from.getUTCFullYear()
  const m = from.getUTCMonth()
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - i, 1))
    keys.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return keys
}

export function previousMonths(month: string, count: number): string[] {
  const [y, m] = month.split('-').map(Number)
  const out: string[] = []
  for (let i = 1; i <= count; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

/** Transactions that represent real income or spending rather than internal movement. */
function isCountable(t: AnalyticsTxn): boolean {
  return !isInternalCategory(t.category)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function shekels(n: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'ILS',
    maximumFractionDigits: 0,
  }).format(Math.round(n))
}

/**
 * Collapse a statement description to a stable identity for grouping.
 *
 * Israeli statements append branch codes, dates and installment counters to merchant
 * names, so digits and punctuation are noise while the leading words are the identity.
 */
export function normalizeDescription(description: string | null): string {
  const base = (description ?? '')
    .toLowerCase()
    .replace(/תשלום\s*\d+\s*(מתוך|מ)\s*\d+/g, ' ')
    .replace(/\d+/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return base.split(' ').slice(0, 4).join(' ')
}

// ─── aggregation ────────────────────────────────────────────────────────────

/** Income/expense/net per month over a fixed window. Empty months are present as zeros. */
export function buildMonthlyTrend(
  txns: readonly AnalyticsTxn[],
  months: number,
  now: Date = new Date()
): MonthlyPoint[] {
  const window = monthWindow(months, now)
  const byMonth = new Map<string, MonthlyPoint>(
    window.map((month) => [month, { month, income: 0, expense: 0, net: 0 }])
  )

  for (const t of txns) {
    if (!isCountable(t)) continue
    const point = byMonth.get(monthKey(t.transactionDate))
    if (!point) continue
    if (t.direction === 'income') point.income += t.amount
    else point.expense += t.amount
  }

  return window.map((month) => {
    const p = byMonth.get(month)!
    return {
      month,
      income: round2(p.income),
      expense: round2(p.expense),
      net: round2(p.income - p.expense),
    }
  })
}

/**
 * Category totals for one month, each compared to its own trailing average.
 *
 * The comparison is what makes the number actionable: an absolute total says how much was
 * spent, the delta says what actually changed.
 */
export function buildCategoryBreakdown(
  txns: readonly AnalyticsTxn[],
  month: string,
  direction: 'income' | 'expense' = 'expense',
  trailingMonths = 3
): { total: number; items: CategorySlice[] } {
  const trailing = previousMonths(month, trailingMonths)
  const trailingSet = new Set(trailing)

  const current = new Map<string, { total: number; count: number }>()
  const history = new Map<string, number>()

  for (const t of txns) {
    if (!isCountable(t) || t.direction !== direction) continue
    const label = t.category ?? CATEGORY_UNCATEGORIZED
    const key = monthKey(t.transactionDate)

    if (key === month) {
      const entry = current.get(label) ?? { total: 0, count: 0 }
      entry.total += t.amount
      entry.count += 1
      current.set(label, entry)
    } else if (trailingSet.has(key)) {
      history.set(label, (history.get(label) ?? 0) + t.amount)
    }
  }

  const total = [...current.values()].reduce((s, e) => s + e.total, 0)

  const items: CategorySlice[] = [...current.entries()]
    .map(([category, entry]) => {
      const trailingAvg = (history.get(category) ?? 0) / trailingMonths
      const deltaAbs = entry.total - trailingAvg
      return {
        category,
        total: round2(entry.total),
        count: entry.count,
        share: total > 0 ? round2((entry.total / total) * 100) : 0,
        trailingAvg: round2(trailingAvg),
        deltaAbs: round2(deltaAbs),
        deltaPct: trailingAvg > 0 ? round2((deltaAbs / trailingAvg) * 100) : null,
      }
    })
    .sort((a, b) => b.total - a.total)

  return { total: round2(total), items }
}

/**
 * Group repeating charges by normalized description.
 *
 * Cadence comes from the median gap between consecutive occurrences, not the mean, so a
 * single skipped or double-billed month does not reclassify a monthly commitment.
 */
export function detectRecurring(
  txns: readonly AnalyticsTxn[],
  opts: { minOccurrences?: number; lookbackMonths?: number; now?: Date } = {}
): { items: RecurringItem[]; monthlyFixedTotal: number } {
  const minOccurrences = opts.minOccurrences ?? 3
  const lookbackMonths = opts.lookbackMonths ?? 12
  const now = opts.now ?? new Date()
  const cutoff = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - lookbackMonths + 1, 1)
  ).getTime()

  const groups = new Map<string, AnalyticsTxn[]>()
  for (const t of txns) {
    if (t.direction !== 'expense' || !isCountable(t)) continue
    const time = new Date(t.transactionDate).getTime()
    if (Number.isNaN(time) || time < cutoff) continue
    const label = normalizeDescription(t.description)
    if (!label) continue
    const list = groups.get(label) ?? []
    list.push(t)
    groups.set(label, list)
  }

  const items: RecurringItem[] = []

  for (const [label, list] of groups) {
    if (list.length < minOccurrences) continue

    const sorted = [...list].sort(
      (a, b) => new Date(a.transactionDate).getTime() - new Date(b.transactionDate).getTime()
    )
    const gaps: number[] = []
    for (let i = 1; i < sorted.length; i++) {
      const gap =
        (new Date(sorted[i].transactionDate).getTime() -
          new Date(sorted[i - 1].transactionDate).getTime()) /
        MS_PER_DAY
      gaps.push(gap)
    }
    const medianGap = median(gaps)
    const cadence: 'monthly' | 'irregular' = medianGap >= 25 && medianGap <= 35 ? 'monthly' : 'irregular'

    const amounts = sorted.map((t) => t.amount)
    const avgAmount = amounts.reduce((s, a) => s + a, 0) / amounts.length
    const lastAmount = amounts[amounts.length - 1]
    const priorAmounts = amounts.slice(0, -1)
    const priorAvg = priorAmounts.length
      ? priorAmounts.reduce((s, a) => s + a, 0) / priorAmounts.length
      : 0
    const increasedPct =
      priorAvg > 0 && lastAmount > priorAvg * 1.1
        ? round2(((lastAmount - priorAvg) / priorAvg) * 100)
        : null

    const observedTotal = amounts.reduce((s, a) => s + a, 0)

    items.push({
      label,
      category: sorted[sorted.length - 1].category,
      occurrences: sorted.length,
      avgAmount: round2(avgAmount),
      lastAmount: round2(lastAmount),
      lastDate: sorted[sorted.length - 1].transactionDate,
      firstDate: sorted[0].transactionDate,
      cadence,
      annualizedCost: round2(
        cadence === 'monthly' ? avgAmount * 12 : (observedTotal / lookbackMonths) * 12
      ),
      increasedPct,
    })
  }

  items.sort((a, b) => b.annualizedCost - a.annualizedCost)

  const monthlyFixedTotal = round2(
    items.filter((i) => i.cadence === 'monthly').reduce((s, i) => s + i.avgAmount, 0)
  )

  return { items, monthlyFixedTotal }
}

function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

// ─── insight engine ─────────────────────────────────────────────────────────

/** Thresholds are named so the tests read as behaviour rather than magic numbers. */
export const INSIGHT_THRESHOLDS = {
  overspendRatio: 1.25,
  overspendMinDelta: 200,
  priceIncreaseRatio: 1.1,
  newRecurringDays: 60,
} as const

export function computeInsights(input: {
  month: string
  trend: readonly MonthlyPoint[]
  breakdown: { total: number; items: readonly CategorySlice[] }
  recurring: { items: readonly RecurringItem[]; monthlyFixedTotal: number }
  now?: Date
}): Insight[] {
  const { month, trend, breakdown, recurring } = input
  const now = input.now ?? new Date()
  const insights: Insight[] = []

  // Overspend per category — the delta is the point, not the total.
  for (const item of breakdown.items) {
    if (item.category === CATEGORY_UNCATEGORIZED) continue
    if (item.trailingAvg <= 0) continue
    if (item.total <= item.trailingAvg * INSIGHT_THRESHOLDS.overspendRatio) continue
    if (item.deltaAbs < INSIGHT_THRESHOLDS.overspendMinDelta) continue

    insights.push({
      id: `overspend:${item.category}`,
      kind: 'overspend',
      severity: 'warn',
      title: `${item.category} — ${shekels(item.deltaAbs)} מעל הרגיל`,
      body: `הוצאת ${shekels(item.total)} החודש, מול ממוצע ${shekels(item.trailingAvg)} בשלושת החודשים הקודמים (${item.deltaPct !== null ? `+${Math.round(item.deltaPct)}%` : 'עלייה'}).`,
      amount: item.deltaAbs,
      category: item.category,
      href: null,
    })
  }

  // Newly appeared recurring charge.
  for (const item of recurring.items) {
    const firstTime = new Date(item.firstDate).getTime()
    if (Number.isNaN(firstTime)) continue
    const ageDays = (now.getTime() - firstTime) / MS_PER_DAY
    if (ageDays > INSIGHT_THRESHOLDS.newRecurringDays) continue

    insights.push({
      id: `new_recurring:${item.label}`,
      kind: 'new_recurring',
      severity: 'info',
      title: `חיוב קבוע חדש: ${item.label}`,
      body: `זוהה לראשונה לפני ${Math.round(ageDays)} ימים, ${shekels(item.avgAmount)} בחיוב — ${shekels(item.annualizedCost)} בשנה.`,
      amount: item.annualizedCost,
      category: item.category,
      href: null,
    })
  }

  // Recurring charge that got more expensive.
  for (const item of recurring.items) {
    if (item.increasedPct === null) continue
    insights.push({
      id: `price_increase:${item.label}`,
      kind: 'price_increase',
      severity: 'warn',
      title: `${item.label} התייקר ב-${Math.round(item.increasedPct)}%`,
      body: `החיוב האחרון היה ${shekels(item.lastAmount)}, מול ${shekels(item.avgAmount)} בממוצע עד כה.`,
      amount: item.lastAmount,
      category: item.category,
      href: null,
    })
  }

  // How much of the income is committed before any choice is made.
  const trailingIncome = averageIncome(trend, month, 3)
  if (recurring.monthlyFixedTotal > 0 && trailingIncome > 0) {
    const pct = Math.round((recurring.monthlyFixedTotal / trailingIncome) * 100)
    insights.push({
      id: 'commitment_load',
      kind: 'commitment_load',
      severity: pct >= 60 ? 'warn' : 'info',
      title: `${pct}% מההכנסה מחויב מראש`,
      body: `חיובים קבועים של ${shekels(recurring.monthlyFixedTotal)} בחודש, מול הכנסה חודשית ממוצעת של ${shekels(trailingIncome)}.`,
      amount: recurring.monthlyFixedTotal,
      category: null,
      href: null,
    })
  }

  // Savings rate for the month, with direction of travel.
  const point = trend.find((p) => p.month === month)
  if (point && point.income > 0) {
    const rate = Math.round((point.net / point.income) * 100)
    const prior = trend.filter((p) => p.month < month && p.income > 0).slice(-3)
    const priorRate = prior.length
      ? Math.round(
          (prior.reduce((s, p) => s + p.net / p.income, 0) / prior.length) * 100
        )
      : null
    const direction =
      priorRate === null ? '' : rate > priorRate ? ` (עלייה מ-${priorRate}%)` : rate < priorRate ? ` (ירידה מ-${priorRate}%)` : ' (ללא שינוי)'

    insights.push({
      id: 'savings_rate',
      kind: 'savings_rate',
      severity: rate < 0 ? 'warn' : 'info',
      title: `שיעור חיסכון ${rate}%${direction}`,
      body: `נטו ${shekels(point.net)} מתוך הכנסה של ${shekels(point.income)} החודש.`,
      amount: point.net,
      category: null,
      href: null,
    })
  }

  // The single reduction opportunity: only discretionary commitments are cuttable.
  const discretionary = recurring.items.filter(
    (i) => i.category && DISCRETIONARY_CATEGORIES.includes(i.category)
  )
  const potential = discretionary.reduce((s, i) => s + i.annualizedCost, 0)
  if (potential > 0) {
    insights.push({
      id: 'savings_potential',
      kind: 'savings_potential',
      severity: 'opportunity',
      title: `פוטנציאל חיסכון ${shekels(potential)} בשנה`,
      body: `${discretionary.length} חיובים קבועים בקטגוריות שאפשר לצמצם: ${discretionary
        .slice(0, 3)
        .map((i) => i.label)
        .join(', ')}.`,
      amount: potential,
      category: null,
      href: null,
    })
  }

  const severityOrder = { opportunity: 0, warn: 1, info: 2 } as const
  return insights.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      Math.abs(b.amount ?? 0) - Math.abs(a.amount ?? 0)
  )
}

function averageIncome(trend: readonly MonthlyPoint[], month: string, count: number): number {
  const prior = trend.filter((p) => p.month <= month && p.income > 0).slice(-count)
  if (!prior.length) return 0
  return prior.reduce((s, p) => s + p.income, 0) / prior.length
}

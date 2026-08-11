import { CATEGORY_INVESTMENTS, isInternalCategory } from '@ak-system/types'
import { computeFifoPnl } from './pnl'
import { monthKey, monthWindow, previousMonths, type AnalyticsTxn } from './cashflow-analytics'
import type { JournalTrade } from './trading-insights'

/**
 * The cross-domain picture: bank, portfolio, runway, savings and currency exposure in one shape.
 *
 * Pure — no DB and no LLM, like its siblings. Two honesty rules shape the whole file:
 *
 * - Open positions are valued at **cost**, never at market. There is no price feed in the
 *   system, so `valuation: 'cost'` travels with the numbers and the UI must say so.
 * - Combining a shekel bank balance with a dollar portfolio needs an exchange rate, and
 *   nothing here publishes one. Without a supplied `usdIls`, `netWorth` and `fxExposure`
 *   are `null` rather than a quietly wrong sum of two different currencies.
 */

/** Days after which a scraped balance stops being "current". */
const STALE_BALANCE_DAYS = 7
const RUNWAY_TRAILING_MONTHS = 3
const BROKER_TREND_MONTHS = 6
const MS_PER_DAY = 86_400_000

export interface OverviewAccount {
  accountType: string // 'bank' | 'credit_card'
  balance: number | null
  balanceCurrency: string
  balanceUpdatedAt: string | null
}

export interface FinanceOverview {
  /** Shekel bank balances. Credit-card lines are excluded — their charges are already transactions. */
  bankTotal: number
  bankCurrency: string
  /** Weighted-average cost of everything still held. */
  portfolioCostBasis: number
  portfolioCurrency: string
  openPositions: number
  /** bank + portfolio, in shekels. null when no exchange rate was supplied. */
  netWorth: number | null
  /** Months of average spending the bank balance covers. null when there is no spending history. */
  runwayMonths: number | null
  avgMonthlyExpense: number
  /** Percent of this month's income that was not consumed (transfers to savings count as kept). */
  savingsRateInclInvest: number | null
  /** Of that, what actively moved to a broker or savings account this month. */
  investedThisMonth: number
  /** Share (0–1) of net worth denominated in USD. null without an exchange rate. */
  fxExposure: number | null
  brokerDepositsTrend: { month: string; amount: number }[]
  /** Freshest balance timestamp behind `bankTotal`. */
  asOf: string | null
  valuation: 'cost'
  /** No balance at all, or the freshest one is over a week old. */
  stale: boolean
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function isCountable(t: AnalyticsTxn): boolean {
  return !isInternalCategory(t.category)
}

function dominantTradeCurrency(trades: readonly JournalTrade[]): string {
  const counts = new Map<string, number>()
  for (const t of trades) {
    const c = (t.currency ?? '').trim().toUpperCase()
    if (!c) continue
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }
  let best = 'USD'
  let bestCount = 0
  for (const [c, n] of counts) {
    if (n > bestCount) {
      best = c
      bestCount = n
    }
  }
  return best
}

export function computeFinanceOverview(input: {
  accounts: readonly OverviewAccount[]
  trades: readonly JournalTrade[]
  txns: readonly AnalyticsTxn[]
  /** Shekels per 1 USD. Optional — the system has no market data source of its own. */
  usdIls?: number | null
  now?: Date
}): FinanceOverview {
  const now = input.now ?? new Date()
  const usdIls = input.usdIls && input.usdIls > 0 ? input.usdIls : null
  const currentMonth = monthKey(now.toISOString())

  // ─── bank ─────────────────────────────────────────────────────────────────
  const bankAccounts = input.accounts.filter(
    (a) => a.accountType === 'bank' && a.balance !== null && Number.isFinite(a.balance)
  )
  const ilsAccounts = bankAccounts.filter((a) => (a.balanceCurrency ?? 'ILS').toUpperCase() === 'ILS')
  const usdAccounts = bankAccounts.filter((a) => (a.balanceCurrency ?? '').toUpperCase() === 'USD')
  const bankTotal = round2(ilsAccounts.reduce((s, a) => s + (a.balance ?? 0), 0))
  const usdBankTotal = usdAccounts.reduce((s, a) => s + (a.balance ?? 0), 0)

  const timestamps = bankAccounts
    .map((a) => (a.balanceUpdatedAt ? new Date(a.balanceUpdatedAt).getTime() : NaN))
    .filter((n) => !Number.isNaN(n))
  const asOfTime = timestamps.length ? Math.max(...timestamps) : null
  const asOf = asOfTime === null ? null : new Date(asOfTime).toISOString()
  const stale = asOfTime === null || (now.getTime() - asOfTime) / MS_PER_DAY > STALE_BALANCE_DAYS

  // ─── portfolio (at cost) ──────────────────────────────────────────────────
  const { bySymbol } = computeFifoPnl(
    input.trades.map((t) => ({
      id: t.id,
      symbol: t.symbol,
      direction: t.direction,
      quantity: t.quantity,
      price: t.price,
      commission: t.commission ?? 0,
      tradeDate: t.tradeDate,
    }))
  )
  const open = Object.values(bySymbol).filter((s) => s.sharesOwned > 1e-9)
  const portfolioCostBasis = round2(open.reduce((s, p) => s + p.sharesOwned * p.avgCost, 0))
  const portfolioCurrency = dominantTradeCurrency(input.trades)

  // ─── runway ───────────────────────────────────────────────────────────────
  const trailing = new Set(previousMonths(currentMonth, RUNWAY_TRAILING_MONTHS))
  const expenseByMonth = new Map<string, number>()
  for (const t of input.txns) {
    if (t.direction !== 'expense' || !isCountable(t)) continue
    const bucket = monthKey(t.transactionDate)
    if (!trailing.has(bucket)) continue
    expenseByMonth.set(bucket, (expenseByMonth.get(bucket) ?? 0) + t.amount)
  }
  const avgMonthlyExpense = expenseByMonth.size
    ? round2([...expenseByMonth.values()].reduce((s, v) => s + v, 0) / expenseByMonth.size)
    : 0
  const runwayMonths = avgMonthlyExpense > 0 ? round2(bankTotal / avgMonthlyExpense) : null

  // ─── savings rate this month ──────────────────────────────────────────────
  let monthIncome = 0
  let monthExpense = 0
  let investedThisMonth = 0
  const brokerByMonth = new Map<string, number>()
  const trendWindow = monthWindow(BROKER_TREND_MONTHS, now)
  const trendSet = new Set(trendWindow)

  for (const t of input.txns) {
    const bucket = monthKey(t.transactionDate)
    if (t.category === CATEGORY_INVESTMENTS && t.direction === 'expense') {
      if (bucket === currentMonth) investedThisMonth += t.amount
      if (trendSet.has(bucket)) brokerByMonth.set(bucket, (brokerByMonth.get(bucket) ?? 0) + t.amount)
      continue
    }
    if (bucket !== currentMonth || !isCountable(t)) continue
    if (t.direction === 'income') monthIncome += t.amount
    else monthExpense += t.amount
  }

  const savingsRateInclInvest =
    monthIncome > 0 ? round2(((monthIncome - monthExpense) / monthIncome) * 100) : null

  // ─── currency exposure ────────────────────────────────────────────────────
  let netWorth: number | null = null
  let fxExposure: number | null = null
  if (usdIls) {
    const usdInIls = (portfolioCurrency === 'USD' ? portfolioCostBasis : 0) * usdIls + usdBankTotal * usdIls
    const nonUsd = bankTotal + (portfolioCurrency === 'USD' ? 0 : portfolioCostBasis)
    const total = usdInIls + nonUsd
    netWorth = round2(total)
    fxExposure = total > 0 ? round2(usdInIls / total) : null
  }

  return {
    bankTotal,
    bankCurrency: 'ILS',
    portfolioCostBasis,
    portfolioCurrency,
    openPositions: open.length,
    netWorth,
    runwayMonths,
    avgMonthlyExpense,
    savingsRateInclInvest,
    investedThisMonth: round2(investedThisMonth),
    fxExposure,
    brokerDepositsTrend: trendWindow.map((month) => ({
      month,
      amount: round2(brokerByMonth.get(month) ?? 0),
    })),
    asOf,
    valuation: 'cost',
    stale,
  }
}

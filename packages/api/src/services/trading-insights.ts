import { computeFifoPnl, type SellRealized, type TradeInput } from './pnl'
import { sortInsights, type Insight } from './cashflow-analytics'

/**
 * Pure trading-journal metrics + deterministic insight engine over FIFO realized P&L.
 *
 * No DB access and no LLM — every figure is reproducible from its inputs, following the
 * precedent of cashflow-analytics.ts. The FIFO matching itself lives in pnl.ts; this file
 * only interprets its output.
 *
 * Honesty rules (the data reality of partial IBKR email history):
 * - Win/loss statistics are computed over *fully matched* sells only. A sell with any
 *   unmatched quantity has a fabricated (zero) cost basis for that slice, so its P&L is
 *   not a real trade outcome. Unmatched sells are counted and surfaced, never averaged in.
 * - `profitFactor` is `null` (not Infinity) when there are no losing sells — a sentinel the
 *   UI renders as "אין הפסדים" rather than a fake huge number. It is also `null` when there
 *   are no matched sells at all. No metric ever contains NaN or Infinity.
 * - `commission` is unpopulated (0/null) on most imported trades, so when it is missing on
 *   more than half the period we emit a `data_quality` insight instead of pretending to
 *   know the commission drag.
 */

export type TradingPeriod = 'week' | 'month' | 'quarter' | 'all'

/** A finance_trades row after the text→number conversion the router already does. */
export interface JournalTrade {
  id?: string
  symbol: string
  direction: 'buy' | 'sell'
  quantity: number
  price: number
  /** null = the importer did not know the commission (most rows). 0 is treated the same. */
  commission: number | null
  currency?: string | null
  tradeDate: string
}

export interface TradingMetrics {
  /** Percent (0–100) of fully matched sells with positive P&L. null when none. */
  winRate: number | null
  /** Gross wins / gross losses. null when no matched sells or no losses (see header). */
  profitFactor: number | null
  avgWin: number | null
  /** Average losing P&L as a positive magnitude. null when there are no losses. */
  avgLoss: number | null
  /** Mean realized P&L per fully matched sell. */
  expectancy: number | null
  /** Peak-to-trough of cumulative realized P&L over matched sells, positive magnitude. */
  maxDrawdownRealized: number
  /** |P&L| share (0–1) of the single most dominant symbol. null when no realized P&L. */
  topSymbolPnlShare: number | null
  avgHoldingDays: number | null
  medianHoldingDays: number | null
  /** Coefficient of variation (std/mean) of trade notionals in the period. */
  positionSizeCv: number | null
  unmatchedSellsCount: number
  matchedSellsCount: number
}

export interface TradingDataQuality {
  /** Share (0–1) of period trades with unknown commission (null or 0). */
  commissionMissingShare: number
  unmatchedSellsCount: number
  matchedSellsCount: number
  basedOnMatchedLots: true
}

/** Thresholds are named so the tests read as behaviour rather than magic numbers. */
export const TRADING_INSIGHT_THRESHOLDS = {
  /** One symbol holding at least this |P&L| share triggers a concentration warning. */
  concentrationShare: 0.6,
  /** Concentration is meaningless with a single traded symbol. */
  concentrationMinSymbols: 2,
  /** Consecutive losing sells required before size-up counts as revenge trading. */
  revengeLossStreak: 3,
  /** The next trade's notional relative to the period median notional. */
  revengeSizeRatio: 1.5,
  /** Period trade count relative to the historical per-period average. */
  overtradingCountRatio: 2,
  /** Above this missing share, commission figures are declared unknowable. */
  commissionMissingShare: 0.5,
  /** Commissions eating at least this share of gross wins is worth a warning. */
  commissionDragShare: 0.1,
  /** Minimum matched sells before an edge summary is statistically worth showing. */
  edgeSummaryMinSells: 5,
} as const

const MS_PER_DAY = 86_400_000
/** Same breakeven epsilon as getSymbolRanking — sub-cent P&L is neither win nor loss. */
const PNL_EPS = 0.005
const QTY_EPS = 1e-9

const PERIOD_DAYS: Record<Exclude<TradingPeriod, 'all'>, number> = {
  week: 7,
  month: 30,
  quarter: 91,
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Inclusive lower-bound ISO timestamp for a period (empty = all-time), like periodSince in the router. */
export function tradingPeriodSince(period: TradingPeriod, now: Date = new Date()): string {
  if (period === 'week') {
    const d = new Date(now)
    d.setDate(d.getDate() - 7)
    return d.toISOString()
  }
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  if (period === 'quarter') return new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString()
  return ''
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Trades are mostly USD — format in the dominant trade currency, like shekels() for cash flow. */
function money(n: number, currency: string): string {
  try {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(Math.round(n))
  } catch {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(Math.round(n))
  }
}

function dominantCurrency(trades: readonly JournalTrade[]): string {
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

function toFifoInputs(trades: readonly JournalTrade[]): TradeInput[] {
  return trades.map((t) => ({
    id: t.id,
    symbol: t.symbol,
    direction: t.direction,
    quantity: t.quantity,
    price: t.price,
    commission: t.commission ?? 0,
    tradeDate: t.tradeDate,
  }))
}

/** Quantity-weighted holding time of a sell against its matched buy lots, in days. */
function sellHoldingDays(sell: SellRealized): number | null {
  const sellTime = new Date(sell.tradeDate).getTime()
  if (Number.isNaN(sellTime)) return null
  let qty = 0
  let weighted = 0
  for (const lot of sell.matchedLots) {
    const buyTime = new Date(lot.buyDate).getTime()
    if (Number.isNaN(buyTime)) continue
    qty += lot.quantity
    weighted += lot.quantity * Math.max(0, (sellTime - buyTime) / MS_PER_DAY)
  }
  return qty > 0 ? weighted / qty : null
}

// ─── metrics ────────────────────────────────────────────────────────────────

interface TradingAnalysis {
  metrics: TradingMetrics
  periodTrades: JournalTrade[]
  /** Period sells in chronological order, fully matched only. */
  matchedSells: SellRealized[]
  grossWins: number
  grossLosses: number
}

/**
 * FIFO runs over the full history so period sells still match against older buy lots;
 * only the statistics are restricted to the period.
 */
function analyzeTrades(trades: readonly JournalTrade[], since: string): TradingAnalysis {
  const { sells } = computeFifoPnl(toFifoInputs(trades))
  const periodTrades = trades.filter((t) => !since || t.tradeDate >= since)
  const periodSells = sells.filter((s) => !since || s.tradeDate >= since)
  const matchedSells = periodSells.filter((s) => s.unmatchedQuantity <= QTY_EPS)
  const unmatchedSellsCount = periodSells.length - matchedSells.length

  const wins = matchedSells.filter((s) => s.realizedPnl > PNL_EPS)
  const losses = matchedSells.filter((s) => s.realizedPnl < -PNL_EPS)
  const grossWins = wins.reduce((sum, s) => sum + s.realizedPnl, 0)
  const grossLosses = losses.reduce((sum, s) => sum + Math.abs(s.realizedPnl), 0)

  // Peak-to-trough of the cumulative realized curve (matched sells, chronological).
  let cumulative = 0
  let peak = 0
  let maxDrawdown = 0
  for (const s of matchedSells) {
    cumulative += s.realizedPnl
    if (cumulative > peak) peak = cumulative
    if (peak - cumulative > maxDrawdown) maxDrawdown = peak - cumulative
  }

  // |P&L| concentration by symbol.
  const pnlBySymbol = new Map<string, number>()
  for (const s of matchedSells) {
    pnlBySymbol.set(s.symbol, (pnlBySymbol.get(s.symbol) ?? 0) + s.realizedPnl)
  }
  const absTotal = [...pnlBySymbol.values()].reduce((sum, v) => sum + Math.abs(v), 0)
  const topAbs = Math.max(0, ...[...pnlBySymbol.values()].map((v) => Math.abs(v)))
  const topSymbolPnlShare = absTotal > PNL_EPS ? round2(topAbs / absTotal) : null

  const holdingDays = matchedSells
    .map(sellHoldingDays)
    .filter((d): d is number => d !== null)

  // Sizing dispersion over every trade in the period, buys included.
  const notionals = periodTrades.map((t) => t.quantity * t.price)
  const notionalMean = notionals.length
    ? notionals.reduce((s, n) => s + n, 0) / notionals.length
    : 0
  let positionSizeCv: number | null = null
  if (notionals.length >= 2 && notionalMean > 0) {
    const variance =
      notionals.reduce((s, n) => s + (n - notionalMean) ** 2, 0) / notionals.length
    positionSizeCv = round2(Math.sqrt(variance) / notionalMean)
  }

  const metrics: TradingMetrics = {
    winRate: matchedSells.length ? round1((wins.length / matchedSells.length) * 100) : null,
    profitFactor:
      matchedSells.length && grossLosses > 0 ? round2(grossWins / grossLosses) : null,
    avgWin: wins.length ? round2(grossWins / wins.length) : null,
    avgLoss: losses.length ? round2(grossLosses / losses.length) : null,
    expectancy: matchedSells.length
      ? round2(matchedSells.reduce((s, x) => s + x.realizedPnl, 0) / matchedSells.length)
      : null,
    maxDrawdownRealized: round2(maxDrawdown),
    topSymbolPnlShare,
    avgHoldingDays: holdingDays.length
      ? round1(holdingDays.reduce((s, d) => s + d, 0) / holdingDays.length)
      : null,
    medianHoldingDays: holdingDays.length ? round1(median(holdingDays)) : null,
    positionSizeCv,
    unmatchedSellsCount,
    matchedSellsCount: matchedSells.length,
  }

  return { metrics, periodTrades, matchedSells, grossWins, grossLosses }
}

export function computeTradingMetrics(
  trades: readonly JournalTrade[],
  opts: { since?: string } = {}
): TradingMetrics {
  return analyzeTrades(trades, opts.since ?? '').metrics
}

// ─── insight engine ─────────────────────────────────────────────────────────

export function computeTradingInsights(
  trades: readonly JournalTrade[],
  period: TradingPeriod,
  now: Date = new Date()
): { metrics: TradingMetrics; insights: Insight[]; dataQuality: TradingDataQuality } {
  const since = tradingPeriodSince(period, now)
  const { metrics, periodTrades, matchedSells, grossWins } = analyzeTrades(trades, since)
  const currency = dominantCurrency(periodTrades.length ? periodTrades : trades)
  const insights: Insight[] = []
  const T = TRADING_INSIGHT_THRESHOLDS

  // Concentration — one symbol carrying the realized result, for better or worse.
  const pnlBySymbol = new Map<string, number>()
  for (const s of matchedSells) {
    pnlBySymbol.set(s.symbol, (pnlBySymbol.get(s.symbol) ?? 0) + s.realizedPnl)
  }
  if (
    pnlBySymbol.size >= T.concentrationMinSymbols &&
    metrics.topSymbolPnlShare !== null &&
    metrics.topSymbolPnlShare >= T.concentrationShare
  ) {
    const [topSymbol, topPnl] = [...pnlBySymbol.entries()].sort(
      (a, b) => Math.abs(b[1]) - Math.abs(a[1])
    )[0]
    insights.push({
      id: `concentration:${topSymbol}`,
      kind: 'concentration',
      severity: 'warn',
      title: `ריכוזיות: ${topSymbol} מרכז ${Math.round(metrics.topSymbolPnlShare * 100)}% מה-P&L`,
      body: `${money(topPnl, currency)} מה-P&L הממומש בתקופה מגיע מ-${topSymbol} בלבד (מתוך ${pnlBySymbol.size} סימבולים). התוצאה תלויה בפוזיציה אחת, לא בשיטה.`,
      amount: round2(topPnl),
      category: topSymbol,
      href: null,
    })
  }

  // Revenge pattern — a losing streak followed by a size-up.
  // Events and FIFO sells are both stable-sorted by tradeDate from the same source array,
  // so walking a queue of period sells stays aligned with the sell events.
  const events = [...periodTrades].sort((a, b) =>
    a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0
  )
  const periodSellsQueue = matchedSellsQueue(trades, since)
  const medianNotional = median(events.map((t) => t.quantity * t.price))
  let lossStreak = 0
  let revenge: { notional: number; streak: number } | null = null
  let queueIdx = 0
  for (const t of events) {
    const notional = t.quantity * t.price
    if (
      !revenge &&
      lossStreak >= T.revengeLossStreak &&
      medianNotional > 0 &&
      notional >= medianNotional * T.revengeSizeRatio
    ) {
      revenge = { notional, streak: lossStreak }
    }
    if (t.direction === 'sell') {
      const sell = periodSellsQueue[queueIdx++]
      if (sell && sell.unmatchedQuantity <= QTY_EPS) {
        if (sell.realizedPnl < -PNL_EPS) lossStreak += 1
        else if (sell.realizedPnl > PNL_EPS) lossStreak = 0
      }
    }
  }
  if (revenge) {
    insights.push({
      id: 'revenge_pattern',
      kind: 'revenge_pattern',
      severity: 'warn',
      title: `דפוס revenge trading: הגדלת פוזיציה אחרי ${revenge.streak} הפסדים רצופים`,
      body: `אחרי רצף של ${revenge.streak} מכירות מופסדות נפתחה עסקה בהיקף ${money(revenge.notional, currency)} — פי ${T.revengeSizeRatio} ומעלה מהחציון התקופתי (${money(medianNotional, currency)}). דפוס שמגדיל סיכון בדיוק ברגע הכי רגיש.`,
      amount: round2(revenge.notional),
      category: null,
      href: null,
    })
  }

  // Overtrading — trading twice the usual pace while losing. Needs a baseline, so it is
  // only evaluated for bounded periods with at least two periods' worth of history.
  if (period !== 'all' && trades.length > 0) {
    const times = trades
      .map((t) => new Date(t.tradeDate).getTime())
      .filter((n) => !Number.isNaN(n))
    if (times.length > 0) {
      const spanDays = (now.getTime() - Math.min(...times)) / MS_PER_DAY
      const numPeriods = spanDays / PERIOD_DAYS[period]
      const periodRealized = matchedSells.reduce((s, x) => s + x.realizedPnl, 0)
      if (numPeriods >= 2) {
        const avgPerPeriod = trades.length / numPeriods
        if (
          avgPerPeriod > 0 &&
          periodTrades.length >= avgPerPeriod * T.overtradingCountRatio &&
          periodRealized < -PNL_EPS
        ) {
          insights.push({
            id: 'overtrading',
            kind: 'overtrading',
            severity: 'warn',
            title: `Over-trading: ${periodTrades.length} עסקאות בתקופה מופסדת`,
            body: `בוצעו ${periodTrades.length} עסקאות מול ממוצע של ${round1(avgPerPeriod)} לתקופה — פי ${T.overtradingCountRatio} ומעלה — וה-P&L הממומש שלילי (${money(periodRealized, currency)}). יותר פעילות, פחות תוצאה.`,
            amount: round2(periodRealized),
            category: null,
            href: null,
          })
        }
      }
    }
  }

  // Commission: either an honest drag figure or an honest admission of blindness.
  const commissionMissing = periodTrades.filter(
    (t) => t.commission == null || t.commission === 0
  ).length
  const commissionMissingShare = periodTrades.length
    ? round2(commissionMissing / periodTrades.length)
    : 0
  if (periodTrades.length > 0 && commissionMissingShare > T.commissionMissingShare) {
    insights.push({
      id: 'data_quality:commission',
      kind: 'data_quality',
      severity: 'info',
      title: `עמלות חסרות ב-${Math.round(commissionMissingShare * 100)}% מהעסקאות`,
      body: `לא ניתן לחשב commission drag אמין — נתון העמלה חסר ב-${commissionMissing} מתוך ${periodTrades.length} עסקאות בתקופה. ה-P&L המוצג אינו כולל את העמלות החסרות.`,
      amount: null,
      category: null,
      href: null,
    })
  } else if (periodTrades.length > 0) {
    const totalCommission = periodTrades.reduce((s, t) => s + (t.commission ?? 0), 0)
    if (grossWins > 0 && totalCommission / grossWins >= T.commissionDragShare) {
      insights.push({
        id: 'commission_drag',
        kind: 'commission_drag',
        severity: 'warn',
        title: `עמלות שוחקות ${Math.round((totalCommission / grossWins) * 100)}% מהרווח הגולמי`,
        body: `${money(totalCommission, currency)} עמלות בתקופה, מול רווח גולמי של ${money(grossWins, currency)}. שווה לבדוק תדירות מסחר וגדלי פוזיציה.`,
        amount: round2(totalCommission),
        category: null,
        href: null,
      })
    }
  }

  // Unmatched sells — partial buy history means partial truth. Say so.
  if (metrics.unmatchedSellsCount > 0) {
    insights.push({
      id: 'data_quality:unmatched_lots',
      kind: 'data_quality',
      severity: 'info',
      title: `${metrics.unmatchedSellsCount} מכירות ללא היסטוריית קנייה תואמת`,
      body: `למכירות אלה אין lot קנייה מיובא, ולכן עלות הבסיס שלהן חלקית. כל המדדים מחושבים על ${metrics.matchedSellsCount} המכירות התואמות בלבד.`,
      amount: null,
      category: null,
      href: null,
    })
  }

  // Positive edge summary — the "am I actually profitable" card.
  if (
    metrics.matchedSellsCount >= T.edgeSummaryMinSells &&
    metrics.winRate !== null &&
    metrics.expectancy !== null
  ) {
    const pf =
      metrics.profitFactor !== null ? `Profit factor ${metrics.profitFactor}` : 'ללא הפסדים בתקופה'
    insights.push({
      id: 'edge_summary',
      kind: 'edge_summary',
      severity: 'info',
      title: `Win rate ${metrics.winRate}% · תוחלת ${money(metrics.expectancy, currency)} לעסקה`,
      body: `${metrics.matchedSellsCount} מכירות תואמות בתקופה. ${pf}${metrics.avgWin !== null ? `, רווח ממוצע ${money(metrics.avgWin, currency)}` : ''}${metrics.avgLoss !== null ? `, הפסד ממוצע ${money(metrics.avgLoss, currency)}` : ''}.`,
      amount: metrics.expectancy,
      category: null,
      href: null,
    })
  }

  sortInsights(insights)

  return {
    metrics,
    insights,
    dataQuality: {
      commissionMissingShare,
      unmatchedSellsCount: metrics.unmatchedSellsCount,
      matchedSellsCount: metrics.matchedSellsCount,
      basedOnMatchedLots: true,
    },
  }
}

/** All period sells (matched or not) in FIFO chronological order — for streak walking. */
function matchedSellsQueue(trades: readonly JournalTrade[], since: string): SellRealized[] {
  const { sells } = computeFifoPnl(toFifoInputs(trades))
  return sells.filter((s) => !since || s.tradeDate >= since)
}

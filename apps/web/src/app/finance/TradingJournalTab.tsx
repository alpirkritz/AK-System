'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import { InsightCard } from './components/InsightCard'
import { TradingMetricCard } from './components/TradingMetricCard'

type Period = 'today' | 'week' | 'month' | 'quarter' | 'all'

/** The insight engine has no notion of a single day — one session is never a statistic. */
type InsightPeriod = 'week' | 'month' | 'quarter' | 'all'

const PERIODS: [Period, string][] = [
  ['today', 'היום'],
  ['week', 'השבוע'],
  ['month', 'החודש'],
  ['quarter', 'הרבעון'],
  ['all', 'הכל'],
]

/** 'today' has too few trades to say anything about an edge, so it reads the week instead. */
function insightPeriod(period: Period): InsightPeriod {
  return period === 'today' ? 'week' : period
}

const GREEN = '#34d399'
const RED = '#fb7185'

function fmtUsd(n: number): string {
  return new Intl.NumberFormat('he-IL', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

function fmtSignedUsd(n: number): string {
  return `${n >= 0 ? '+' : ''}${fmtUsd(n)}`
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('he-IL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    })
  } catch {
    return iso
  }
}

function fmtDateTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString('he-IL', {
      day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function pnlColor(n: number): string {
  return n >= 0 ? GREEN : RED
}

function SyncBadge({ status }: { status: string | null }) {
  if (status === 'ok') return <span className="pill text-xs" style={{ color: GREEN, borderColor: `${GREEN}44` }}>✓ הצליח</span>
  if (status === 'error') return <span className="pill text-xs" style={{ color: RED, borderColor: `${RED}44` }}>✗ נכשל</span>
  return <span className="pill text-xs" style={{ color: '#647399' }}>— טרם רץ</span>
}

export default function TradingJournalTab() {
  const [period, setPeriod] = useState<Period>('today')

  const { data: journal, isLoading: journalLoading } = trpc.finance.getTradingJournal.useQuery({ period })
  const { data: ranking, isLoading: rankingLoading } = trpc.finance.getSymbolRanking.useQuery({ period, limit: 5 })
  const { data: analysis, isLoading: analysisLoading } =
    trpc.finance.analytics.tradingInsights.useQuery({ period: insightPeriod(period) })

  const realizedPnl = journal?.realizedPnl ?? 0

  return (
    <div>
      {/* Period filter */}
      <div className="flex gap-2 mb-5">
        {PERIODS.map(([id, label]) => (
          <button
            key={id}
            className="btn btn-ghost text-xs"
            style={{
              color: period === id ? '#2dd4bf' : '#647399',
              borderColor: period === id ? '#2dd4bf44' : '#2f4368',
            }}
            onClick={() => setPeriod(id)}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <div className="card flex flex-col gap-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">📈</span>
            <span className="text-xs text-[#647399] font-medium">עסקאות בתקופה</span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-[#eef3fb]">
            {journalLoading ? '...' : journal?.tradesCount ?? 0}
          </div>
        </div>

        <div className="card flex flex-col gap-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">💰</span>
            <span className="text-xs text-[#647399] font-medium">P&L ממומש</span>
          </div>
          <div className="text-2xl font-bold tracking-tight" style={{ color: pnlColor(realizedPnl) }}>
            {journalLoading ? '...' : fmtSignedUsd(realizedPnl)}
          </div>
        </div>

        <div className="card flex flex-col gap-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🔄</span>
            <span className="text-xs text-[#647399] font-medium">קניות / מכירות</span>
          </div>
          <div className="text-sm font-bold tracking-tight">
            <span style={{ color: RED }}>{journalLoading ? '...' : fmtUsd(journal?.buysNotional ?? 0)}</span>
            <span className="text-[#5a688c] mx-1">/</span>
            <span style={{ color: GREEN }}>{journalLoading ? '...' : fmtUsd(journal?.sellsNotional ?? 0)}</span>
          </div>
        </div>

        <div className="card flex flex-col gap-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🕐</span>
            <span className="text-xs text-[#647399] font-medium">סנכרון אחרון</span>
          </div>
          <div className="text-sm font-bold tracking-tight text-[#eef3fb]">
            {fmtDateTime(journal?.lastSync?.at ?? null)}
          </div>
          <div className="mt-1"><SyncBadge status={journal?.lastSync?.status ?? null} /></div>
        </div>
      </div>

      {/* Trading insights */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-[#7a89ab] mb-3 uppercase tracking-wider">
          תובנות מסחר
          {period === 'today' && <span className="normal-case text-[#5a688c]"> · לפי השבוע האחרון</span>}
        </h2>
        {analysisLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="skeleton h-24 rounded-xl" />
            ))}
          </div>
        ) : !analysis || analysis.metrics.matchedSellsCount === 0 ? (
          <div className="card text-center py-10">
            <div className="text-[#5a688c] text-sm">אין עדיין מכירות סגורות למדוד לפיהן</div>
            <div className="text-xs text-[#4d659c] mt-1">
              המדדים מחושבים על מכירות שהותאמו לקנייה קודמת (FIFO)
            </div>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
              <TradingMetricCard
                label="אחוז הצלחה"
                value={analysis.metrics.winRate === null ? null : `${analysis.metrics.winRate}%`}
                hint={`מתוך ${analysis.metrics.matchedSellsCount} מכירות סגורות בתקופה`}
                color={
                  analysis.metrics.winRate !== null && analysis.metrics.winRate >= 50 ? GREEN : RED
                }
                emphasis
              />
              <TradingMetricCard
                label="Profit factor"
                value={analysis.metrics.profitFactor === null ? null : String(analysis.metrics.profitFactor)}
                hint={
                  analysis.metrics.profitFactor === null
                    ? 'אין הפסדים בתקופה, אז אין ביחס למה למדוד'
                    : 'סך הרווחים חלקי סך ההפסדים. מעל 1 = רווחי'
                }
                color={
                  analysis.metrics.profitFactor !== null && analysis.metrics.profitFactor >= 1
                    ? GREEN
                    : RED
                }
                emphasis
              />
              <TradingMetricCard
                label="תוחלת לעסקה"
                value={analysis.metrics.expectancy === null ? null : fmtSignedUsd(analysis.metrics.expectancy)}
                hint="כמה מכניסה בממוצע מכירה סגורה אחת"
                color={
                  analysis.metrics.expectancy !== null && analysis.metrics.expectancy >= 0 ? GREEN : RED
                }
              />
              <TradingMetricCard
                label="ירידה מקסימלית"
                value={fmtUsd(analysis.metrics.maxDrawdownRealized)}
                hint="הנפילה הגדולה ביותר מהשיא בעקומת ה-P&L הממומש"
                color={analysis.metrics.maxDrawdownRealized > 0 ? RED : undefined}
              />
            </div>

            {/* Blind spots are about the data, not the trading — same banner treatment as
                the coverage warnings on the insights tab. */}
            {analysis.insights
              .filter((i) => i.kind === 'data_quality')
              .map((insight) => (
                <div
                  key={insight.id}
                  className="mb-3 text-xs px-3 py-2.5 rounded-lg"
                  style={{ background: '#fbbf2411', color: '#fbbf24', border: '1px solid #fbbf2433' }}
                >
                  <span className="font-semibold">{insight.title}</span>
                  <span className="opacity-90"> — {insight.body}</span>
                </div>
              ))}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {analysis.insights
                .filter((i) => i.kind !== 'data_quality')
                .map((insight) => (
                  <InsightCard key={insight.id} insight={insight} />
                ))}
            </div>
          </>
        )}
      </div>

      {/* Period trades */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-[#7a89ab] mb-3 uppercase tracking-wider">
          עסקאות התקופה ({journal?.tradesCount ?? 0})
        </h2>
        {journalLoading ? (
          <div className="text-[#5a688c] text-sm">טוען...</div>
        ) : !journal || journal.trades.length === 0 ? (
          <div className="card text-center py-12">
            <div className="text-4xl mb-3">📭</div>
            <div className="text-[#5a688c] text-sm">אין עסקאות בתקופה זו</div>
            <div className="text-xs text-[#4d659c] mt-1">העסקאות יופיעו אחרי סנכרון מיילי IBKR</div>
          </div>
        ) : (
          <div className="card p-0 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-[#29395d]">
                  {['תאריך', 'סימבול', 'פעולה', 'כמות', 'מחיר', 'P&L'].map((h) => (
                    <th key={h} className="text-right px-4 py-3 text-[11px] font-medium text-[#5a688c] uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {journal.trades.map((t) => (
                  <tr key={t.id} className="border-b border-[#1d2b46] hover:bg-[#1d2b46] transition-colors">
                    <td className="px-4 py-3 text-[#647399]">{fmtDate(t.tradeDate)}</td>
                    <td className="px-4 py-3 font-bold text-[#2dd4bf]">{t.symbol}</td>
                    <td className="px-4 py-3">
                      <span
                        className="pill text-xs font-semibold"
                        style={{
                          color: t.direction === 'buy' ? GREEN : RED,
                          borderColor: t.direction === 'buy' ? `${GREEN}44` : `${RED}44`,
                        }}
                      >
                        {t.direction === 'buy' ? '▲ קנייה' : '▼ מכירה'}
                      </span>
                    </td>
                    <td className="px-4 py-3">{t.quantity.toLocaleString()}</td>
                    <td className="px-4 py-3">${t.price.toFixed(2)}</td>
                    <td className="px-4 py-3 font-semibold" style={{ color: t.realizedPnl != null ? pnlColor(t.realizedPnl) : '#5a688c' }}>
                      {t.realizedPnl != null ? fmtSignedUsd(t.realizedPnl) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Winners / losers ranking */}
      <div>
        <h2 className="text-sm font-semibold text-[#7a89ab] mb-3 uppercase tracking-wider">
          איפה הרווחתי ואיפה הפסדתי
        </h2>
        {rankingLoading ? (
          <div className="text-[#5a688c] text-sm">טוען...</div>
        ) : !ranking || (ranking.winners.length === 0 && ranking.losers.length === 0) ? (
          <div className="card text-center py-12">
            <div className="text-4xl mb-3">📊</div>
            <div className="text-[#5a688c] text-sm">אין מספיק מכירות ממומשות לדירוג עדיין</div>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <RankingColumn title="מנצחים" color={GREEN} entries={ranking.winners} />
            <RankingColumn title="מפסידים" color={RED} entries={ranking.losers} />
          </div>
        )}
      </div>
    </div>
  )
}

function RankingColumn({
  title, color, entries,
}: {
  title: string
  color: string
  entries: Array<{ symbol: string; realizedPnl: number }>
}) {
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-[#29395d] text-sm font-semibold" style={{ color }}>
        {title}
      </div>
      {entries.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-[#5a688c]">אין נתונים</div>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {entries.map((e) => (
              <tr key={e.symbol} className="border-b border-[#1d2b46] last:border-0">
                <td className="px-4 py-3 font-bold text-[#2dd4bf]">{e.symbol}</td>
                <td className="px-4 py-3 text-left font-semibold" style={{ color }}>
                  {fmtSignedUsd(e.realizedPnl)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

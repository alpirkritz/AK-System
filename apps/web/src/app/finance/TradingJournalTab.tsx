'use client'

import { useState } from 'react'
import { trpc } from '@/lib/trpc'

type Period = 'today' | 'week' | 'month' | 'all'

const PERIODS: [Period, string][] = [
  ['today', 'היום'],
  ['week', 'השבוע'],
  ['month', 'החודש'],
  ['all', 'הכל'],
]

const GREEN = '#47b86e'
const RED = '#e8477a'

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
  return <span className="pill text-xs" style={{ color: '#666' }}>— טרם רץ</span>
}

export default function TradingJournalTab() {
  const [period, setPeriod] = useState<Period>('today')

  const { data: journal, isLoading: journalLoading } = trpc.finance.getTradingJournal.useQuery({ period })
  const { data: ranking, isLoading: rankingLoading } = trpc.finance.getSymbolRanking.useQuery({ period, limit: 5 })

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
              color: period === id ? '#e8c547' : '#666',
              borderColor: period === id ? '#e8c54744' : '#2a2a2a',
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
            <span className="text-xs text-[#666] font-medium">עסקאות בתקופה</span>
          </div>
          <div className="text-2xl font-bold tracking-tight text-[#f0ede6]">
            {journalLoading ? '...' : journal?.tradesCount ?? 0}
          </div>
        </div>

        <div className="card flex flex-col gap-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">💰</span>
            <span className="text-xs text-[#666] font-medium">P&L ממומש</span>
          </div>
          <div className="text-2xl font-bold tracking-tight" style={{ color: pnlColor(realizedPnl) }}>
            {journalLoading ? '...' : fmtSignedUsd(realizedPnl)}
          </div>
        </div>

        <div className="card flex flex-col gap-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🔄</span>
            <span className="text-xs text-[#666] font-medium">קניות / מכירות</span>
          </div>
          <div className="text-sm font-bold tracking-tight">
            <span style={{ color: RED }}>{journalLoading ? '...' : fmtUsd(journal?.buysNotional ?? 0)}</span>
            <span className="text-[#555] mx-1">/</span>
            <span style={{ color: GREEN }}>{journalLoading ? '...' : fmtUsd(journal?.sellsNotional ?? 0)}</span>
          </div>
        </div>

        <div className="card flex flex-col gap-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-lg">🕐</span>
            <span className="text-xs text-[#666] font-medium">סנכרון אחרון</span>
          </div>
          <div className="text-sm font-bold tracking-tight text-[#f0ede6]">
            {fmtDateTime(journal?.lastSync?.at ?? null)}
          </div>
          <div className="mt-1"><SyncBadge status={journal?.lastSync?.status ?? null} /></div>
        </div>
      </div>

      {/* Period trades */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-[#888] mb-3 uppercase tracking-wider">
          עסקאות התקופה ({journal?.tradesCount ?? 0})
        </h2>
        {journalLoading ? (
          <div className="text-[#555] text-sm">טוען...</div>
        ) : !journal || journal.trades.length === 0 ? (
          <div className="card text-center py-12">
            <div className="text-4xl mb-3">📭</div>
            <div className="text-[#555] text-sm">אין עסקאות בתקופה זו</div>
            <div className="text-xs text-[#444] mt-1">העסקאות יופיעו אחרי סנכרון מיילי IBKR</div>
          </div>
        ) : (
          <div className="card p-0 overflow-hidden overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="border-b border-[#222]">
                  {['תאריך', 'סימבול', 'פעולה', 'כמות', 'מחיר', 'P&L'].map((h) => (
                    <th key={h} className="text-right px-4 py-3 text-[11px] font-medium text-[#555] uppercase">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {journal.trades.map((t) => (
                  <tr key={t.id} className="border-b border-[#1a1a1a] hover:bg-[#1a1a1a] transition-colors">
                    <td className="px-4 py-3 text-[#666]">{fmtDate(t.tradeDate)}</td>
                    <td className="px-4 py-3 font-bold text-[#e8c547]">{t.symbol}</td>
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
                    <td className="px-4 py-3 font-semibold" style={{ color: t.realizedPnl != null ? pnlColor(t.realizedPnl) : '#555' }}>
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
        <h2 className="text-sm font-semibold text-[#888] mb-3 uppercase tracking-wider">
          איפה הרווחתי ואיפה הפסדתי
        </h2>
        {rankingLoading ? (
          <div className="text-[#555] text-sm">טוען...</div>
        ) : !ranking || (ranking.winners.length === 0 && ranking.losers.length === 0) ? (
          <div className="card text-center py-12">
            <div className="text-4xl mb-3">📊</div>
            <div className="text-[#555] text-sm">אין מספיק מכירות ממומשות לדירוג עדיין</div>
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
      <div className="px-4 py-3 border-b border-[#222] text-sm font-semibold" style={{ color }}>
        {title}
      </div>
      {entries.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-[#555]">אין נתונים</div>
      ) : (
        <table className="w-full text-sm">
          <tbody>
            {entries.map((e) => (
              <tr key={e.symbol} className="border-b border-[#1a1a1a] last:border-0">
                <td className="px-4 py-3 font-bold text-[#e8c547]">{e.symbol}</td>
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

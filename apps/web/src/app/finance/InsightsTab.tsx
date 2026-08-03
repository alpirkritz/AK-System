'use client'

import { useMemo, useState } from 'react'
import { trpc } from '@/lib/trpc'
import { SummaryCard } from './SummaryCard'
import { MonthlyTrendChart } from './components/MonthlyTrendChart'
import { CategoryDonut } from './components/CategoryDonut'
import { CategoryBreakdownList } from './components/CategoryBreakdownList'
import { RecurringList } from './components/RecurringList'
import { InsightCard } from './components/InsightCard'
import { CategorizeDrawer } from './components/CategorizeDrawer'
import { currentMonthKey, fmt, monthLabel, shiftMonth } from './lib/format'

type Window = 3 | 6 | 12

const MAX_VISIBLE_INSIGHTS = 6

/** Above this share of expense value missing a category, nothing on screen can be trusted. */
const COVERAGE_WARN_SHARE = 10

export default function InsightsTab() {
  const [month, setMonth] = useState(currentMonthKey())
  const [window, setWindow] = useState<Window>(12)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [showAllInsights, setShowAllInsights] = useState(false)

  const coverage = trpc.finance.analytics.coverage.useQuery()
  const trend = trpc.finance.analytics.monthlyTrend.useQuery({ months: window })
  const breakdown = trpc.finance.analytics.categoryBreakdown.useQuery({ month, direction: 'expense' })
  const recurring = trpc.finance.analytics.recurring.useQuery({ minOccurrences: 3, lookbackMonths: 12 })
  const insights = trpc.finance.analytics.insights.useQuery({ month })

  const point = useMemo(
    () => trend.data?.months.find((p) => p.month === month) ?? null,
    [trend.data, month]
  )

  const hasCategorized =
    !!coverage.data && coverage.data.totalTransactions > coverage.data.uncategorizedCount

  const coverageClean =
    !!coverage.data &&
    coverage.data.uncategorizedShare <= COVERAGE_WARN_SHARE &&
    coverage.data.uncategorizedCount === 0

  const partialData =
    !!coverage.data && coverage.data.uncategorizedShare > COVERAGE_WARN_SHARE

  // Nothing categorized yet: charts would all be empty frames, so the tab is an onboarding
  // surface instead of a dashboard with nothing in it.
  if (coverage.isLoading) {
    return <LoadingState />
  }

  if (coverage.data && coverage.data.totalTransactions === 0) {
    return (
      <EmptyState
        title="אין עדיין תנועות"
        body="חבר חשבון בנק או כרטיס אשראי בטאב החשבונות, והתזרים יופיע כאן."
      />
    )
  }

  if (!hasCategorized) {
    return (
      <>
        <div className="card max-w-xl">
          <div className="text-lg font-bold tracking-tight mb-2">בוא נבין על מה הכסף הולך</div>
          <p className="text-sm text-[#97a4c2] leading-relaxed mb-4">
            יש {coverage.data?.uncategorizedCount} תנועות שממתינות לסיווג. אחרי הסיווג תראה כאן
            פילוח הוצאות, מגמה חודשית, חיובים קבועים ותובנות איפה אפשר לצמצם.
          </p>
          <button className="btn btn-primary" onClick={() => setDrawerOpen(true)}>
            סווג אוטומטית
          </button>
        </div>
        <CategorizeDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </>
    )
  }

  const visibleInsights = showAllInsights
    ? insights.data?.insights ?? []
    : (insights.data?.insights ?? []).slice(0, MAX_VISIBLE_INSIGHTS)

  return (
    <>
      {/* Data-quality banners. Rendered only here — never repeated as insight cards. */}
      {partialData && (
        <div
          className="mb-4 text-xs px-3 py-2.5 rounded-lg flex flex-wrap items-center gap-x-3 gap-y-2"
          style={{ background: '#fbbf2411', color: '#fbbf24', border: '1px solid #fbbf2433' }}
        >
          <span>
            ל-{coverage.data!.uncategorizedCount} תנועות אין קטגוריה ({coverage.data!.uncategorizedShare}%
            מההוצאות). הפילוח חלקי עד שיסווגו.
          </span>
          <button className="btn btn-ghost" onClick={() => setDrawerOpen(true)}>
            סווג אוטומטית
          </button>
        </div>
      )}

      {coverage.data && !coverage.data.creditCardConnected && coverage.data.hiddenCardShare > 0 && (
        <div
          className="mb-4 text-xs px-3 py-2.5 rounded-lg flex flex-wrap items-center gap-x-3 gap-y-2"
          style={{ background: '#fb718511', color: '#fb7185', border: '1px solid #fb718533' }}
        >
          <span>
            {coverage.data.hiddenCardShare}% מההוצאות מוסתרות מאחורי חיוב אשראי אחד. חבר את כרטיס
            האשראי כדי לראות על מה באמת יצא הכסף.
          </span>
          <a className="btn btn-ghost" href="/finance?tab=accounts">
            חבר כרטיס
          </a>
        </div>
      )}

      {/* Month selector */}
      <div className="flex items-center gap-2 mb-4">
        <button
          className="btn btn-ghost"
          style={{ minWidth: 44, minHeight: 44 }}
          onClick={() => setMonth(shiftMonth(month, -1))}
          aria-label="חודש קודם"
        >
          ›
        </button>
        <span className="text-sm font-semibold text-[#eef3fb] min-w-[120px] text-center">
          {monthLabel(month)}
        </span>
        <button
          className="btn btn-ghost"
          style={{ minWidth: 44, minHeight: 44 }}
          onClick={() => setMonth(shiftMonth(month, 1))}
          disabled={month >= currentMonthKey()}
          aria-label="חודש הבא"
        >
          ‹
        </button>
        {partialData && (
          <span className="text-[11px] text-[#fbbf24] ms-2">מבוסס על נתונים חלקיים</span>
        )}
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        <SummaryCard icon="⬆️" label="הכנסות" value={point ? fmt(point.income) : '—'} color="#34d399" />
        <SummaryCard icon="⬇️" label="הוצאות" value={point ? fmt(point.expense) : '—'} color="#fb7185" />
        <SummaryCard
          icon="⚖️"
          label="נטו"
          value={point ? fmt(point.net) : '—'}
          color={point && point.net < 0 ? '#fb7185' : '#34d399'}
        />
        {/* Withheld until coverage is clean: a wrong headline number is worse than none. */}
        <SummaryCard
          icon="🎯"
          label="שיעור חיסכון"
          value={
            coverageClean && point && point.income > 0
              ? `${Math.round((point.net / point.income) * 100)}%`
              : '—'
          }
          sub={coverageClean ? undefined : 'זמין אחרי סיווג התנועות'}
        />
      </div>

      {/* Trend */}
      <div className="card mb-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-semibold">מגמה חודשית</h3>
          <div className="flex items-center gap-1.5">
            {([3, 6, 12] as Window[]).map((w) => (
              <button
                key={w}
                className="toggle-btn"
                aria-pressed={window === w}
                onClick={() => setWindow(w)}
              >
                {w} חודשים
              </button>
            ))}
          </div>
        </div>
        {trend.isLoading ? (
          <div className="skeleton h-[220px] rounded-lg" />
        ) : (
          <MonthlyTrendChart
            points={trend.data?.months ?? []}
            selectedMonth={month}
            onSelectMonth={setMonth}
          />
        )}
      </div>

      {/* Breakdown list gets the wider column: on bank-level data it carries more signal
          than the donut, which is dominated by the credit-card slice. */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4 mb-5">
        <div className="card lg:col-span-3">
          <h3 className="text-sm font-semibold mb-3">לפי קטגוריה</h3>
          {breakdown.isLoading ? (
            <div className="flex flex-col gap-2">
              {[0, 1, 2, 3, 4].map((i) => (
                <div key={i} className="skeleton h-9 rounded-lg" />
              ))}
            </div>
          ) : (
            <CategoryBreakdownList items={breakdown.data?.items ?? []} />
          )}
        </div>
        <div className="card lg:col-span-2">
          <h3 className="text-sm font-semibold mb-3">הרכב ההוצאות</h3>
          {breakdown.isLoading ? (
            <div className="skeleton h-[240px] rounded-full mx-auto max-w-[240px]" />
          ) : (
            <CategoryDonut
              slices={breakdown.data?.items ?? []}
              total={breakdown.data?.total ?? 0}
            />
          )}
        </div>
      </div>

      {/* Insights */}
      <div className="mb-5">
        <h3 className="text-sm font-semibold mb-3">תובנות</h3>
        {insights.isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {[0, 1].map((i) => (
              <div key={i} className="skeleton h-24 rounded-xl" />
            ))}
          </div>
        ) : visibleInsights.length === 0 ? (
          <div className="text-sm text-[#647399]">
            אין תובנות לחודש הזה. צריך היסטוריה של כמה חודשים כדי להשוות ולזהות מה השתנה.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {visibleInsights.map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}
            </div>
            {(insights.data?.insights.length ?? 0) > MAX_VISIBLE_INSIGHTS && (
              <button
                className="btn btn-ghost mt-3"
                onClick={() => setShowAllInsights((v) => !v)}
              >
                {showAllInsights
                  ? 'הצג פחות'
                  : `הצג עוד ${(insights.data?.insights.length ?? 0) - MAX_VISIBLE_INSIGHTS}`}
              </button>
            )}
          </>
        )}
      </div>

      {/* Recurring commitments */}
      <div className="card">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-semibold">חיובים קבועים</h3>
          <button className="btn btn-ghost" onClick={() => setDrawerOpen(true)}>
            סיווג תנועות
          </button>
        </div>
        {recurring.isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="skeleton h-10 rounded-lg" />
            ))}
          </div>
        ) : (
          <RecurringList
            items={recurring.data?.items ?? []}
            monthlyFixedTotal={recurring.data?.monthlyFixedTotal ?? 0}
          />
        )}
      </div>

      <p className="text-[11px] text-[#647399] mt-4">
        העברות פנימיות וחיובי אשראי לא נכללים בסכומים, כדי למנוע כפל ספירה.
      </p>

      <CategorizeDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  )
}

function LoadingState() {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="skeleton h-20 rounded-xl" />
        ))}
      </div>
      <div className="skeleton h-[260px] rounded-xl" />
    </div>
  )
}

function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="card max-w-xl">
      <div className="text-lg font-bold tracking-tight mb-2">{title}</div>
      <p className="text-sm text-[#97a4c2] leading-relaxed">{body}</p>
    </div>
  )
}

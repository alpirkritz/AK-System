'use client'

import { fmtShort } from '../lib/format'

/**
 * The cross-domain header: bank, runway, savings and currency exposure.
 *
 * Every figure here is valued at cost and can be stale, so the badge and the "as of" line are
 * part of the data, not decoration — without them the strip would imply a live net worth.
 */

export interface OverviewData {
  bankTotal: number
  portfolioCostBasis: number
  portfolioCurrency: string
  openPositions: number
  netWorth: number | null
  runwayMonths: number | null
  avgMonthlyExpense: number
  savingsRateInclInvest: number | null
  investedThisMonth: number
  fxExposure: number | null
  asOf: string | null
  stale: boolean
}

function fmtAsOf(iso: string | null): string {
  if (!iso) return 'אין יתרה מחשבון מחובר'
  try {
    return `יתרה נכון ל-${new Date(iso).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit' })}`
  } catch {
    return 'יתרה נכון לתאריך לא ידוע'
  }
}

function Metric({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-[#647399] font-medium">{label}</div>
      <div
        className="text-lg font-bold tracking-tight truncate"
        style={{ color: color ?? '#eef3fb' }}
      >
        {value}
      </div>
      {sub && <div className="text-[11px] text-[#5a688c] mt-0.5 truncate">{sub}</div>}
    </div>
  )
}

export function OverviewStrip({
  data,
  isLoading,
}: {
  data: OverviewData | undefined
  isLoading: boolean
}) {
  if (isLoading) {
    return <div className="skeleton h-24 rounded-xl mb-5" />
  }
  if (!data) return null

  const runway =
    data.runwayMonths === null
      ? '—'
      : `${data.runwayMonths.toLocaleString('he-IL', { maximumFractionDigits: 1 })} חודשים`

  return (
    <div className="card mb-5">
      <div className="flex items-center justify-between gap-2 flex-wrap mb-3">
        <h3 className="text-sm font-semibold">התמונה הכוללת</h3>
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className="pill text-[11px]" style={{ color: '#97a4c2' }}>
            שערוך לפי עלות
          </span>
          {data.stale && (
            <span
              className="pill text-[11px]"
              style={{ color: '#fbbf24', borderColor: '#fbbf2444' }}
            >
              יתרה לא עדכנית
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <Metric label="יתרה בבנק" value={fmtShort(data.bankTotal)} sub={fmtAsOf(data.asOf)} />
        <Metric
          label="תיק ההשקעות"
          value={fmtShort(data.portfolioCostBasis, data.portfolioCurrency)}
          sub={`${data.openPositions} פוזיציות פתוחות, לפי עלות`}
        />
        <Metric
          label="מסלול"
          value={runway}
          sub={
            data.avgMonthlyExpense > 0
              ? `לפי ${fmtShort(data.avgMonthlyExpense)} הוצאה חודשית`
              : 'צריך היסטוריית הוצאות'
          }
        />
        <Metric
          label="שיעור חיסכון"
          value={data.savingsRateInclInvest === null ? '—' : `${data.savingsRateInclInvest}%`}
          sub={
            data.investedThisMonth > 0
              ? `מזה ${fmtShort(data.investedThisMonth)} להשקעות`
              : 'כולל העברות לחיסכון'
          }
          color={
            data.savingsRateInclInvest !== null && data.savingsRateInclInvest < 0
              ? '#fb7185'
              : undefined
          }
        />
        <Metric
          label="חשיפה לדולר"
          value={data.fxExposure === null ? '—' : `${Math.round(data.fxExposure * 100)}%`}
          sub={data.fxExposure === null ? 'אין שער חליפין ידוע' : 'מתוך ההון הכולל'}
        />
      </div>
    </div>
  )
}

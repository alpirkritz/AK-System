'use client'

import { useMemo } from 'react'
import { niceMax, scaleLinear, ticks } from '../lib/chart-scale'
import { fmtShort, monthLabel, monthShort } from '../lib/format'

export interface TrendPoint {
  month: string
  income: number
  expense: number
  net: number
}

const INCOME = '#34d399'
const EXPENSE = '#fb7185'
const NET = '#2dd4bf'
const GRID = '#2f4368'
const MUTED = '#647399'

const VB_W = 720
const VB_H = 260
const PAD_TOP = 16
const PAD_BOTTOM = 34
const PAD_X = 12

/**
 * Income/expense bars with a net line, hand-rolled SVG.
 *
 * Months read right-to-left: the data is reversed for rendering so the newest month sits
 * on the left, matching how the rest of the RTL UI is read.
 *
 * Selecting a month is done here rather than in a separate control, so the chart doubles
 * as navigation for the whole tab.
 */
export function MonthlyTrendChart({
  points,
  selectedMonth,
  onSelectMonth,
}: {
  points: readonly TrendPoint[]
  selectedMonth: string
  onSelectMonth: (month: string) => void
}) {
  const rtl = useMemo(() => [...points].reverse(), [points])

  const max = useMemo(
    () => niceMax(Math.max(1, ...points.map((p) => Math.max(p.income, p.expense)))),
    [points]
  )

  const plotH = VB_H - PAD_TOP - PAD_BOTTOM
  const slot = (VB_W - PAD_X * 2) / Math.max(1, rtl.length)
  const barW = Math.min(18, slot / 3.2)
  const gridLines = ticks(max, 4)

  const selected = points.find((p) => p.month === selectedMonth)

  const netPath = rtl
    .map((p, i) => {
      const x = PAD_X + slot * i + slot / 2
      const y = PAD_TOP + plotH - scaleLinear(Math.max(0, p.net), max, plotH)
      return `${i === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`
    })
    .join(' ')

  const summary = points
    .map((p) => `${monthLabel(p.month)}: הכנסות ${fmtShort(p.income)}, הוצאות ${fmtShort(p.expense)}`)
    .join('; ')

  return (
    <div>
      {/* Fixed caption instead of a floating tooltip — identical on touch and mouse. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1 mb-3 text-xs">
        <span className="font-semibold text-[#eef3fb]">
          {selected ? monthLabel(selected.month) : '—'}
        </span>
        <span style={{ color: INCOME }}>הכנסות {selected ? fmtShort(selected.income) : '—'}</span>
        <span style={{ color: EXPENSE }}>הוצאות {selected ? fmtShort(selected.expense) : '—'}</span>
        <span style={{ color: selected && selected.net < 0 ? EXPENSE : NET }}>
          נטו {selected ? fmtShort(selected.net) : '—'}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${VB_W} ${VB_H}`}
        preserveAspectRatio="none"
        className="w-full h-[220px] md:h-[260px]"
        role="img"
        aria-label={`מגמת הכנסות והוצאות לפי חודש. ${summary}`}
      >
        {gridLines.map((value) => {
          const y = PAD_TOP + plotH - scaleLinear(value, max, plotH)
          return (
            <g key={value}>
              <line x1={PAD_X} y1={y} x2={VB_W - PAD_X} y2={y} stroke={GRID} strokeWidth={1} />
              <text x={VB_W - PAD_X} y={y - 3} fill={MUTED} fontSize={9} textAnchor="end">
                {Math.round(value / 1000)}k
              </text>
            </g>
          )
        })}

        {rtl.map((p, i) => {
          const center = PAD_X + slot * i + slot / 2
          const incomeH = scaleLinear(p.income, max, plotH)
          const expenseH = scaleLinear(p.expense, max, plotH)
          const isSelected = p.month === selectedMonth

          return (
            <g
              key={p.month}
              onClick={() => onSelectMonth(p.month)}
              style={{ cursor: 'pointer' }}
              tabIndex={0}
              role="button"
              aria-label={`בחר ${monthLabel(p.month)}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  onSelectMonth(p.month)
                }
              }}
            >
              {/* Full-height hit area keeps the target well above 44px on touch. */}
              <rect
                x={center - slot / 2}
                y={PAD_TOP}
                width={slot}
                height={plotH + PAD_BOTTOM}
                fill={isSelected ? 'rgba(45,212,191,0.07)' : 'transparent'}
              />
              <rect
                x={center - barW - 1}
                y={PAD_TOP + plotH - incomeH}
                width={barW}
                height={incomeH}
                rx={2}
                fill={INCOME}
                opacity={isSelected ? 1 : 0.65}
              />
              <rect
                x={center + 1}
                y={PAD_TOP + plotH - expenseH}
                width={barW}
                height={expenseH}
                rx={2}
                fill={EXPENSE}
                opacity={isSelected ? 1 : 0.65}
              />
              <text
                x={center}
                y={VB_H - 12}
                fill={isSelected ? '#eef3fb' : MUTED}
                fontSize={10}
                textAnchor="middle"
              >
                {monthShort(p.month)}
              </text>
            </g>
          )
        })}

        <path d={netPath} fill="none" stroke={NET} strokeWidth={2} strokeLinejoin="round" />
      </svg>

      <div className="flex items-center gap-4 mt-2 text-[11px] text-[#647399]">
        <Legend color={INCOME} label="הכנסות" />
        <Legend color={EXPENSE} label="הוצאות" />
        <Legend color={NET} label="נטו" />
      </div>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-sm" style={{ background: color }} />
      {label}
    </span>
  )
}

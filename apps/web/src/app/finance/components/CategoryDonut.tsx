'use client'

import { useMemo } from 'react'
import { CATEGORY_SMALL_SLICE, categoryColor } from '@ak-system/types'
import { describeArc, poolSmallSlices } from '../lib/chart-scale'
import { fmtShort } from '../lib/format'

export interface DonutSlice {
  category: string
  total: number
}

const VB = 240
const CENTER = VB / 2
const OUTER = 100
const INNER = 66
const MIN_SHARE_PCT = 3

/**
 * Expense composition for one month.
 *
 * Slices below 3% are pooled into `קטגוריות קטנות` — deliberately not `אחר`, which is a
 * real category produced by the categorizer's fallback. Merging the two would make a
 * click-through show an incoherent list.
 */
export function CategoryDonut({
  slices,
  total,
  emptyLabel = 'אין תנועות בחודש הזה.',
}: {
  slices: readonly DonutSlice[]
  total: number
  emptyLabel?: string
}) {
  const segments = useMemo(() => {
    const sorted = [...slices].filter((s) => s.total > 0).sort((a, b) => b.total - a.total)
    const { visible, pooled, pooledTotal } = poolSmallSlices(sorted, MIN_SHARE_PCT)
    const all =
      pooled.length > 0
        ? [...visible, { category: CATEGORY_SMALL_SLICE, total: pooledTotal }]
        : visible

    const sum = all.reduce((s, i) => s + i.total, 0)
    let angle = 0
    return all.map((item) => {
      const sweep = sum > 0 ? (item.total / sum) * 360 : 0
      const seg = {
        ...item,
        start: angle,
        end: angle + sweep,
        share: sum > 0 ? (item.total / sum) * 100 : 0,
        color: item.category === CATEGORY_SMALL_SLICE ? '#3a507d' : categoryColor(item.category),
      }
      angle += sweep
      return seg
    })
  }, [slices])

  if (segments.length === 0) {
    return (
      <div className="flex items-center justify-center h-[240px] text-sm text-[#647399]">
        {emptyLabel}
      </div>
    )
  }

  const summary = segments
    .map((s) => `${s.category} ${Math.round(s.share)}%`)
    .join(', ')

  return (
    <div className="flex flex-col items-center">
      <svg
        viewBox={`0 0 ${VB} ${VB}`}
        className="w-full max-w-[240px]"
        role="img"
        aria-label={`פילוח הוצאות לפי קטגוריה: ${summary}`}
      >
        {segments.map((s) => (
          <path
            key={s.category}
            d={describeArc(CENTER, CENTER, OUTER, INNER, s.start, s.end)}
            fill={s.color}
            stroke="#1a2740"
            strokeWidth={1.5}
          />
        ))}
        <text
          x={CENTER}
          y={CENTER - 4}
          fill="#eef3fb"
          fontSize={19}
          fontWeight={600}
          textAnchor="middle"
        >
          {fmtShort(total)}
        </text>
        <text x={CENTER} y={CENTER + 16} fill="#647399" fontSize={11} textAnchor="middle">
          סך ההוצאות
        </text>
      </svg>
    </div>
  )
}

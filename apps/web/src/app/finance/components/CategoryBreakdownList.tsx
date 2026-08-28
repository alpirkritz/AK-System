'use client'

import { CATEGORY_UNCATEGORIZED } from '@ak-system/types'
import { fmt, fmtShort } from '../lib/format'
import { useFinanceCategoryColor } from '../lib/use-finance-category-color'

export interface BreakdownItem {
  category: string
  total: number
  count: number
  share: number
  trailingAvg: number
  deltaAbs: number
  deltaPct: number | null
}

/**
 * The accessible, screen-readable counterpart to the donut — and the more informative of
 * the two, because it carries the comparison to each category's own trailing average.
 */
export function CategoryBreakdownList({
  items,
  onSelectCategory,
}: {
  items: readonly BreakdownItem[]
  onSelectCategory?: (category: string) => void
}) {
  const categoryColor = useFinanceCategoryColor()
  if (items.length === 0) {
    return <div className="text-sm text-[#647399]">אין תנועות בחודש הזה.</div>
  }

  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((item) => {
        const isUncategorized = item.category === CATEGORY_UNCATEGORIZED
        const color = isUncategorized ? '#3a507d' : categoryColor(item.category)
        const clickable = !!onSelectCategory

        return (
          <li key={item.category}>
            <button
              type="button"
              onClick={clickable ? () => onSelectCategory!(item.category) : undefined}
              disabled={!clickable}
              className="w-full text-right rounded-lg px-2 py-1.5 transition-colors disabled:cursor-default enabled:hover:bg-[#1d2b46]"
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-2.5 h-2.5 rounded-sm shrink-0"
                  style={{ background: color }}
                  aria-hidden
                />
                <span className="text-sm text-[#eef3fb] truncate">{item.category}</span>
                <span className="text-[11px] text-[#647399] shrink-0">
                  {item.count} תנועות
                </span>
                <span className="flex-1" />
                <span className="text-sm font-semibold text-[#eef3fb] shrink-0">
                  {fmt(item.total)}
                </span>
              </div>

              <div className="flex items-center gap-2 mt-1.5">
                <div className="flex-1 h-1.5 rounded-full bg-[#223052] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{ width: `${Math.min(100, item.share)}%`, background: color }}
                  />
                </div>
                <span className="text-[11px] text-[#647399] shrink-0 w-9 text-left">
                  {Math.round(item.share)}%
                </span>
                <DeltaTag item={item} />
              </div>
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** A total says how much; the delta says what changed. Only the second one is actionable. */
function DeltaTag({ item }: { item: BreakdownItem }) {
  if (item.trailingAvg <= 0) {
    return <span className="text-[11px] text-[#647399] shrink-0">חדש</span>
  }

  const up = item.deltaAbs > 0
  const pct = item.deltaPct === null ? null : Math.round(item.deltaPct)
  if (pct === null || Math.abs(pct) < 5) {
    return <span className="text-[11px] text-[#647399] shrink-0">כרגיל</span>
  }

  return (
    <span
      className="text-[11px] shrink-0 whitespace-nowrap"
      style={{ color: up ? '#fb7185' : '#34d399' }}
      title={`ממוצע 3 חודשים: ${fmtShort(item.trailingAvg)}`}
    >
      {up ? '▲' : '▼'} {Math.abs(pct)}%
    </span>
  )
}

'use client'

import { fmt, fmtDate, fmtShort } from '../lib/format'
import { useFinanceCategoryColor } from '../lib/use-finance-category-color'

export interface RecurringRow {
  label: string
  category: string | null
  occurrences: number
  avgAmount: number
  lastAmount: number
  lastDate: string
  cadence: 'monthly' | 'irregular'
  annualizedCost: number
  increasedPct: number | null
}

/**
 * Fixed commitments — the highest-signal view on bank-level data, where merchant detail is
 * coarse but repetition is unmistakable.
 */
export function RecurringList({
  items,
  monthlyFixedTotal,
}: {
  items: readonly RecurringRow[]
  monthlyFixedTotal: number
}) {
  const categoryColor = useFinanceCategoryColor()
  if (items.length === 0) {
    return (
      <div className="text-sm text-[#647399]">
        לא זוהו חיובים קבועים. צריך שלושה חיובים דומים לפחות כדי לזהות תבנית.
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-baseline gap-2 mb-3">
        <span className="text-xs text-[#647399]">סך חיובים קבועים בחודש</span>
        <span className="text-sm font-semibold text-[#eef3fb]">{fmt(monthlyFixedTotal)}</span>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[11px] text-[#647399]">
              <th className="text-right font-medium pb-2">חיוב</th>
              <th className="text-right font-medium pb-2">תדירות</th>
              <th className="text-right font-medium pb-2">בחיוב</th>
              <th className="text-right font-medium pb-2">בשנה</th>
              <th className="text-right font-medium pb-2">אחרון</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.label} className="border-t border-[#2f4368]">
                <td className="py-2.5 pe-3">
                  <div className="flex items-center gap-2">
                    {item.category && (
                      <span
                        className="w-2 h-2 rounded-sm shrink-0"
                        style={{ background: categoryColor(item.category) }}
                        aria-hidden
                      />
                    )}
                    <span className="text-[#eef3fb]">{item.label}</span>
                    {item.increasedPct !== null && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded"
                        style={{ background: '#fb718511', color: '#fb7185' }}
                      >
                        התייקר {Math.round(item.increasedPct)}%
                      </span>
                    )}
                  </div>
                </td>
                <td className="py-2.5 pe-3 text-xs text-[#97a4c2] whitespace-nowrap">
                  {item.cadence === 'monthly' ? 'חודשי' : 'לא סדיר'} · {item.occurrences}×
                </td>
                <td className="py-2.5 pe-3 whitespace-nowrap text-[#eef3fb]">
                  {fmtShort(item.avgAmount)}
                </td>
                <td className="py-2.5 pe-3 whitespace-nowrap text-[#97a4c2]">
                  {fmtShort(item.annualizedCost)}
                </td>
                <td className="py-2.5 text-xs text-[#647399] whitespace-nowrap">
                  {fmtDate(item.lastDate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

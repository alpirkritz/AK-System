'use client'

import { useFinanceCategoryColor } from '../lib/use-finance-category-color'

export interface InsightItem {
  id: string
  kind: string
  severity: 'info' | 'warn' | 'opportunity'
  title: string
  body: string
  amount: number | null
  category: string | null
  href: string | null
}

const SEVERITY: Record<InsightItem['severity'], { accent: string; icon: string; label: string }> = {
  opportunity: { accent: '#2dd4bf', icon: '↓', label: 'הזדמנות' },
  warn: { accent: '#fb7185', icon: '!', label: 'לתשומת לב' },
  info: { accent: '#38bdf8', icon: 'i', label: 'מידע' },
}

export function InsightCard({ insight }: { insight: InsightItem }) {
  const categoryColor = useFinanceCategoryColor()
  const tone = SEVERITY[insight.severity]

  return (
    <div
      className="card"
      style={{ borderInlineStartWidth: 3, borderInlineStartColor: tone.accent, padding: 16 }}
    >
      <div className="flex items-start gap-2.5">
        <span
          className="shrink-0 w-5 h-5 rounded-full grid place-items-center text-[11px] font-bold mt-0.5"
          style={{ background: `${tone.accent}22`, color: tone.accent }}
          aria-hidden
        >
          {tone.icon}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold text-[#eef3fb]">{insight.title}</div>
          <div className="text-xs text-[#97a4c2] mt-1 leading-relaxed">{insight.body}</div>
          {insight.category && (
            <span
              className="inline-flex items-center gap-1.5 mt-2 text-[11px] text-[#647399]"
            >
              <span
                className="w-2 h-2 rounded-sm"
                style={{ background: categoryColor(insight.category) }}
                aria-hidden
              />
              {insight.category}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

'use client'

import { memo } from 'react'

export const SummaryCard = memo(function SummaryCard({
  icon, label, value, sub, color,
}: {
  icon: string
  label: string
  value: string
  sub?: string
  color?: string
}) {
  return (
    <div className="card flex flex-col gap-1">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{icon}</span>
        <span className="text-xs text-[#647399] font-medium">{label}</span>
      </div>
      <div className="text-2xl font-bold tracking-tight" style={{ color: color ?? '#eef3fb' }}>
        {value}
      </div>
      {sub && <div className="text-xs text-[#5a688c]">{sub}</div>}
    </div>
  )
})

'use client'

import { STATUS_COLORS, STATUS_LABELS, type TaskStatus } from '@ak-system/types'

/**
 * Color-coded status tag for a task row. Silent for `not_started` and `done` — the row's
 * checkbox and strikethrough already carry those, so a pill would only add noise.
 */
export function StatusPill({ status }: { status?: string | null }) {
  if (!status || status === 'not_started' || status === 'done') return null
  const key = status as TaskStatus
  const color = STATUS_COLORS[key]
  const label = STATUS_LABELS[key]
  if (!color || !label) return null
  return (
    <span
      className="pill text-[11px] whitespace-nowrap"
      style={{ background: color + '22', borderColor: color + '55', color }}
    >
      {label}
    </span>
  )
}

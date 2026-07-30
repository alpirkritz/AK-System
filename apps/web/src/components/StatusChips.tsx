'use client'

import { STATUS_COLORS, STATUS_LABELS, TASK_STATUS_ORDER, type TaskStatus } from '@ak-system/types'

/** Single-select status chips in the canonical fixed order (mirrors priority chips). */
export function StatusChips({
  value,
  onChange,
  disabled,
}: {
  value: TaskStatus
  onChange: (status: TaskStatus) => void
  disabled?: boolean
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {TASK_STATUS_ORDER.map((s) => {
        const active = value === s
        const color = STATUS_COLORS[s]
        return (
          <button
            key={s}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            onClick={() => onChange(s)}
            className="cursor-pointer inline-flex items-center min-h-[40px] py-1.5 px-3.5 rounded-[20px] border text-sm transition-all disabled:opacity-50"
            style={{
              borderColor: active ? color : '#2f4368',
              background: active ? color + '22' : 'transparent',
              color: active ? color : '#7a89ab',
            }}
          >
            {STATUS_LABELS[s]}
          </button>
        )
      })}
    </div>
  )
}

'use client'

import { ArrowDownUp } from 'lucide-react'
import type { SortPref } from '@/lib/sort-keys'

interface ThenBySortProps<K extends string> {
  value: SortPref<K>
  onChange: (value: SortPref<K>) => void
  fields: readonly { value: K | 'none'; label: string }[]
  showReset?: boolean
  onReset?: () => void
  className?: string
  /** Stack the two controls vertically (settings page). Default is a compact inline row. */
  layout?: 'inline' | 'stacked'
}

export function ThenBySort<K extends string>({
  value,
  onChange,
  fields,
  showReset = false,
  onReset,
  className = '',
  layout = 'inline',
}: ThenBySortProps<K>) {
  // Helper to extract base field name (e.g., "priority" from "priority_high")
  const getBaseField = (key: string): string => {
    const parts = key.split('_')
    // If it's a field with direction suffix (high/low/asc/desc), return base
    if (parts.length >= 2 && ['high', 'low', 'asc', 'desc', 'workflow', 'reverse'].includes(parts[parts.length - 1])) {
      return parts.slice(0, -1).join('_')
    }
    return key
  }

  const primaryBase = getBaseField(String(value.primary))

  // Filter then-by options: cannot repeat primary field (considering base field)
  const thenByOptions = fields.filter((f) => {
    if (f.value === 'none') return true
    const fieldBase = getBaseField(String(f.value))
    return fieldBase !== primaryBase
  })

  const inline = layout === 'inline'
  const selectClass = inline
    ? 'select w-auto max-w-[9.5rem] sm:max-w-[11rem] text-xs py-1.5 ps-2 pe-6 min-h-[32px]'
    : 'select text-xs py-1.5 px-2'

  return (
    <div
      className={
        inline
          ? `flex flex-wrap items-center gap-x-2 gap-y-1.5 ${className}`
          : `flex flex-col gap-2 ${className}`
      }
    >
      <div className={inline ? 'flex items-center gap-1.5 min-w-0' : 'flex flex-col gap-1.5'}>
        <label className="text-xs text-[#7a89ab] font-medium inline-flex items-center gap-1 shrink-0">
          {inline && <ArrowDownUp size={12} className="opacity-70" aria-hidden />}
          <span className={inline ? 'hidden sm:inline' : undefined}>מיון</span>
        </label>
        <select
          className={selectClass}
          aria-label="מיון"
          data-testid="sort-primary"
          value={value.primary}
          onChange={(e) =>
            onChange({
              primary: e.target.value as K,
              thenBy: value.thenBy === e.target.value ? 'none' : value.thenBy,
            })
          }
        >
          {fields
            .filter((f) => f.value !== 'none')
            .map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
        </select>
      </div>

      <div className={inline ? 'flex items-center gap-1.5 min-w-0' : 'flex flex-col gap-1.5'}>
        <label className="text-xs text-[#7a89ab] font-medium shrink-0">ואז</label>
        <select
          className={selectClass}
          aria-label="מיון משני"
          data-testid="sort-then-by"
          value={value.thenBy}
          onChange={(e) =>
            onChange({
              ...value,
              thenBy: e.target.value as K | 'none',
            })
          }
        >
          {thenByOptions.map((f) => (
            <option key={f.value} value={f.value}>
              {f.label}
            </option>
          ))}
        </select>
      </div>

      {showReset && onReset && (
        <button
          type="button"
          className={`btn btn-ghost text-xs py-1 px-2 ${inline ? '' : 'mt-1'}`}
          onClick={onReset}
        >
          איפוס לברירת מחדל
        </button>
      )}
    </div>
  )
}

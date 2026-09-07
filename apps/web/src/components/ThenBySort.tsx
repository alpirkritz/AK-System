'use client'

import type { SortPref } from '@/lib/sort-keys'

interface ThenBySortProps<K extends string> {
  value: SortPref<K>
  onChange: (value: SortPref<K>) => void
  fields: readonly { value: K | 'none'; label: string }[]
  showReset?: boolean
  onReset?: () => void
  className?: string
}

export function ThenBySort<K extends string>({
  value,
  onChange,
  fields,
  showReset = false,
  onReset,
  className = '',
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

  return (
    <div className={`flex flex-col gap-2 ${className}`}>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-[#7a89ab] font-medium">מיון</label>
        <select
          className="select text-xs py-1.5 px-2"
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

      <div className="flex flex-col gap-1.5">
        <label className="text-xs text-[#7a89ab] font-medium">ואז</label>
        <select
          className="select text-xs py-1.5 px-2"
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
          className="btn btn-ghost text-xs py-1 px-2 mt-1"
          onClick={onReset}
        >
          איפוס לברירת מחדל
        </button>
      )}
    </div>
  )
}

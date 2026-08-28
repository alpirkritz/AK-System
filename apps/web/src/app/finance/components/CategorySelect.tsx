'use client'

import { CASHFLOW_CATEGORY_LABELS } from '@ak-system/types'
import { trpc } from '@/lib/trpc'

type CategorySelectProps = {
  value?: string
  defaultValue?: string
  onChange?: (value: string) => void
  disabled?: boolean
  className?: string
  style?: React.CSSProperties
  /** When set, only expense or income labels (plus internal if expense filter — hidden). */
  kind?: 'expense' | 'income'
  placeholder?: string
  'aria-label'?: string
}

export function CategorySelect({
  value,
  defaultValue,
  onChange,
  disabled,
  className,
  style,
  kind,
  placeholder = 'בחר קטגוריה',
  'aria-label': ariaLabel,
}: CategorySelectProps) {
  const { data } = trpc.finance.listCategories.useQuery()
  const labels =
    data?.categories
      .filter((c) => {
        if (!kind) return true
        if (kind === 'income') return c.kind === 'income'
        return c.kind === 'expense' || c.kind === 'internal'
      })
      .map((c) => c.label) ?? [...CASHFLOW_CATEGORY_LABELS]

  const common = {
    className: className ?? 'select',
    style,
    disabled,
    'aria-label': ariaLabel,
    onChange: (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (e.target.value) onChange?.(e.target.value)
    },
  }

  if (value !== undefined) {
    return (
      <select {...common} value={value}>
        {labels.map((label) => (
          <option key={label} value={label}>
            {label}
          </option>
        ))}
      </select>
    )
  }

  return (
    <select {...common} defaultValue={defaultValue ?? ''}>
      <option value="">{placeholder}</option>
      {labels.map((label) => (
        <option key={label} value={label}>
          {label}
        </option>
      ))}
    </select>
  )
}

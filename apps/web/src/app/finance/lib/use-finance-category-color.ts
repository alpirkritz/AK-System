'use client'

import { useMemo } from 'react'
import { CATEGORY_COLORS, CASHFLOW_CATEGORY_LABELS } from '@ak-system/types'
import { trpc } from '@/lib/trpc'

/** Resolved label → color, including user-defined categories. */
export function useFinanceCategoryColor() {
  const { data } = trpc.finance.listCategories.useQuery()
  return useMemo(() => {
    const map: Record<string, string> = { ...CATEGORY_COLORS }
    for (const c of data?.categories ?? []) map[c.label] = c.color
    return (label: string | null | undefined) => map[label ?? ''] ?? '#647399'
  }, [data])
}

'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { StatusChips } from '@/components/StatusChips'
import type { TaskStatus } from '@ak-system/types'

type Row = {
  id: string | null
  rawLabel: string
  status: TaskStatus
  confirmed: boolean
  taskCount: number
}

export default function NotionStatusesPage() {
  const { data: overrides = [], isLoading: overridesLoading } = trpc.notionStatusOverrides.list.useQuery()
  const { data: unmapped = [], isLoading: unmappedLoading } = trpc.notionStatusOverrides.unmapped.useQuery()
  const { data: tasksList = [] } = trpc.tasks.list.useQuery()
  const utils = trpc.useUtils()

  const invalidate = () => {
    utils.notionStatusOverrides.list.invalidate()
    utils.notionStatusOverrides.unmapped.invalidate()
  }
  const upsert = trpc.notionStatusOverrides.upsert.useMutation({ onSuccess: invalidate })
  const remove = trpc.notionStatusOverrides.delete.useMutation({ onSuccess: invalidate })

  const isLoading = overridesLoading || unmappedLoading

  // Task counts per raw label (case-insensitive) — for confirmed overrides.
  const countByLabel = useMemo(() => {
    const map = new Map<string, number>()
    for (const t of tasksList as Array<{ notionStatusRaw?: string | null }>) {
      const raw = (t.notionStatusRaw ?? '').trim().toLowerCase()
      if (!raw) continue
      map.set(raw, (map.get(raw) ?? 0) + 1)
    }
    return map
  }, [tasksList])

  const rows = useMemo<Row[]>(() => {
    const confirmed: Row[] = overrides.map((o) => ({
      id: o.id,
      rawLabel: o.rawLabel,
      status: o.canonicalStatus as TaskStatus,
      confirmed: true,
      taskCount: countByLabel.get(o.rawLabel.trim().toLowerCase()) ?? 0,
    }))
    const pending: Row[] = unmapped.map((u) => ({
      id: null,
      rawLabel: u.rawLabel,
      status: u.guessedStatus as TaskStatus,
      confirmed: false,
      taskCount: u.taskCount,
    }))
    return [...confirmed, ...pending].sort((a, b) => a.rawLabel.localeCompare(b.rawLabel))
  }, [overrides, unmapped, countByLabel])

  return (
    <div className="max-w-3xl mx-auto pb-16" data-testid="notion-statuses-settings">
      <div className="mb-6">
        <Link href="/settings" className="text-xs text-[#5a688c] hover:text-[#7a89ab]">
          ← חזרה להגדרות
        </Link>
        <h1 className="text-xl font-bold mt-2">מיפוי סטטוסים מ-Notion</h1>
        <p className="text-xs text-[#5a688c] mt-1">
          לכל סטטוס שמגיע מ-Notion בחר את הסטטוס המתאים במערכת. שינוי חל בסנכרון הבא.
        </p>
      </div>

      {isLoading ? (
        <div className="card">
          <div className="skeleton h-5 w-1/3 mb-3" />
          <div className="skeleton h-5 w-1/2" />
        </div>
      ) : rows.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-[#eef3fb] font-medium mb-1">אין עדיין סטטוסים מיובאים מ-Notion</div>
          <div className="text-sm text-[#647399]">סנכרן משימות מ-Notion כדי להתחיל.</div>
        </div>
      ) : (
        <div className="card flex flex-col divide-y divide-[#1d2b46]">
          {rows.map((row) => (
            <div
              key={row.rawLabel}
              className="flex flex-col sm:flex-row sm:items-center gap-3 py-4"
            >
              <div className="sm:w-48 min-w-0">
                <div className="text-sm text-[#eef3fb] truncate">{row.rawLabel}</div>
                <div className="text-[11px] text-[#647399]">
                  {row.taskCount} משימות
                  {!row.confirmed && <span className="mr-1">· שיוך אוטומטי</span>}
                </div>
              </div>
              <div className="flex-1">
                <StatusChips
                  value={row.status}
                  disabled={upsert.isPending}
                  onChange={(status) => upsert.mutate({ rawLabel: row.rawLabel, canonicalStatus: status })}
                />
              </div>
              {row.confirmed && row.id && (
                <button
                  type="button"
                  className="btn btn-ghost text-xs py-1 px-3 shrink-0"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate({ id: row.id! })}
                >
                  נקה מיפוי
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

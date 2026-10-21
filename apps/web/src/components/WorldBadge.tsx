'use client'

import { trpc } from '@/lib/trpc'

const DEFAULT_COLOR = '#2dd4bf'

type WorldRow = { id: string; name: string; color?: string | null; parentId?: string | null }

export function worldBadgeParts(rows: WorldRow[], workspaceId?: string | null) {
  if (!workspaceId) return null
  const row = rows.find((w) => w.id === workspaceId)
  if (!row) return null
  if (row.parentId) {
    const parent = rows.find((w) => w.id === row.parentId)
    const color = parent?.color ?? row.color ?? DEFAULT_COLOR
    const world = parent?.name ?? row.name
    return { text: parent ? `${world} · ${row.name}` : row.name, color }
  }
  return { text: row.name, color: row.color ?? DEFAULT_COLOR }
}

/**
 * Color dot plus world name. Child workspaces read "{world} · {workspace}".
 * Rows without a world render nothing unless `showUnassigned` is set — a grey
 * "לא משויך" pill on every task, meeting and project was pure noise.
 */
export function WorldBadge({
  workspaceId,
  showUnassigned = false,
}: {
  workspaceId?: string | null
  showUnassigned?: boolean
}) {
  const { data: rows = [] } = trpc.workspaces.list.useQuery(undefined, { staleTime: 60_000 })
  const unassigned = showUnassigned ? <span className="pill text-[11px]">לא משויך</span> : null
  if (!workspaceId) return unassigned
  const parts = worldBadgeParts(rows, workspaceId)
  if (!parts) return unassigned
  return (
    <span
      className="pill text-[11px] whitespace-nowrap inline-flex items-center gap-1"
      style={{ background: parts.color + '22', borderColor: parts.color + '55', color: parts.color }}
    >
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: parts.color }} aria-hidden />
      {parts.text}
    </span>
  )
}

export function UnassignedHeading({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <h2 className="text-xs font-semibold text-[#7a89ab] uppercase tracking-wider mt-8 mb-3">
      לא משויך ({count})
    </h2>
  )
}

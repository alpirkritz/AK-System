'use client'

import { useMemo } from 'react'
import { trpc } from '@/lib/trpc'

interface ProjectOption {
  id: string
  name: string
  workspaceId?: string | null
  worldId?: string | null
}

/** World id of a workspace id (a world maps to itself), from the cached workspaces list. */
export function useWorldOf(): (workspaceId: string | null | undefined) => string | null {
  const { data: rows = [] } = trpc.workspaces.list.useQuery(undefined, { staleTime: 60_000 })
  return useMemo(() => {
    const parent = new Map((rows as Array<{ id: string; parentId?: string | null }>).map((w) => [w.id, w.parentId ?? w.id]))
    return (id) => (id ? parent.get(id) ?? null : null)
  }, [rows])
}

/**
 * <option>s for a project <select>, scoped to the item's world (spec: project-world-scoping):
 * that world's projects first, then projects with no world. Another world's projects are left
 * out — except the current selection, which stays visible and marked so it can be fixed.
 */
export function WorldProjectOptions({
  projects,
  itemWorkspaceId,
  selectedId,
}: {
  projects: ProjectOption[]
  itemWorkspaceId: string | null | undefined
  selectedId: string | null | undefined
}) {
  const worldOf = useWorldOf()
  const itemWorld = worldOf(itemWorkspaceId)
  const projectWorld = (p: ProjectOption) => p.worldId ?? worldOf(p.workspaceId)

  if (!itemWorld) {
    return (
      <>
        {projects.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </>
    )
  }
  const same = projects.filter((p) => projectWorld(p) === itemWorld)
  const none = projects.filter((p) => !projectWorld(p))
  const selectedOther = projects.find((p) => p.id === selectedId && projectWorld(p) && projectWorld(p) !== itemWorld)
  return (
    <>
      {same.length > 0 && (
        <optgroup label="העולם של הפריט">
          {same.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </optgroup>
      )}
      {none.length > 0 && (
        <optgroup label="ללא עולם">
          {none.map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </optgroup>
      )}
      {selectedOther && (
        <optgroup label="עולם אחר — לתקן">
          <option value={selectedOther.id}>{selectedOther.name} (עולם אחר)</option>
        </optgroup>
      )}
    </>
  )
}

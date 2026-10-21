'use client'

import { useEffect, useId, useState } from 'react'
import { trpc } from '@/lib/trpc'
import { useWorldFilter } from '@/lib/world-filter'
import { useIsNarrowPhone } from '@/lib/use-keyboard-overlap'

type TreeWorld = {
  id: string
  name: string
  color?: string | null
  children: { id: string; name: string; color?: string | null }[]
}

function findName(tree: TreeWorld[], id: string | null) {
  if (!id) return null
  for (const world of tree) {
    if (world.id === id) return world.name
    const child = world.children.find((c) => c.id === id)
    if (child) return `${world.name} · ${child.name}`
  }
  return null
}

function OptionList({
  tree,
  current,
  onPick,
}: {
  tree: TreeWorld[]
  current: string | null
  onPick: (id: string | null) => void
}) {
  return (
    <div className="flex flex-col gap-1 p-2" role="listbox" aria-label="בחירת עולם">
      <button
        type="button"
        role="option"
        aria-selected={current == null}
        className="filter-chip min-h-[44px] justify-start w-full"
        onClick={() => onPick(null)}
      >
        הכל
      </button>
      {tree.map((world) => (
        <div key={world.id}>
          <button
            type="button"
            role="option"
            aria-selected={current === world.id}
            className="filter-chip min-h-[44px] justify-start w-full"
            onClick={() => onPick(world.id)}
          >
            <span className="w-2 h-2 rounded-full shrink-0" style={{ background: world.color ?? '#2dd4bf' }} aria-hidden />
            {world.name}
          </button>
          {world.children.map((child) => (
            <button
              key={child.id}
              type="button"
              role="option"
              aria-selected={current === child.id}
              className="filter-chip min-h-[44px] justify-start w-full ms-4"
              onClick={() => onPick(child.id)}
            >
              {child.name}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

export function WorldSwitcher() {
  const { workspaceId, setWorkspaceId, ready } = useWorldFilter()
  const { data: tree = [], isLoading } = trpc.workspaces.tree.useQuery(undefined, { staleTime: 60_000 })
  const narrow = useIsNarrowPhone()
  const [open, setOpen] = useState(false)
  const panelId = useId()

  useEffect(() => {
    if (!ready || isLoading || !workspaceId) return
    const known = tree.some((w: TreeWorld) => w.id === workspaceId || w.children.some((c) => c.id === workspaceId))
    if (!known) setWorkspaceId(null)
  }, [ready, isLoading, workspaceId, tree, setWorkspaceId])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (isLoading || tree.length === 0) return null

  const label = findName(tree, workspaceId) ?? 'הכל'

  const panel = (
    <div id={panelId} data-testid="world-switcher-panel" className={narrow ? '' : 'absolute top-full mt-1 z-50 min-w-[220px] rounded-xl border border-[#2f4368] bg-[#16233b] shadow-xl'}>
      <OptionList
        tree={tree}
        current={workspaceId}
        onPick={(id) => {
          setWorkspaceId(id)
          setOpen(false)
        }}
      />
    </div>
  )

  return (
    <div className="relative">
      <button
        type="button"
        className="filter-chip min-h-[44px]"
        data-testid="world-switcher"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
      >
        {label}
      </button>
      {open && narrow && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-[60] bg-black/60"
            aria-label="סגור בחירת עולם"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-label="בחירת עולם"
            className="fixed inset-x-0 z-[70] rounded-t-2xl border-t border-[#2f4368] bg-[#16233b]"
            style={{ bottom: 'calc(3.5rem + env(safe-area-inset-bottom, 0px))' }}
          >
            {panel}
          </div>
        </>
      )}
      {open && !narrow && (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default"
            aria-label="סגור בחירת עולם"
            onClick={() => setOpen(false)}
          />
          {panel}
        </>
      )}
    </div>
  )
}

/** Reminder on a filtered list. Hidden while הכל is selected. */
export function FilteredWorldChip() {
  const { workspaceId, setWorkspaceId } = useWorldFilter()
  const { data: tree = [] } = trpc.workspaces.tree.useQuery(undefined, {
    staleTime: 60_000,
    enabled: !!workspaceId,
  })
  if (!workspaceId) return null
  const name = findName(tree, workspaceId) ?? 'עולם'
  return (
    <button
      type="button"
      className="filter-chip min-h-[44px] mb-4"
      data-testid="filtered-world-chip"
      onClick={() => setWorkspaceId(null)}
    >
      מסונן: {name} ✕
    </button>
  )
}

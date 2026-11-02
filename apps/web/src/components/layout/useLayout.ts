'use client'

import { useCallback, useMemo } from 'react'
import { applyLayout, type LayoutScreen, type ScreenLayout } from '@ak-system/types'
import { trpc } from '@/lib/trpc'

const OPEN_SUFFIX = ':open'

/**
 * Saved arrangement for one screen. `visible` / `hidden` are always complete: blocks shipped
 * after the layout was saved appear at the end, removed ones are dropped. Writes are optimistic.
 *
 * A screen may show only some of its blocks at a time (meetings: upcoming vs past), so every write
 * keeps the saved entries that belong to blocks not on screen right now.
 */
export function useLayout(screen: LayoutScreen, defaultIds: readonly string[]) {
  const utils = trpc.useUtils()
  const { data, isLoading } = trpc.settings.layout.get.useQuery()
  const saved = data?.[screen]
  const known = useMemo(() => new Set(defaultIds), [defaultIds.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps

  const { visible, hidden } = useMemo(() => applyLayout(defaultIds, saved), [saved, known]) // eslint-disable-line react-hooks/exhaustive-deps
  const collapsedRaw = saved?.collapsed ?? []

  const set = trpc.settings.layout.set.useMutation({
    onSuccess: (next) => utils.settings.layout.get.setData(undefined, next),
    onError: () => void utils.settings.layout.get.invalidate(),
  })
  const reset = trpc.settings.layout.reset.useMutation({
    onSuccess: (next) => utils.settings.layout.get.setData(undefined, next),
  })

  const save = useCallback(
    (next: ScreenLayout) => {
      utils.settings.layout.get.setData(undefined, (prev) => ({ ...(prev ?? {}), [screen]: next }))
      set.mutate({ screen, ...next })
    },
    [screen, set, utils],
  )

  // Saved entries for blocks that are not part of this render stay exactly as they were.
  const offScreen = (ids: string[] | undefined) => (ids ?? []).filter((id) => !known.has(id.replace(OPEN_SUFFIX, '')))
  const withOthers = (order: string[], hide: string[], collapsed: string[]): ScreenLayout => ({
    order: [...order, ...offScreen(saved?.order)],
    hidden: [...hide, ...offScreen(saved?.hidden)],
    collapsed: [...collapsed, ...offScreen(saved?.collapsed)],
  })
  const onScreenCollapsed = collapsedRaw.filter((id) => known.has(id.replace(OPEN_SUFFIX, '')))

  return {
    /** False until the saved arrangement arrived, so the screen never flashes the default order. */
    ready: !isLoading,
    visible,
    hidden,
    isCustom: !!saved,
    saveOrder: (order: string[]) => save(withOthers([...order, ...hidden], hidden, onScreenCollapsed)),
    hide: (id: string) => save(withOthers([...visible, ...hidden], [...hidden, id], onScreenCollapsed)),
    show: (id: string) => save(withOthers([...visible, ...hidden], hidden.filter((h) => h !== id), onScreenCollapsed)),
    /** true / false when the owner opened or closed the block himself; undefined = the code default. */
    isOpen: (id: string): boolean | undefined =>
      collapsedRaw.includes(id) ? false : collapsedRaw.includes(id + OPEN_SUFFIX) ? true : undefined,
    setOpen: (id: string, open: boolean) =>
      save(
        withOthers(
          [...visible, ...hidden],
          hidden,
          [...onScreenCollapsed.filter((c) => c !== id && c !== id + OPEN_SUFFIX), open ? id + OPEN_SUFFIX : id],
        ),
      ),
    reset: () => reset.mutate({ screen }),
  }
}

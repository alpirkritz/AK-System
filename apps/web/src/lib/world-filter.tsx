'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

const KEY = 'ak.worldFilter'

type WorldFilterValue = {
  /** Selected world or workspace id. Null means הכל. */
  workspaceId: string | null
  setWorkspaceId: (id: string | null) => void
  /** False until localStorage has been read, so lists don't fetch twice. */
  ready: boolean
}

const WorldFilterContext = createContext<WorldFilterValue | null>(null)

export function WorldFilterProvider({ children }: { children: ReactNode }) {
  const [workspaceId, setStored] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(KEY)
      setStored(stored || null)
    } catch {
      setStored(null)
    }
    setReady(true)
  }, [])

  const setWorkspaceId = useCallback((id: string | null) => {
    setStored(id)
    try {
      if (id) window.localStorage.setItem(KEY, id)
      else window.localStorage.removeItem(KEY)
    } catch {
      /* private mode */
    }
  }, [])

  const value = useMemo(
    () => ({ workspaceId, setWorkspaceId, ready }),
    [workspaceId, setWorkspaceId, ready],
  )

  return <WorldFilterContext.Provider value={value}>{children}</WorldFilterContext.Provider>
}

export function useWorldFilter(): WorldFilterValue {
  const ctx = useContext(WorldFilterContext)
  if (!ctx) {
    return { workspaceId: null, setWorkspaceId: () => {}, ready: true }
  }
  return ctx
}

export function splitByWorld<T>(
  rows: T[],
  active: boolean,
  idOf: (row: T) => string | null | undefined,
): { matched: T[]; unassigned: T[] } {
  if (!active) return { matched: rows, unassigned: [] }
  return {
    matched: rows.filter((row) => !!idOf(row)),
    unassigned: rows.filter((row) => !idOf(row)),
  }
}

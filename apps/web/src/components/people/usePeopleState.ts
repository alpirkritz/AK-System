import { useState, useCallback, useMemo } from 'react'
import { trpc } from '@/lib/trpc'

export type SortField = 'name' | 'company' | 'lastContact' | 'createdAt' | 'goal' | 'role'
export type SortDir = 'asc' | 'desc'
export type ViewMode = 'table' | 'cards'

export interface PeopleFilters {
  search: string
  tags: string[]
  goal: string
  company: string
  contactNow: boolean
  lastContactPreset: '' | '7d' | '30d' | '90d+'
}

const EMPTY_FILTERS: PeopleFilters = {
  search: '',
  tags: [],
  goal: '',
  company: '',
  contactNow: false,
  lastContactPreset: '',
}

function lastContactPresetToDates(preset: string) {
  if (!preset) return {}
  const today = new Date()
  if (preset === '7d') {
    const d = new Date(today)
    d.setDate(d.getDate() - 7)
    return { lastContactAfter: d.toISOString().slice(0, 10) }
  }
  if (preset === '30d') {
    const d = new Date(today)
    d.setDate(d.getDate() - 30)
    return { lastContactAfter: d.toISOString().slice(0, 10) }
  }
  if (preset === '90d+') {
    const d = new Date(today)
    d.setDate(d.getDate() - 90)
    return { lastContactBefore: d.toISOString().slice(0, 10) }
  }
  return {}
}

export function usePeopleState() {
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [filters, setFilters] = useState<PeopleFilters>({ ...EMPTY_FILTERS })
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchTimer, setSearchTimer] = useState<ReturnType<typeof setTimeout> | null>(null)
  const [sortBy, setSortBy] = useState<SortField>('name')
  const [sortDir, setSortDir] = useState<SortDir>('asc')
  const [page, setPage] = useState(1)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [drawerPersonId, setDrawerPersonId] = useState<string | null>(null)
  const [isCreateOpen, setIsCreateOpen] = useState(false)

  const setSearch = useCallback((value: string) => {
    setFilters(f => ({ ...f, search: value }))
    if (searchTimer) clearTimeout(searchTimer)
    const timer = setTimeout(() => {
      setDebouncedSearch(value)
      setPage(1)
    }, 300)
    setSearchTimer(timer)
  }, [searchTimer])

  const setFilter = useCallback(<K extends keyof PeopleFilters>(key: K, value: PeopleFilters[K]) => {
    setFilters(f => ({ ...f, [key]: value }))
    setPage(1)
  }, [])

  const clearFilters = useCallback(() => {
    setFilters({ ...EMPTY_FILTERS })
    setDebouncedSearch('')
    setPage(1)
  }, [])

  const hasActiveFilters = useMemo(() => {
    return filters.search !== '' ||
      filters.tags.length > 0 ||
      filters.goal !== '' ||
      filters.company !== '' ||
      filters.contactNow ||
      filters.lastContactPreset !== ''
  }, [filters])

  const toggleSort = useCallback((field: SortField) => {
    if (sortBy === field) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(field)
      setSortDir('asc')
    }
    setPage(1)
  }, [sortBy])

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }, [])

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids))
  }, [])

  const deselectAll = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const dateFilters = lastContactPresetToDates(filters.lastContactPreset)

  const queryInput = useMemo(() => ({
    page,
    pageSize: 50,
    sortBy,
    sortDir,
    search: debouncedSearch || undefined,
    tags: filters.tags.length > 0 ? filters.tags : undefined,
    goal: filters.goal || undefined,
    company: filters.company || undefined,
    contactNow: filters.contactNow || undefined,
    ...dateFilters,
  }), [page, sortBy, sortDir, debouncedSearch, filters.tags, filters.goal, filters.company, filters.contactNow, dateFilters])

  const { data, isLoading, isError, refetch } = trpc.people.listPaginated.useQuery(queryInput, {
    staleTime: 30_000,
    keepPreviousData: true,
  })

  const { data: filterOptions } = trpc.people.filterOptions.useQuery(undefined, {
    staleTime: 60_000,
  })

  return {
    viewMode,
    setViewMode,
    filters,
    setSearch,
    setFilter,
    clearFilters,
    hasActiveFilters,
    sortBy,
    sortDir,
    toggleSort,
    page,
    setPage,
    selectedIds,
    toggleSelect,
    selectAll,
    deselectAll,
    drawerPersonId,
    setDrawerPersonId,
    isCreateOpen,
    setIsCreateOpen,
    data,
    isLoading,
    isError,
    refetch,
    filterOptions,
  }
}

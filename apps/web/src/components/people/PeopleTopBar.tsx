'use client'

import { Search, LayoutGrid, TableProperties, UserPlus } from 'lucide-react'
import type { ViewMode } from './usePeopleState'

interface Props {
  total: number
  search: string
  onSearchChange: (value: string) => void
  viewMode: ViewMode
  onViewModeChange: (mode: ViewMode) => void
  onAddPerson: () => void
}

export function PeopleTopBar({
  total,
  search,
  onSearchChange,
  viewMode,
  onViewModeChange,
  onAddPerson,
}: Props) {
  return (
    <div className="flex items-center gap-4 mb-5">
      <div className="flex items-center gap-3 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">אנשים</h1>
        <span className="pill text-[11px] tabular-nums">{total}</span>
      </div>

      <div className="flex-1 max-w-md relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#555] pointer-events-none" />
        <input
          type="text"
          className="input pr-10"
          placeholder="חיפוש אנשים..."
          value={search}
          onChange={e => onSearchChange(e.target.value)}
        />
      </div>

      <div className="flex items-center gap-1 mr-auto">
        <button
          className="toggle-btn flex items-center gap-1"
          aria-pressed={viewMode === 'table'}
          onClick={() => onViewModeChange('table')}
          title="תצוגת טבלה"
        >
          <TableProperties className="w-3.5 h-3.5" />
        </button>
        <button
          className="toggle-btn flex items-center gap-1"
          aria-pressed={viewMode === 'cards'}
          onClick={() => onViewModeChange('cards')}
          title="תצוגת כרטיסים"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
        </button>
      </div>

      <button className="btn btn-primary flex items-center gap-2 shrink-0" onClick={onAddPerson}>
        <UserPlus className="w-4 h-4" />
        הוסף איש קשר
      </button>
    </div>
  )
}

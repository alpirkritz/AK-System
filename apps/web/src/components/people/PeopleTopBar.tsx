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
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3 mb-4 sm:mb-5">
      <div className="flex items-center gap-3 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight">אנשים</h1>
        <span className="pill text-[11px] tabular-nums">{total}</span>
      </div>

      {/* Phone: the search drops to its own full-width line below the title/actions */}
      <div className="order-last basis-full sm:order-none sm:basis-auto sm:flex-1 sm:max-w-md relative">
        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#5a688c] pointer-events-none" />
        <input
          type="text"
          className="input !pr-10"
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

      <button className="btn btn-primary flex items-center gap-2 shrink-0" onClick={onAddPerson} aria-label="הוסף איש קשר">
        <UserPlus className="w-4 h-4" />
        <span className="hidden sm:inline">הוסף איש קשר</span>
        <span className="sm:hidden">הוסף</span>
      </button>
    </div>
  )
}

'use client'

import { ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { PersonRow } from './PersonRow'
import { PeopleEmptyState } from './PeopleEmptyState'
import { PeoplePagination } from './PeoplePagination'
import type { Person } from '@ak-system/database'
import type { SortField, SortDir } from './usePeopleState'

interface Props {
  items: Person[]
  total: number
  page: number
  pageSize: number
  isLoading: boolean
  isError: boolean
  sortBy: SortField
  sortDir: SortDir
  selectedIds: Set<string>
  hasActiveFilters: boolean
  onToggleSort: (field: SortField) => void
  onToggleSelect: (id: string) => void
  onSelectAll: (ids: string[]) => void
  onDeselectAll: () => void
  onOpenDrawer: (id: string) => void
  onPageChange: (page: number) => void
  onAddPerson: () => void
  onClearFilters: () => void
  onRetry: () => void
}

function SortIcon({ field, sortBy, sortDir }: { field: SortField; sortBy: SortField; sortDir: SortDir }) {
  if (sortBy !== field) return <ArrowUpDown className="w-3 h-3 opacity-0 group-hover/th:opacity-50 transition-opacity" />
  return sortDir === 'asc'
    ? <ArrowUp className="w-3 h-3 text-primary" />
    : <ArrowDown className="w-3 h-3 text-primary" />
}

const COLUMNS: { key: SortField | 'checkbox' | 'tags' | 'actions'; label: string; sortable: boolean; className?: string }[] = [
  { key: 'checkbox', label: '', sortable: false, className: 'w-[40px]' },
  { key: 'name', label: 'שם', sortable: true },
  { key: 'company', label: 'חברה', sortable: true, className: 'w-[160px]' },
  { key: 'role', label: 'תפקיד', sortable: true, className: 'w-[140px]' },
  { key: 'goal', label: 'יעד', sortable: true, className: 'w-[110px]' },
  { key: 'tags', label: 'תגיות', sortable: false, className: 'w-[160px]' },
  { key: 'lastContact', label: 'קשר אחרון', sortable: true, className: 'w-[130px]' },
  { key: 'actions', label: 'פעולות', sortable: false, className: 'w-[100px]' },
]

function SkeletonRows() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i} className="border-b border-[#1f1f1f]">
          <td className="table-cell w-[40px]"><div className="skeleton w-4 h-4 rounded" /></td>
          <td className="table-cell">
            <div className="flex items-center gap-2.5">
              <div className="skeleton w-8 h-8 rounded-full" />
              <div className="skeleton h-3.5 rounded" style={{ width: 80 + Math.random() * 60 }} />
            </div>
          </td>
          <td className="table-cell"><div className="skeleton h-3 rounded" style={{ width: 60 + Math.random() * 40 }} /></td>
          <td className="table-cell"><div className="skeleton h-3 rounded" style={{ width: 50 + Math.random() * 30 }} /></td>
          <td className="table-cell"><div className="skeleton h-5 w-16 rounded-full" /></td>
          <td className="table-cell">
            <div className="flex gap-1">
              <div className="skeleton h-4 w-12 rounded-full" />
              <div className="skeleton h-4 w-10 rounded-full" />
            </div>
          </td>
          <td className="table-cell"><div className="skeleton h-3 w-16 rounded" /></td>
          <td className="table-cell"><div className="skeleton h-5 w-16 rounded" /></td>
        </tr>
      ))}
    </>
  )
}

export function PeopleTable({
  items,
  total,
  page,
  pageSize,
  isLoading,
  isError,
  sortBy,
  sortDir,
  selectedIds,
  hasActiveFilters,
  onToggleSort,
  onToggleSelect,
  onSelectAll,
  onDeselectAll,
  onOpenDrawer,
  onPageChange,
  onAddPerson,
  onClearFilters,
  onRetry,
}: Props) {
  const allOnPageSelected = items.length > 0 && items.every(p => selectedIds.has(p.id))
  const someSelected = items.some(p => selectedIds.has(p.id))

  const handleSelectAllToggle = () => {
    if (allOnPageSelected) {
      onDeselectAll()
    } else {
      onSelectAll(items.map(p => p.id))
    }
  }

  if (isError) {
    return <PeopleEmptyState type="error" onRetry={onRetry} />
  }

  if (!isLoading && items.length === 0 && total === 0) {
    return (
      <PeopleEmptyState
        type={hasActiveFilters ? 'no-results' : 'no-data'}
        onAddPerson={onAddPerson}
        onClearFilters={onClearFilters}
      />
    )
  }

  return (
    <div>
      <div className="overflow-x-auto rounded-lg border border-[#2a2a2a]">
        <table className="w-full border-collapse" style={{ tableLayout: 'fixed' }}>
          <thead className="table-header">
            <tr>
              {COLUMNS.map(col => (
                <th
                  key={col.key}
                  className={cn(
                    col.className,
                    col.sortable && 'sortable group/th'
                  )}
                  onClick={() => {
                    if (col.key === 'checkbox') handleSelectAllToggle()
                    else if (col.sortable) onToggleSort(col.key as SortField)
                  }}
                >
                  {col.key === 'checkbox' ? (
                    <button
                      className="checkbox-btn"
                      aria-checked={allOnPageSelected ? 'true' : someSelected ? 'mixed' : 'false'}
                      aria-label="בחר הכל"
                    >
                      {allOnPageSelected && <span className="text-[10px]">✓</span>}
                      {someSelected && !allOnPageSelected && <span className="text-[10px]">—</span>}
                    </button>
                  ) : (
                    <div className="flex items-center gap-1">
                      <span>{col.label}</span>
                      {col.sortable && <SortIcon field={col.key as SortField} sortBy={sortBy} sortDir={sortDir} />}
                    </div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <SkeletonRows />
            ) : (
              items.map(person => (
                <PersonRow
                  key={person.id}
                  person={person}
                  selected={selectedIds.has(person.id)}
                  onToggleSelect={() => onToggleSelect(person.id)}
                  onOpenDrawer={() => onOpenDrawer(person.id)}
                />
              ))
            )}
          </tbody>
        </table>
      </div>

      {total > pageSize && (
        <PeoplePagination
          page={page}
          pageSize={pageSize}
          total={total}
          onPageChange={onPageChange}
        />
      )}
    </div>
  )
}

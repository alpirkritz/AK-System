'use client'

import { PersonCard } from './PersonCard'
import { PeopleEmptyState } from './PeopleEmptyState'
import { PeoplePagination } from './PeoplePagination'
import type { PersonWithAffiliations } from './affiliations'

interface Props {
  items: PersonWithAffiliations[]
  total: number
  page: number
  pageSize: number
  isLoading: boolean
  isError: boolean
  hasActiveFilters: boolean
  showUnassignedGroup?: boolean
  onOpenDrawer: (id: string) => void
  onPageChange: (page: number) => void
  onAddPerson: () => void
  onClearFilters: () => void
  onRetry: () => void
}

function SkeletonCards() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
      {Array.from({ length: 9 }).map((_, i) => (
        <div key={i} className="card p-5">
          <div className="flex gap-3 items-center mb-3">
            <div className="skeleton w-10 h-10 rounded-full" />
            <div className="flex-1">
              <div className="skeleton h-4 w-24 rounded mb-1.5" />
              <div className="skeleton h-3 w-16 rounded" />
            </div>
          </div>
          <div className="skeleton h-3 w-20 rounded mb-2" />
          <div className="flex gap-1 mb-3">
            <div className="skeleton h-4 w-12 rounded-full" />
            <div className="skeleton h-4 w-14 rounded-full" />
          </div>
          <div className="border-t border-[#223052] pt-2.5">
            <div className="skeleton h-3 w-28 rounded" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function PeopleCardGrid({
  items,
  total,
  page,
  pageSize,
  isLoading,
  isError,
  hasActiveFilters,
  showUnassignedGroup = false,
  onOpenDrawer,
  onPageChange,
  onAddPerson,
  onClearFilters,
  onRetry,
}: Props) {
  if (isError) {
    return <PeopleEmptyState type="error" onRetry={onRetry} />
  }

  if (isLoading) {
    return <SkeletonCards />
  }

  if (items.length === 0 && total === 0) {
    return (
      <PeopleEmptyState
        type={hasActiveFilters ? 'no-results' : 'no-data'}
        onAddPerson={onAddPerson}
        onClearFilters={onClearFilters}
      />
    )
  }

  const matched = showUnassignedGroup ? items.filter((p) => (p.affiliations?.length ?? 0) > 0) : items
  const unassigned = showUnassignedGroup ? items.filter((p) => (p.affiliations?.length ?? 0) === 0) : []

  return (
    <div>
      {matched.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {matched.map(person => (
            <PersonCard
              key={person.id}
              person={person}
              onOpenDrawer={() => onOpenDrawer(person.id)}
            />
          ))}
        </div>
      )}
      {unassigned.length > 0 && (
        <>
          <h2 className="text-xs font-semibold text-[#7a89ab] uppercase tracking-wider mt-8 mb-3">לא משויך ({unassigned.length})</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {unassigned.map(person => (
              <PersonCard
                key={person.id}
                person={person}
                onOpenDrawer={() => onOpenDrawer(person.id)}
              />
            ))}
          </div>
        </>
      )}

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

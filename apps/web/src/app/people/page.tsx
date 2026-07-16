'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { trpc } from '@/lib/trpc'
import { usePeopleState } from '@/components/people/usePeopleState'
import { PeopleTopBar } from '@/components/people/PeopleTopBar'
import { PeopleFilterBar } from '@/components/people/PeopleFilterBar'
import { PeopleTable } from '@/components/people/PeopleTable'
import { PeopleCardGrid } from '@/components/people/PeopleCardGrid'
import { BulkActionsToolbar } from '@/components/people/BulkActionsToolbar'
import { PeopleReviewQueue } from '@/components/people/PeopleReviewQueue'

const PersonDetailDrawer = dynamic(
  () => import('@/components/people/PersonDetailDrawer').then(m => m.PersonDetailDrawer),
  { ssr: false }
)
const PersonModal = dynamic(
  () => import('@/components/Modals/PersonModal').then(m => m.PersonModal),
  { ssr: false }
)

export default function PeoplePage() {
  const state = usePeopleState()
  const [tab, setTab] = useState<'contacts' | 'review'>('contacts')
  const { data: reviewQueue = [] } = trpc.people.reviewQueue.useQuery()

  const items = state.data?.items ?? []
  const total = state.data?.total ?? 0

  return (
    <div>
      <PeopleTopBar
        total={total}
        search={state.filters.search}
        onSearchChange={state.setSearch}
        viewMode={state.viewMode}
        onViewModeChange={state.setViewMode}
        onAddPerson={() => state.setIsCreateOpen(true)}
      />

      {/* Tabs: contacts vs review queue */}
      <div className="flex gap-1.5 mb-4">
        <button
          type="button"
          className="filter-chip"
          aria-pressed={tab === 'contacts'}
          onClick={() => setTab('contacts')}
        >
          אנשי קשר
        </button>
        <button
          type="button"
          className="filter-chip"
          aria-pressed={tab === 'review'}
          onClick={() => setTab('review')}
        >
          לאישור{reviewQueue.length > 0 ? ` (${reviewQueue.length})` : ''}
        </button>
      </div>

      {tab === 'review' ? (
        <PeopleReviewQueue />
      ) : (
      <>
      <PeopleFilterBar
        filters={state.filters}
        onSetFilter={state.setFilter}
        onClearFilters={state.clearFilters}
        hasActiveFilters={state.hasActiveFilters}
        filterOptions={state.filterOptions}
      />

      <BulkActionsToolbar
        selectedIds={state.selectedIds}
        onDeselectAll={state.deselectAll}
        allTags={state.filterOptions?.tags ?? []}
        onSuccess={() => state.refetch()}
        allPeople={items}
      />

      {state.viewMode === 'table' ? (
        <PeopleTable
          items={items}
          total={total}
          page={state.page}
          pageSize={50}
          isLoading={state.isLoading}
          isError={state.isError}
          sortBy={state.sortBy}
          sortDir={state.sortDir}
          selectedIds={state.selectedIds}
          hasActiveFilters={state.hasActiveFilters}
          onToggleSort={state.toggleSort}
          onToggleSelect={state.toggleSelect}
          onSelectAll={state.selectAll}
          onDeselectAll={state.deselectAll}
          onOpenDrawer={state.setDrawerPersonId}
          onPageChange={state.setPage}
          onAddPerson={() => state.setIsCreateOpen(true)}
          onClearFilters={state.clearFilters}
          onRetry={() => state.refetch()}
        />
      ) : (
        <PeopleCardGrid
          items={items}
          total={total}
          page={state.page}
          pageSize={50}
          isLoading={state.isLoading}
          isError={state.isError}
          hasActiveFilters={state.hasActiveFilters}
          onOpenDrawer={state.setDrawerPersonId}
          onPageChange={state.setPage}
          onAddPerson={() => state.setIsCreateOpen(true)}
          onClearFilters={state.clearFilters}
          onRetry={() => state.refetch()}
        />
      )}
      </>
      )}

      {state.drawerPersonId && (
        <PersonDetailDrawer
          personId={state.drawerPersonId}
          onClose={() => state.setDrawerPersonId(null)}
        />
      )}

      <PersonModal
        open={state.isCreateOpen}
        onClose={() => state.setIsCreateOpen(false)}
        editingId={null}
      />
    </div>
  )
}

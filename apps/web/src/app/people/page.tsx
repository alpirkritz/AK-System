'use client'

import dynamic from 'next/dynamic'
import { usePeopleState } from '@/components/people/usePeopleState'
import { PeopleTopBar } from '@/components/people/PeopleTopBar'
import { PeopleFilterBar } from '@/components/people/PeopleFilterBar'
import { PeopleTable } from '@/components/people/PeopleTable'
import { PeopleCardGrid } from '@/components/people/PeopleCardGrid'
import { BulkActionsToolbar } from '@/components/people/BulkActionsToolbar'

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

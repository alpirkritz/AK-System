'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { trpc } from '@/lib/trpc'
import { usePeopleState } from '@/components/people/usePeopleState'
import { PeopleTopBar } from '@/components/people/PeopleTopBar'
import { PeopleFilterBar } from '@/components/people/PeopleFilterBar'
import { PeopleTable } from '@/components/people/PeopleTable'
import { PeopleCardGrid } from '@/components/people/PeopleCardGrid'
import { BulkActionsToolbar } from '@/components/people/BulkActionsToolbar'
import { PeopleReviewQueue } from '@/components/people/PeopleReviewQueue'
import { GooglePhoneFillModal } from '@/components/people/GooglePhoneFillModal'

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
  const [phoneFillOpen, setPhoneFillOpen] = useState(false)
  const { data: reviewQueue = [] } = trpc.people.reviewQueue.useQuery()
  const { data: duplicates } = trpc.people.findDuplicates.useQuery(undefined, { staleTime: 60_000 })
  const { data: flags } = trpc.insights.relationshipFlags.useQuery(undefined, { staleTime: 60_000 })
  const { data: notionState } = trpc.tasks.notionConfigured.useQuery()
  const utils = trpc.useUtils()
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const syncFromNotion = trpc.tasks.syncFromNotion.useMutation({
    onSuccess: (res) => {
      const imported = res.peopleCreated + res.peopleUpdated
      setSyncMessage(
        res.errors.length > 0
          ? `יובאו/עודכנו ${imported} אנשי קשר · ${res.errors.length} שגיאות`
          : `יובאו/עודכנו ${imported} אנשי קשר מ-Notion`,
      )
      utils.people.invalidate()
    },
    onError: (err) => setSyncMessage(err.message || 'הסנכרון נכשל'),
  })
  const warmthById: Record<string, 'warming' | 'cooling'> = {}
  for (const p of flags?.cooling ?? []) warmthById[p.personId] = 'cooling'
  for (const p of flags?.warming ?? []) warmthById[p.personId] = 'warming'
  const duplicateCount = duplicates?.pairs.length ?? 0

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
        <Link href="/people/duplicates" className="filter-chip" data-testid="duplicates-link">
          {duplicateCount > 0 ? `${duplicateCount} כפילויות חשודות` : 'כפילויות'}
        </Link>
        {notionState?.configured && (
          <button
            type="button"
            className="btn btn-secondary text-xs py-1 px-3 ms-auto"
            data-testid="people-notion-sync"
            disabled={syncFromNotion.isPending}
            title="סנכרן אנשים מ-Notion"
            onClick={() => {
              setSyncMessage(null)
              syncFromNotion.mutate({ windowDays: 60, dryRun: false })
            }}
          >
            {syncFromNotion.isPending ? 'מסנכרן…' : 'סנכרן מ-Notion'}
          </button>
        )}
        <button
          type="button"
          className={`btn btn-ghost text-xs py-1 px-3${notionState?.configured ? '' : ' ms-auto'}`}
          data-testid="google-phone-fill"
          onClick={() => setPhoneFillOpen(true)}
        >
          טלפונים מגוגל
        </button>
      </div>

      {syncMessage && (
        <div className="mb-4 text-sm text-[#9fb0d4] bg-[#141b2e] border border-[#26324d] rounded-lg px-3 py-2">
          {syncMessage}
        </div>
      )}

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
          warmthById={warmthById}
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

      {phoneFillOpen && <GooglePhoneFillModal onClose={() => setPhoneFillOpen(false)} />}
    </div>
  )
}

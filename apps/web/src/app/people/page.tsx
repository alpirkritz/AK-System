'use client'

import { Suspense, useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { trpc } from '@/lib/trpc'
import { usePeopleState } from '@/components/people/usePeopleState'
import { PeopleTopBar } from '@/components/people/PeopleTopBar'
import { PeopleFilterBar } from '@/components/people/PeopleFilterBar'
import { PeopleTable } from '@/components/people/PeopleTable'
import { PeopleCardGrid } from '@/components/people/PeopleCardGrid'
import { BulkActionsToolbar } from '@/components/people/BulkActionsToolbar'
import { PeopleReviewQueue } from '@/components/people/PeopleReviewQueue'
import { IdentityQueueCard } from '@/components/people/IdentityQueueCard'
import { GooglePhoneFillModal } from '@/components/people/GooglePhoneFillModal'
import { GoogleProfileFillModal } from '@/components/people/GoogleProfileFillModal'
import { FilteredWorldChip } from '@/components/WorldSwitcher'

const PersonDetailDrawer = dynamic(
  () => import('@/components/people/PersonDetailDrawer').then(m => m.PersonDetailDrawer),
  { ssr: false }
)
const PersonModal = dynamic(
  () => import('@/components/Modals/PersonModal').then(m => m.PersonModal),
  { ssr: false }
)

/**
 * Opens a person's drawer from `/people?person=<id>`, the deep link the harness widget and
 * notifications use. Isolated behind Suspense because `useSearchParams` needs a boundary
 * above it, same as `OpenNewMeeting` on the meetings page.
 */
function OpenPersonFromQuery({ onOpen }: { onOpen: (personId: string) => void }) {
  const searchParams = useSearchParams()
  const router = useRouter()
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  const opened = useRef(false)

  useEffect(() => {
    const personId = searchParams.get('person')
    if (opened.current || !personId) return
    opened.current = true
    onOpenRef.current(personId)
    // Drop the param so closing the drawer and refreshing does not reopen it.
    router.replace('/people', { scroll: false })
  }, [searchParams, router])

  return null
}

export default function PeoplePage() {
  const state = usePeopleState()
  const [tab, setTab] = useState<'contacts' | 'review'>('contacts')
  const [phoneFillOpen, setPhoneFillOpen] = useState(false)
  const [profileFillOpen, setProfileFillOpen] = useState(false)
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
  const warmthById: Record<string, 'needs_1on1'> = {}
  for (const p of flags?.needs1on1 ?? []) warmthById[p.personId] = 'needs_1on1'
  const duplicateCount = duplicates?.pairs.length ?? 0

  const items = state.data?.items ?? []
  const total = state.data?.total ?? 0

  return (
    <div>
      <Suspense fallback={null}>
        <OpenPersonFromQuery onOpen={state.setDrawerPersonId} />
      </Suspense>
      <PeopleTopBar
        total={total}
        search={state.filters.search}
        onSearchChange={state.setSearch}
        viewMode={state.viewMode}
        onViewModeChange={state.setViewMode}
        onAddPerson={() => state.setIsCreateOpen(true)}
      />

      {/* Tabs: contacts vs review queue */}
      <div className="flex flex-wrap items-center gap-1.5 mb-4">
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
        <button
          type="button"
          className="btn btn-ghost text-xs py-1 px-3"
          data-testid="google-profile-fill"
          onClick={() => setProfileFillOpen(true)}
        >
          פרטים מגוגל
        </button>
      </div>

      {syncMessage && (
        <div className="mb-4 text-sm text-[#9fb0d4] bg-[#141b2e] border border-[#26324d] rounded-lg px-3 py-2">
          {syncMessage}
        </div>
      )}

      <IdentityQueueCard />

      {tab === 'review' ? (
        <PeopleReviewQueue />
      ) : (
      <>
      <FilteredWorldChip />
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
          showUnassignedGroup={!!state.worldFilter}
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
          showUnassignedGroup={!!state.worldFilter}
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
      {profileFillOpen && <GoogleProfileFillModal onClose={() => setProfileFillOpen(false)} />}
    </div>
  )
}

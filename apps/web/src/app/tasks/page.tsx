'use client'

import { useMemo, useState, useEffect, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { trpc } from '@/lib/trpc'
import { PRIORITY_COLORS, PRIORITY_LABELS, STATUS_LABELS } from '@ak-system/types'
import { WorkspacePill } from '@/components/WorkspacePill'
import { StatusPill } from '@/components/StatusPill'
import { notionPeopleSyncMessage } from '@/lib/notion-people-sync-message'
import {
  sortTasksByKeys,
  TASK_SORT_KEYS,
  TASK_SORT_LABELS,
  type TaskSortKey,
  type SortPref,
} from '@/lib/sort-keys'
import { groupTasksByDueState } from '@/lib/sort-tasks'
import { ThenBySort } from '@/components/ThenBySort'
import { LS } from '@/lib/ls-keys'
import { formatDueLabel, isOverdueOpenTask } from '@/lib/task-due'
import { isMyTask } from '@/lib/my-tasks'
import dynamic from 'next/dynamic'
const TaskModal = dynamic(() => import('@/components/Modals/TaskModal').then((m) => m.TaskModal), { ssr: false })

type StatusFilter = 'open' | 'overdue' | 'done' | 'cancelled' | 'all'
type OwnerFilter = 'me' | 'all'

function parseOwner(value: string | null): OwnerFilter {
  return value === 'all' ? 'all' : 'me'
}

function parseStatus(value: string | null): StatusFilter {
  if (value === 'overdue' || value === 'done' || value === 'cancelled' || value === 'all' || value === 'open') {
    return value
  }
  return 'open'
}

/**
 * Cancelled tasks also carry `done = true`, so the boolean alone cannot tell "finished" from
 * "abandoned". Prefer the rich status; fall back for rows written before the column existed.
 */
function effectiveStatus(t: { status?: string | null; done?: boolean | null }): string {
  return t.status ?? (t.done ? 'done' : 'not_started')
}

function TasksPageContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const statusQuery = searchParams.get('status')
  const ownerQuery = searchParams.get('owner')
  const { data: tasksList = [], isLoading: tasksLoading } = trpc.tasks.list.useQuery()
  const { data: selfPerson, isLoading: selfLoading } = trpc.people.me.useQuery()
  const { data: people = [] } = trpc.people.list.useQuery()
  const { data: meetings = [] } = trpc.meetings.list.useQuery()
  const { data: projects = [] } = trpc.projects.list.useQuery()
  const { data: workspaces = [] } = trpc.workspaces.list.useQuery()
  const { data: notionState } = trpc.tasks.notionConfigured.useQuery()
  const { data: settingsData } = trpc.settings.listSort.get.useQuery()
  const utils = trpc.useUtils()
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [taskSort, setTaskSort] = useState<SortPref<TaskSortKey> | null>(null)
  const toggleTask = trpc.tasks.toggleDone.useMutation({
    onSuccess: (res) => {
      utils.tasks.list.invalidate()
      const sync = (res as { notionSync?: { ok: boolean } | null } | null)?.notionSync
      if (sync && !sync.ok) {
        setSyncMessage('עודכן מקומית, אבל העדכון ל-Notion נכשל')
      }
    },
  })
  const syncFromNotion = trpc.tasks.syncFromNotion.useMutation({
    onSuccess: (res) => {
      const imported = res.tasksCreated + res.tasksUpdated
      setSyncMessage(
        res.errors.length > 0
          ? `יובאו ${imported} משימות · ${res.errors.length} שגיאות`
          : `יובאו ${imported} משימות מ-Notion`,
      )
      utils.tasks.list.invalidate()
      utils.people.list.invalidate()
    },
    onError: (err) => setSyncMessage(err.message || 'הסנכרון נכשל'),
  })
  const [taskModalOpen, setTaskModalOpen] = useState(false)
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null)

  const [status, setStatus] = useState<StatusFilter>(() => parseStatus(statusQuery))
  const [owner, setOwner] = useState<OwnerFilter>(() => parseOwner(ownerQuery))
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [projectId, setProjectId] = useState<string>('')
  const [meetingId, setMeetingId] = useState<string>('')
  const [workspaceId, setWorkspaceId] = useState<string>('')
  const [search, setSearch] = useState('')

  useEffect(() => {
    setStatus(parseStatus(statusQuery))
  }, [statusQuery])

  useEffect(() => {
    setOwner(parseOwner(ownerQuery))
  }, [ownerQuery])

  const selectStatus = (next: StatusFilter) => {
    setStatus(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'open') params.delete('status')
    else params.set('status', next)
    const q = params.toString()
    router.replace(q ? `/tasks?${q}` : '/tasks', { scroll: false })
  }

  const selectOwner = (next: OwnerFilter) => {
    setOwner(next)
    const params = new URLSearchParams(searchParams.toString())
    if (next === 'me') params.delete('owner')
    else params.set('owner', 'all')
    const q = params.toString()
    router.replace(q ? `/tasks?${q}` : '/tasks', { scroll: false })
  }

  const serverDefault = settingsData?.prefs?.tasksPage

  useEffect(() => {
    try {
      const sortRaw = localStorage.getItem(LS.TASKS_PAGE_SORT)
      if (sortRaw) {
        const parsed = JSON.parse(sortRaw)
        if (parsed && typeof parsed === 'object' && 'primary' in parsed) {
          setTaskSort(parsed)
        }
      }
    } catch { /* ignore */ }
  }, [])

  const effectiveSort = taskSort ?? serverDefault ?? { primary: 'priority_high' as TaskSortKey, thenBy: 'due_asc' as TaskSortKey }
  const hasOverride = taskSort !== null

  const setTaskSortAndPersist = (value: SortPref<TaskSortKey>) => {
    setTaskSort(value)
    try {
      localStorage.setItem(LS.TASKS_PAGE_SORT, JSON.stringify(value))
    } catch { /* ignore */ }
  }

  const resetToDefault = () => {
    setTaskSort(null)
    try {
      localStorage.removeItem(LS.TASKS_PAGE_SORT)
    } catch { /* ignore */ }
  }

  const getPerson = (id: string) => people.find((p) => p.id === id)
  const getMeeting = (id: string) => meetings.find((m) => m.id === id)
  const getProject = (id: string) => projects.find((p) => p.id === id)
  const getWorkspace = (id?: string | null) => (id ? workspaces.find((w) => w.id === id) : undefined)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tasksList.filter((t) => {
      const st = effectiveStatus(t as { status?: string | null; done?: boolean | null })
      if (status === 'overdue' && !isOverdueOpenTask(t)) return false
      if (status === 'open' && (st === 'done' || st === 'cancelled')) return false
      if (status === 'done' && st !== 'done') return false
      if (status === 'cancelled' && st !== 'cancelled') return false
      if (projectId && (t as { projectId?: string }).projectId !== projectId) return false
      if (meetingId && t.meetingId !== meetingId) return false
      if (workspaceId && (t as { workspaceId?: string | null }).workspaceId !== workspaceId) return false
      if (owner === 'me' && !isMyTask(t.assigneeId, selfPerson?.id)) return false
      if (q && !t.title.toLowerCase().includes(q)) return false
      return true
    })
  }, [tasksList, status, projectId, meetingId, workspaceId, search, owner, selfPerson?.id])

  const sorted = useMemo(() => {
    return sortTasksByKeys(filtered, effectiveSort)
  }, [filtered, effectiveSort])

  const grouped = useMemo(() => {
    const tone: Record<string, string> = {
      overdue: '#fb7185',
      upcoming: '#2dd4bf',
      done: '#647399',
      cancelled: '#94a3b8',
    }
    return groupTasksByDueState(sorted).map((group) => ({
      ...group,
      color: tone[group.key],
    }))
  }, [sorted])

  const hasActiveFilter = status !== 'open' || owner === 'all' || !!projectId || !!meetingId || !!workspaceId || !!search
  const isLoading = tasksLoading || (owner === 'me' && selfLoading)

  const advancedCount = [projectId, meetingId, workspaceId].filter(Boolean).length

  const statusTabs: { id: StatusFilter; label: string }[] = [
    { id: 'open', label: 'פתוחות' },
    { id: 'overdue', label: 'באיחור' },
    { id: 'done', label: 'הושלמו' },
    { id: 'cancelled', label: 'בוטלו' },
    { id: 'all', label: 'הכל' },
  ]

  return (
    <div>
      <div className="flex justify-between items-center mb-5">
        <h1 className="text-2xl font-bold tracking-tight">משימות</h1>
        <div className="flex items-center gap-2">
          {notionState?.configured && (
            <button
              className="btn btn-secondary"
              disabled={syncFromNotion.isPending}
              onClick={() => {
                setSyncMessage(null)
                syncFromNotion.mutate({ windowDays: 60, dryRun: false })
              }}
              title="סנכרן משימות ואנשים מ-Notion (60 הימים האחרונים)"
            >
              {syncFromNotion.isPending ? 'מסנכרן…' : 'סנכרן מ-Notion'}
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingTaskId(null)
              setTaskModalOpen(true)
            }}
          >
            + משימה חדשה
          </button>
        </div>
      </div>

      {syncMessage && (
        <div className="mb-4 text-sm text-[#9fb0d4] bg-[#141b2e] border border-[#26324d] rounded-lg px-3 py-2">
          {syncMessage}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="סינון לפי אחראי">
          <button
            type="button"
            className="filter-chip"
            aria-pressed={owner === 'me'}
            onClick={() => selectOwner('me')}
          >
            שלי
          </button>
          <button
            type="button"
            className="filter-chip"
            aria-pressed={owner === 'all'}
            onClick={() => selectOwner('all')}
          >
            כולם
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="סינון לפי מצב">
          {statusTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className="filter-chip"
              aria-pressed={status === tab.id}
              onClick={() => selectStatus(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <input
          className="input w-auto min-w-[200px] flex-1"
          placeholder="חיפוש משימה…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button
          type="button"
          className="btn btn-ghost min-h-[44px]"
          aria-expanded={filtersOpen}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          {advancedCount > 0 ? `סינון (${advancedCount})` : 'סינון'}
        </button>
      </div>

      <ThenBySort
        value={effectiveSort}
        onChange={setTaskSortAndPersist}
        fields={TASK_SORT_KEYS.map((k) => ({ value: k, label: TASK_SORT_LABELS[k] }))}
        showReset={hasOverride}
        onReset={resetToDefault}
        className="min-w-[200px] mb-4"
      />

      {filtersOpen && (
        <div className="flex flex-wrap items-start gap-4 mb-6">
          {workspaces.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="סינון לפי מקור">
              <span className="text-[11px] font-medium text-[#647399] uppercase tracking-wider ml-1">מקור</span>
              <button
                type="button"
                className="filter-chip"
                aria-pressed={workspaceId === ''}
                onClick={() => setWorkspaceId('')}
              >
                הכל
              </button>
              {workspaces.map((w) => {
                const active = workspaceId === w.id
                const color = w.color ?? '#2dd4bf'
                return (
                  <button
                    key={w.id}
                    type="button"
                    className="filter-chip"
                    aria-pressed={active}
                    style={active ? { background: color + '1a', borderColor: color + '40', color } : undefined}
                    onClick={() => setWorkspaceId(active ? '' : w.id)}
                  >
                    {w.name}
                  </button>
                )
              })}
            </div>
          )}
          <select className="select w-auto min-w-[130px]" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">כל הפרויקטים</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
          <select className="select w-auto min-w-[130px]" value={meetingId} onChange={(e) => setMeetingId(e.target.value)}>
            <option value="">כל הפגישות</option>
            {meetings.map((m) => (
              <option key={m.id} value={m.id}>{m.title}</option>
            ))}
          </select>
        </div>
      )}

      {isLoading ? (
        <div className="card">
          <div className="skeleton h-5 w-1/3 mb-3" />
          <div className="skeleton h-5 w-2/3 mb-3" />
          <div className="skeleton h-5 w-1/2" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card text-center py-12">
          <div className="text-3xl mb-3">✓</div>
          <div className="text-[#eef3fb] font-medium mb-1">
            {owner === 'me' && status === 'open' && !projectId && !meetingId && !workspaceId && !search
              ? 'אין משימות שמוקצות אליך'
              : status === 'overdue'
                ? 'אין משימות באיחור'
                : hasActiveFilter
                  ? 'אין משימות שתואמות לסינון'
                  : 'אין משימות פתוחות'}
          </div>
          <div className="text-sm text-[#647399] mb-4">
            {owner === 'me' && status === 'open' && !projectId && !meetingId && !workspaceId && !search
              ? 'משימות של אחרים נמצאות תחת ״כולם״.'
              : status === 'overdue'
                ? 'אפשר לעבור ל״פתוחות״ כדי לראות את השאר.'
                : hasActiveFilter
                  ? 'נסה לשנות את המסננים'
                  : 'הכול נקי. אפשר להוסיף משימה חדשה.'}
          </div>
          <button
            className="btn btn-primary"
            onClick={() => {
              setEditingTaskId(null)
              setTaskModalOpen(true)
            }}
          >
            + משימה חדשה
          </button>
        </div>
      ) : (
        grouped.map((group) => {
          if (!group.tasks.length) return null
          return (
            <div key={group.key} className="mb-7">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-2 h-2 rounded-full" style={{ background: group.color }} />
                <span className="text-xs font-semibold text-[#7a89ab] uppercase tracking-wider">
                  {group.label}
                </span>
                <span className="text-xs text-[#4d659c]">({group.tasks.length})</span>
              </div>
              <div className="card py-1 px-4">
                {group.tasks.map((t) => {
                  const meeting = getMeeting(t.meetingId ?? '')
                  const isCancelled =
                    effectiveStatus(t as { status?: string | null; done?: boolean | null }) === 'cancelled'
                  const priorityKey = t.priority as keyof typeof PRIORITY_COLORS
                  const priorityColor = PRIORITY_COLORS[priorityKey] ?? PRIORITY_COLORS.medium
                  const priorityLabel = PRIORITY_LABELS[priorityKey] ?? PRIORITY_LABELS.medium
                  return (
                    <div key={t.id} className="task-row">
                      <button
                        type="button"
                        className="checkbox-btn"
                        role="checkbox"
                        aria-checked={t.done}
                        aria-label={
                          isCancelled ? 'שחזר משימה שבוטלה' : t.done ? 'סמן כלא בוצע' : 'סמן כבוצע'
                        }
                        onClick={() => toggleTask.mutate({ id: t.id })}
                      >
                        {t.done && <span className="text-[10px]">{isCancelled ? '✕' : '✓'}</span>}
                      </button>
                      <div
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{ background: priorityColor }}
                        title={`עדיפות ${priorityLabel}`}
                        aria-label={`עדיפות ${priorityLabel}`}
                      />
                      <div
                        className="flex-1 text-sm cursor-pointer hover:text-[#fff] transition-colors min-w-0"
                        style={{
                          textDecoration: t.done ? 'line-through' : 'none',
                          color: t.done ? '#5a688c' : '#eef3fb',
                        }}
                        onClick={() => {
                          setEditingTaskId(t.id)
                          setTaskModalOpen(true)
                        }}
                        title="ערוך משימה"
                      >
                        {t.title}
                        {formatDueLabel(t) && (
                          <span className="text-[11px] text-[#647399] mr-2"> · {formatDueLabel(t)}</span>
                        )}
                      </div>
                      <StatusPill status={(t as { status?: string | null }).status} />
                      <WorkspacePill workspace={getWorkspace((t as { workspaceId?: string | null }).workspaceId)} />
                      {t.projectId && getProject(t.projectId) && (
                        <Link href={`/projects/${t.projectId}`}>
                          <span className="pill cursor-pointer text-[11px]">📁 {getProject(t.projectId)?.name}</span>
                        </Link>
                      )}
                      {meeting && (
                        <Link href={`/meetings/${meeting.id}`}>
                          <span className="pill cursor-pointer">◈ {meeting.title}</span>
                        </Link>
                      )}
                      {t.assigneeId && (
                        <div
                          className="avatar w-6 h-6 text-[10px] border"
                          style={{
                            background: (getPerson(t.assigneeId!)?.color ?? '#2dd4bf') + '22',
                            color: getPerson(t.assigneeId!)?.color ?? '#2dd4bf',
                            borderColor: (getPerson(t.assigneeId!)?.color ?? '#2dd4bf') + '33',
                          }}
                        >
                          {getPerson(t.assigneeId!)?.name[0]}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })
      )}

      <TaskModal
        open={taskModalOpen}
        onClose={() => {
          setTaskModalOpen(false)
          setEditingTaskId(null)
        }}
        editingTaskId={editingTaskId}
        people={people}
        meetings={meetings.map((m) => ({ id: m.id, title: m.title }))}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        workspaces={workspaces.map((w) => ({
          id: w.id,
          name: w.name,
          hasNotionLink: ((w as { notionDatabases?: unknown[] }).notionDatabases?.length ?? 0) > 0,
        }))}
        onCreated={(sync) => {
          if (sync && !sync.ok) setSyncMessage('המשימה נשמרה, אבל לא נוצרה ב-Notion')
        }}
        onPeopleSync={(sync) => {
          const message = notionPeopleSyncMessage(sync)
          if (message) setSyncMessage(message)
        }}
      />
    </div>
  )
}

export default function TasksPage() {
  return (
    <Suspense fallback={<div className="card text-sm text-[#7a89ab] py-4 px-5">טוען משימות…</div>}>
      <TasksPageContent />
    </Suspense>
  )
}

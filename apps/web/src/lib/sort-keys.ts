import { TASK_STATUS_ORDER } from '@ak-system/types'

// ── Task Sort Keys ─────────────────────────────────────────────────────────────

export const TASK_SORT_KEYS = [
  'priority_high',
  'priority_low',
  'due_asc',
  'due_desc',
  'status_workflow',
  'status_reverse',
  'created_desc',
  'created_asc',
  'none',
] as const

export type TaskSortKey = (typeof TASK_SORT_KEYS)[number]

export const TASK_SORT_LABELS: Record<TaskSortKey, string> = {
  priority_high: 'עדיפות (גבוהה קודם)',
  priority_low: 'עדיפות (נמוכה קודם)',
  due_asc: 'תאריך יעד (קרוב)',
  due_desc: 'תאריך יעד (רחוק)',
  status_workflow: 'סטטוס (זרימת עבודה)',
  status_reverse: 'סטטוס (הפוך)',
  created_desc: 'נוצר (חדשות קודם)',
  created_asc: 'נוצר (ישנות קודם)',
  none: 'ללא',
}

// ── Meeting Sort Keys ──────────────────────────────────────────────────────────

export const MEETING_SORT_KEYS = [
  'date_desc',
  'date_asc',
  'title_asc',
  'title_desc',
  'project',
  'none',
] as const

export type MeetingSortKey = (typeof MEETING_SORT_KEYS)[number]

export const MEETING_SORT_LABELS: Record<MeetingSortKey, string> = {
  date_desc: 'תאריך (חדש)',
  date_asc: 'תאריך (ישן)',
  title_asc: 'כותרת (א–ת)',
  title_desc: 'כותרת (ת–א)',
  project: 'פרויקט',
  none: 'ללא',
}

// ── Sort Preferences ───────────────────────────────────────────────────────────

export type SortPref<K = string> = {
  primary: K
  thenBy: K | 'none'
}

export type ListSortPrefs = {
  dashboardTasks: SortPref<TaskSortKey>
  tasksPage: SortPref<TaskSortKey>
  meetingsPast: SortPref<MeetingSortKey>
}

export const DEFAULT_LIST_SORT_PREFS: ListSortPrefs = {
  dashboardTasks: { primary: 'due_asc', thenBy: 'priority_high' },
  tasksPage: { primary: 'priority_high', thenBy: 'due_asc' },
  meetingsPast: { primary: 'date_desc', thenBy: 'none' },
}

// ── Legacy Migration ───────────────────────────────────────────────────────────

export function migrateLegacyDashboardSort(legacy: string): SortPref<TaskSortKey> | null {
  const map: Record<string, SortPref<TaskSortKey>> = {
    due_asc: { primary: 'due_asc', thenBy: 'priority_high' },
    due_desc: { primary: 'due_desc', thenBy: 'priority_high' },
    priority: { primary: 'priority_high', thenBy: 'due_asc' },
    created_desc: { primary: 'created_desc', thenBy: 'due_asc' },
    status: { primary: 'status_workflow', thenBy: 'due_asc' },
  }
  return map[legacy] ?? null
}

// ── Comparators ────────────────────────────────────────────────────────────────

const PRIORITY_RANK: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
}

const STATUS_RANK = new Map(TASK_STATUS_ORDER.map((s, i) => [s, i]))

function dueKey(dueDate?: string | null, missingLast = true): string {
  const d = dueDate?.slice(0, 10)
  if (d) return d
  return missingLast ? '9999-12-31' : '0000-01-01'
}

function compareTasks<T extends {
  id?: string
  priority?: string | null
  dueDate?: string | null
  status?: string | null
  createdAt?: string | null
}>(a: T, b: T, key: TaskSortKey): number {
  switch (key) {
    case 'priority_high': {
      const pa = PRIORITY_RANK[a.priority ?? 'medium'] ?? 1
      const pb = PRIORITY_RANK[b.priority ?? 'medium'] ?? 1
      return pa - pb
    }
    case 'priority_low': {
      const pa = PRIORITY_RANK[a.priority ?? 'medium'] ?? 1
      const pb = PRIORITY_RANK[b.priority ?? 'medium'] ?? 1
      return pb - pa
    }
    case 'due_asc': {
      return dueKey(a.dueDate).localeCompare(dueKey(b.dueDate))
    }
    case 'due_desc': {
      const aMissing = !a.dueDate?.slice(0, 10)
      const bMissing = !b.dueDate?.slice(0, 10)
      if (aMissing !== bMissing) return aMissing ? 1 : -1
      return dueKey(b.dueDate, false).localeCompare(dueKey(a.dueDate, false))
    }
    case 'status_workflow': {
      const sa = STATUS_RANK.get((a.status ?? 'not_started') as (typeof TASK_STATUS_ORDER)[number]) ?? 99
      const sb = STATUS_RANK.get((b.status ?? 'not_started') as (typeof TASK_STATUS_ORDER)[number]) ?? 99
      return sa - sb
    }
    case 'status_reverse': {
      const sa = STATUS_RANK.get((a.status ?? 'not_started') as (typeof TASK_STATUS_ORDER)[number]) ?? 99
      const sb = STATUS_RANK.get((b.status ?? 'not_started') as (typeof TASK_STATUS_ORDER)[number]) ?? 99
      return sb - sa
    }
    case 'created_desc': {
      const ca = a.createdAt ?? ''
      const cb = b.createdAt ?? ''
      return cb.localeCompare(ca)
    }
    case 'created_asc': {
      const ca = a.createdAt ?? ''
      const cb = b.createdAt ?? ''
      return ca.localeCompare(cb)
    }
    default:
      return (a.id ?? '').localeCompare(b.id ?? '')
  }
}

function compareMeetings<T extends {
  id?: string
  title?: string
  date?: string
  time?: string
  projectId?: string | null
}>(a: T, b: T, key: MeetingSortKey): number {
  switch (key) {
    case 'date_desc': {
      const da = `${a.date ?? '0000-01-01'}T${a.time ?? '00:00'}`
      const db = `${b.date ?? '0000-01-01'}T${b.time ?? '00:00'}`
      return db.localeCompare(da)
    }
    case 'date_asc': {
      const da = `${a.date ?? '0000-01-01'}T${a.time ?? '00:00'}`
      const db = `${b.date ?? '0000-01-01'}T${b.time ?? '00:00'}`
      return da.localeCompare(db)
    }
    case 'title_asc': {
      return (a.title ?? '').localeCompare(b.title ?? '', 'he')
    }
    case 'title_desc': {
      return (b.title ?? '').localeCompare(a.title ?? '', 'he')
    }
    case 'project': {
      const pa = a.projectId ?? ''
      const pb = b.projectId ?? ''
      if (pa !== pb) return pa.localeCompare(pb)
      return (a.title ?? '').localeCompare(b.title ?? '', 'he')
    }
    default:
      return (a.id ?? '').localeCompare(b.id ?? '')
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

type SortableTask = {
  id?: string
  priority?: string | null
  dueDate?: string | null
  status?: string | null
  createdAt?: string | null
}

export function sortTasksByKeys<T extends readonly any[]>(
  tasks: T,
  pref: SortPref<TaskSortKey>,
): T[number][] {
  const list = [...tasks] as SortableTask[]
  list.sort((a, b) => {
    const primaryCmp = compareTasks(a, b, pref.primary)
    if (primaryCmp !== 0 || pref.thenBy === 'none') return primaryCmp
    return compareTasks(a, b, pref.thenBy as TaskSortKey)
  })
  return list as T[number][]
}

export function sortMeetingsByKeys<T extends {
  id?: string
  title?: string
  date?: string
  time?: string
  projectId?: string | null
}>(meetings: T[], pref: SortPref<MeetingSortKey>): T[] {
  return [...meetings].sort((a, b) => {
    const primaryCmp = compareMeetings(a, b, pref.primary)
    if (primaryCmp !== 0 || pref.thenBy === 'none') return primaryCmp
    return compareMeetings(a, b, pref.thenBy as MeetingSortKey)
  })
}

// ── Grouping Helpers ───────────────────────────────────────────────────────────

export type TaskPrimaryGroup = 'priority' | 'due_date' | 'status' | 'created' | 'none'

export function getTaskPrimaryGroup(key: TaskSortKey): TaskPrimaryGroup {
  if (key === 'priority_high' || key === 'priority_low') return 'priority'
  if (key === 'due_asc' || key === 'due_desc') return 'due_date'
  if (key === 'status_workflow' || key === 'status_reverse') return 'status'
  if (key === 'created_desc' || key === 'created_asc') return 'created'
  return 'none'
}

export function isTaskSortKey(value: unknown): value is TaskSortKey {
  return typeof value === 'string' && TASK_SORT_KEYS.includes(value as TaskSortKey)
}

export function isMeetingSortKey(value: unknown): value is MeetingSortKey {
  return typeof value === 'string' && MEETING_SORT_KEYS.includes(value as MeetingSortKey)
}

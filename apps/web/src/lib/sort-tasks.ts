import { TASK_STATUS_ORDER } from '@ak-system/types'
import { isOverdueOpenTask, todayKey } from './task-due'

/** Open first, then due date oldest → newest (missing due date last). */
export function sortTasksOpenThenDueAsc<T extends { done: boolean; dueDate?: string | null }>(
  tasks: T[],
): T[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1
    const da = a.dueDate?.slice(0, 10) || '9999-12-31'
    const db = b.dueDate?.slice(0, 10) || '9999-12-31'
    return da.localeCompare(db)
  })
}

export const DASHBOARD_TASK_SORT_OPTIONS = [
  { value: 'due_asc', label: 'תאריך יעד (קרוב)' },
  { value: 'due_desc', label: 'תאריך יעד (רחוק)' },
  { value: 'priority', label: 'עדיפות' },
  { value: 'created_desc', label: 'חדשות קודם' },
  { value: 'status', label: 'סטטוס' },
] as const

export type DashboardTaskSort = (typeof DASHBOARD_TASK_SORT_OPTIONS)[number]['value']

export const DEFAULT_DASHBOARD_TASK_SORT: DashboardTaskSort = 'due_asc'

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

function tieBreak(
  a: { dueDate?: string | null; id?: string },
  b: { dueDate?: string | null; id?: string },
): number {
  const byDue = dueKey(a.dueDate).localeCompare(dueKey(b.dueDate))
  if (byDue !== 0) return byDue
  return (a.id ?? '').localeCompare(b.id ?? '')
}

export function isDashboardTaskSort(value: unknown): value is DashboardTaskSort {
  return (
    typeof value === 'string' &&
    (DASHBOARD_TASK_SORT_OPTIONS as readonly { value: string }[]).some((o) => o.value === value)
  )
}

/** Sort open dashboard tasks by the selected mode. */
export function sortDashboardTasks<
  T extends {
    id?: string
    dueDate?: string | null
    priority?: string | null
    status?: string | null
    createdAt?: string | null
  },
>(tasks: T[], mode: DashboardTaskSort): T[] {
  return [...tasks].sort((a, b) => {
    switch (mode) {
      case 'due_asc': {
        const cmp = dueKey(a.dueDate).localeCompare(dueKey(b.dueDate))
        return cmp !== 0 ? cmp : (a.id ?? '').localeCompare(b.id ?? '')
      }
      case 'due_desc': {
        // Missing due dates still last: compare reverse only among dated tasks.
        const aMissing = !a.dueDate?.slice(0, 10)
        const bMissing = !b.dueDate?.slice(0, 10)
        if (aMissing !== bMissing) return aMissing ? 1 : -1
        const cmp = dueKey(b.dueDate, false).localeCompare(dueKey(a.dueDate, false))
        return cmp !== 0 ? cmp : (a.id ?? '').localeCompare(b.id ?? '')
      }
      case 'priority': {
        const pa = PRIORITY_RANK[a.priority ?? 'medium'] ?? 1
        const pb = PRIORITY_RANK[b.priority ?? 'medium'] ?? 1
        if (pa !== pb) return pa - pb
        return tieBreak(a, b)
      }
      case 'created_desc': {
        const ca = a.createdAt ?? ''
        const cb = b.createdAt ?? ''
        const cmp = cb.localeCompare(ca)
        return cmp !== 0 ? cmp : (a.id ?? '').localeCompare(b.id ?? '')
      }
      case 'status': {
        const sa = STATUS_RANK.get((a.status ?? 'not_started') as (typeof TASK_STATUS_ORDER)[number]) ?? 99
        const sb = STATUS_RANK.get((b.status ?? 'not_started') as (typeof TASK_STATUS_ORDER)[number]) ?? 99
        if (sa !== sb) return sa - sb
        return tieBreak(a, b)
      }
      default:
        return tieBreak(a, b)
    }
  })
}

export type TaskDueGroup = 'overdue' | 'upcoming' | 'done' | 'cancelled'

export const TASK_DUE_GROUP_LABEL: Record<TaskDueGroup, string> = {
  overdue: 'באיחור',
  upcoming: 'לא באיחור',
  done: 'הושלמו',
  cancelled: 'בוטלו',
}

const GROUP_ORDER: TaskDueGroup[] = ['overdue', 'upcoming', 'done', 'cancelled']

function dueGroup(
  task: { done?: boolean | null; status?: string | null; dueDate?: string | null },
  today: string,
): TaskDueGroup {
  const status = task.status ?? (task.done ? 'done' : 'not_started')
  if (status === 'cancelled') return 'cancelled'
  if (task.done || status === 'done') return 'done'
  return isOverdueOpenTask(task, today) ? 'overdue' : 'upcoming'
}

type PriorityDueTask = { priority?: string | null; dueDate?: string | null; id?: string }

/** High priority first, then nearest due date. Missing due dates stay last inside their priority. */
export function sortTasksByPriorityThenDue<T extends readonly any[]>(tasks: T): T[number][] {
  const list = [...tasks] as PriorityDueTask[]
  list.sort((a, b) => {
    const pa = PRIORITY_RANK[a.priority ?? 'medium'] ?? 1
    const pb = PRIORITY_RANK[b.priority ?? 'medium'] ?? 1
    if (pa !== pb) return pa - pb
    return tieBreak(a, b)
  })
  return list as T[number][]
}

/** Nearest due date first (missing due date last). Priority only breaks ties. */
export function sortTasksByDueThenPriority<T extends readonly any[]>(tasks: T): T[number][] {
  const list = [...tasks] as PriorityDueTask[]
  list.sort((a, b) => {
    const byDue = dueKey(a.dueDate).localeCompare(dueKey(b.dueDate))
    if (byDue !== 0) return byDue
    const pa = PRIORITY_RANK[a.priority ?? 'medium'] ?? 1
    const pb = PRIORITY_RANK[b.priority ?? 'medium'] ?? 1
    if (pa !== pb) return pa - pb
    return (a.id ?? '').localeCompare(b.id ?? '')
  })
  return list as T[number][]
}

/**
 * Split a list into באיחור, לא באיחור, הושלמו, בוטלו.
 * Relative order inside each group is the order of `tasks`, so the caller sorts first.
 * Empty groups are omitted.
 */
type DueStateTask = { done?: boolean | null; status?: string | null; dueDate?: string | null }

export function groupTasksByDueState<T extends readonly any[]>(
  tasks: T,
  today = todayKey(),
): { key: TaskDueGroup; label: string; tasks: T[number][] }[] {
  const buckets = new Map<TaskDueGroup, T[number][]>(GROUP_ORDER.map((key) => [key, []]))
  for (const task of tasks) buckets.get(dueGroup(task as DueStateTask, today))!.push(task)
  return GROUP_ORDER.flatMap((key) => {
    const items = buckets.get(key) ?? []
    return items.length ? [{ key, label: TASK_DUE_GROUP_LABEL[key], tasks: items }] : []
  })
}

/** Keep group order, but stop after `limit` tasks. */
export function limitTaskGroups<T>(
  groups: { key: TaskDueGroup; label: string; tasks: T[] }[],
  limit: number,
): { key: TaskDueGroup; label: string; tasks: T[] }[] {
  let left = limit
  const out: { key: TaskDueGroup; label: string; tasks: T[] }[] = []
  for (const group of groups) {
    if (left <= 0) break
    const tasks = group.tasks.slice(0, left)
    left -= tasks.length
    if (tasks.length) out.push({ ...group, tasks })
  }
  return out
}

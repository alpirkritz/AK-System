import { isOverdueOpenTask, todayKey } from './task-due'

const PRIORITY_RANK: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
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

/** Calendar day, or a sentinel that sorts after every real due day. */
function dueKey(dueDate?: string | null): string {
  const day = dueDate?.slice(0, 10)
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : '9999-12-31'
}

/**
 * Web tasks-page default: high priority first, then nearest due date.
 * Missing due dates stay last inside their priority.
 */
type PriorityDueTask = { priority?: string | null; dueDate?: string | null }

export function sortTasksByPriorityThenDue<T>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    const left = a as PriorityDueTask
    const right = b as PriorityDueTask
    const pa = PRIORITY_RANK[left.priority ?? 'medium'] ?? 1
    const pb = PRIORITY_RANK[right.priority ?? 'medium'] ?? 1
    if (pa !== pb) return pa - pb
    return dueKey(left.dueDate).localeCompare(dueKey(right.dueDate))
  })
}

/**
 * Split a list into באיחור, לא באיחור, הושלמו, בוטלו.
 * Relative order inside each group is the order of `tasks`, so the caller sorts first.
 * Empty groups are omitted.
 */
type DueStateTask = { done?: boolean | null; status?: string | null; dueDate?: string | null }

export function groupTasksByDueState<T>(
  tasks: T[],
  today = todayKey(),
): { key: TaskDueGroup; label: string; tasks: T[] }[] {
  const buckets = new Map<TaskDueGroup, T[]>(GROUP_ORDER.map((key) => [key, []]))
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

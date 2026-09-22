/** Local calendar day as YYYY-MM-DD. Shared by the dashboard count and the tasks filter. */
export function todayKey(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** First 10 chars when they are a calendar day; otherwise null. */
export function dueDay(dueDate?: string | null): string | null {
  const day = dueDate?.slice(0, 10)
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

/**
 * Open task whose due day is strictly before today.
 * Cancelled rows are excluded even if `done` was not stamped.
 */
export function isOverdueOpenTask(
  task: { done?: boolean | null; status?: string | null; dueDate?: string | null },
  today = todayKey(),
): boolean {
  const status = task.status ?? (task.done ? 'done' : 'not_started')
  if (task.done || status === 'done' || status === 'cancelled') return false
  const due = dueDay(task.dueDate)
  return !!due && due < today
}

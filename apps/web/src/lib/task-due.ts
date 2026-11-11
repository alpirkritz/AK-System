/** Local calendar day as YYYY-MM-DD. Mirrors apps/mobile/lib/task-due.ts. */
export function todayKey(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** Moves a YYYY-MM-DD day by `delta` calendar days (local time, DST-safe). */
export function shiftDayKey(day: string, delta: number): string {
  const [y, m, d] = day.slice(0, 10).split('-').map(Number)
  return todayKey(new Date(y, m - 1, d + delta, 12))
}

export function dueDay(dueDate?: string | null): string | null {
  const day = dueDate?.slice(0, 10)
  return day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null
}

export function isOverdueOpenTask(
  task: { done?: boolean | null; status?: string | null; dueDate?: string | null },
  today = todayKey(),
): boolean {
  const status = task.status ?? (task.done ? 'done' : 'not_started')
  if (task.done || status === 'done' || status === 'cancelled') return false
  const due = dueDay(task.dueDate)
  return !!due && due < today
}

export function formatDueLabel(
  task: { done?: boolean | null; status?: string | null; dueDate?: string | null },
  today = todayKey(),
): string | null {
  const day = dueDay(task.dueDate)
  if (!day) return null
  const text = new Date(`${day}T00:00:00`).toLocaleDateString('he-IL')
  return isOverdueOpenTask(task, today) ? `באיחור · ${text}` : text
}

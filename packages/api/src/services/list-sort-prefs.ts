import { eq } from 'drizzle-orm'
import { getDb, queryRows, userSettings } from '@ak-system/database'

const SETTINGS_ID = 'default'

export type TaskSortKey =
  | 'priority_high'
  | 'priority_low'
  | 'due_asc'
  | 'due_desc'
  | 'status_workflow'
  | 'status_reverse'
  | 'created_desc'
  | 'created_asc'
  | 'none'

export type MeetingSortKey =
  | 'date_desc'
  | 'date_asc'
  | 'title_asc'
  | 'title_desc'
  | 'project'
  | 'none'

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

function parsePrefs(raw: string | null | undefined): ListSortPrefs {
  if (!raw) return { ...DEFAULT_LIST_SORT_PREFS }
  try {
    const parsed = JSON.parse(raw) as Partial<ListSortPrefs>
    return {
      dashboardTasks: parsed.dashboardTasks ?? DEFAULT_LIST_SORT_PREFS.dashboardTasks,
      tasksPage: parsed.tasksPage ?? DEFAULT_LIST_SORT_PREFS.tasksPage,
      meetingsPast: parsed.meetingsPast ?? DEFAULT_LIST_SORT_PREFS.meetingsPast,
    }
  } catch {
    return { ...DEFAULT_LIST_SORT_PREFS }
  }
}

export async function getListSortPrefs(): Promise<ListSortPrefs> {
  try {
    const db = getDb()
    const rows = await queryRows<{ listSortPrefs: string | null }>(
      db
        .select({ listSortPrefs: userSettings.listSortPrefs })
        .from(userSettings)
        .where(eq(userSettings.id, SETTINGS_ID))
        .limit(1),
    )
    return parsePrefs(rows[0]?.listSortPrefs)
  } catch (err) {
    console.warn('[list-sort-prefs] get failed:', err)
    return { ...DEFAULT_LIST_SORT_PREFS }
  }
}

export async function setListSortPrefs(
  patch: Partial<ListSortPrefs>,
): Promise<ListSortPrefs> {
  const db = getDb()
  const current = await getListSortPrefs()
  const next: ListSortPrefs = {
    dashboardTasks: patch.dashboardTasks ?? current.dashboardTasks,
    tasksPage: patch.tasksPage ?? current.tasksPage,
    meetingsPast: patch.meetingsPast ?? current.meetingsPast,
  }
  const now = new Date().toISOString()
  const stored = JSON.stringify(next)

  const rows = await queryRows<{ id: string }>(
    db
      .select({ id: userSettings.id })
      .from(userSettings)
      .where(eq(userSettings.id, SETTINGS_ID))
      .limit(1),
  )

  if (rows[0]) {
    await db
      .update(userSettings)
      .set({ listSortPrefs: stored, updatedAt: now })
      .where(eq(userSettings.id, SETTINGS_ID))
  } else {
    await db.insert(userSettings).values({
      id: SETTINGS_ID,
      listSortPrefs: stored,
      updatedAt: now,
    })
  }

  return next
}

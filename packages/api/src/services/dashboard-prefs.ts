import { eq } from 'drizzle-orm'
import { getDb, queryRows, userSettings } from '@ak-system/database'

const SETTINGS_ID = 'default'

export type MeetingWindow = 'today' | '3days' | 'week'
export type TaskWindow = 'today' | 'all'

export type DashboardPrefs = {
  meetingWindow: MeetingWindow
  taskWindow: TaskWindow
}

export const DEFAULT_DASHBOARD_PREFS: DashboardPrefs = {
  meetingWindow: 'today',
  taskWindow: 'today',
}

function parsePrefs(raw: string | null | undefined): DashboardPrefs {
  if (!raw) return { ...DEFAULT_DASHBOARD_PREFS }
  try {
    const parsed = JSON.parse(raw) as Partial<DashboardPrefs>
    const meetingWindow: MeetingWindow =
      parsed.meetingWindow === '3days' || parsed.meetingWindow === 'week'
        ? parsed.meetingWindow
        : 'today'
    const taskWindow: TaskWindow = parsed.taskWindow === 'all' ? 'all' : 'today'
    return { meetingWindow, taskWindow }
  } catch {
    return { ...DEFAULT_DASHBOARD_PREFS }
  }
}

export async function getDashboardPrefs(): Promise<DashboardPrefs> {
  try {
    const db = getDb()
    const rows = await queryRows<{ dashboardPrefs: string | null }>(
      db
        .select({ dashboardPrefs: userSettings.dashboardPrefs })
        .from(userSettings)
        .where(eq(userSettings.id, SETTINGS_ID))
        .limit(1),
    )
    return parsePrefs(rows[0]?.dashboardPrefs)
  } catch (err) {
    console.warn('[dashboard-prefs] get failed:', err)
    return { ...DEFAULT_DASHBOARD_PREFS }
  }
}

export async function setDashboardPrefs(
  patch: Partial<DashboardPrefs>,
): Promise<DashboardPrefs> {
  const db = getDb()
  const current = await getDashboardPrefs()
  const next: DashboardPrefs = {
    meetingWindow: patch.meetingWindow ?? current.meetingWindow,
    taskWindow: patch.taskWindow ?? current.taskWindow,
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
      .set({ dashboardPrefs: stored, updatedAt: now })
      .where(eq(userSettings.id, SETTINGS_ID))
  } else {
    await db.insert(userSettings).values({
      id: SETTINGS_ID,
      dashboardPrefs: stored,
      updatedAt: now,
    })
  }

  return next
}

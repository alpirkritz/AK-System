import { eq } from 'drizzle-orm'
import { getDb, queryRows, userSettings } from '@ak-system/database'
import { listAllGoogleCalendars } from './google-calendar'

const SETTINGS_ID = 'default'

export type CalendarCatalogEntry = {
  id: string
  name: string
  color: string
  source: 'google' | 'apple'
  accountEmail?: string
}

export type ScopedCalendarEvent = {
  calendarId?: string | null
}

/** Read agent calendar scope from DB. null = all calendars. */
export async function getAgentCalendarIds(): Promise<string[] | null> {
  try {
    const db = getDb()
    const rows = await queryRows<{ agentCalendarIds: string | null }>(
      db.select({ agentCalendarIds: userSettings.agentCalendarIds })
        .from(userSettings)
        .where(eq(userSettings.id, SETTINGS_ID))
        .limit(1),
    )
    const raw = rows[0]?.agentCalendarIds
    if (raw == null || raw === '') return null
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    const ids = parsed.filter((id): id is string => typeof id === 'string' && id.length > 0)
    return ids.length > 0 ? ids : null
  } catch (err) {
    console.warn('[agent-calendar-scope] get failed:', err)
    return null
  }
}

/** Persist agent calendar scope. null = all calendars. */
export async function setAgentCalendarIds(calendarIds: string[] | null): Promise<string[] | null> {
  const db = getDb()
  const now = new Date().toISOString()
  const stored =
    calendarIds && calendarIds.length > 0 ? JSON.stringify(calendarIds) : null

  const rows = await queryRows<{ id: string }>(
    db.select({ id: userSettings.id })
      .from(userSettings)
      .where(eq(userSettings.id, SETTINGS_ID))
      .limit(1),
  )

  if (rows[0]) {
    await db.update(userSettings)
      .set({ agentCalendarIds: stored, updatedAt: now })
      .where(eq(userSettings.id, SETTINGS_ID))
  } else {
    await db.insert(userSettings).values({
      id: SETTINGS_ID,
      agentCalendarIds: stored,
      updatedAt: now,
    })
  }

  return calendarIds && calendarIds.length > 0 ? calendarIds : null
}

/** Filter events to agent scope. No scope = return all. */
export function filterEventsByCalendarScope<T extends ScopedCalendarEvent>(
  events: T[],
  calendarIds: string[] | null | undefined,
): T[] {
  if (!calendarIds || calendarIds.length === 0) return events
  const allowed = new Set(calendarIds)
  return events.filter((e) => e.calendarId && allowed.has(e.calendarId))
}

/** Build a short Hebrew prompt block listing active calendars. */
export async function getAgentCalendarScopePromptBlock(
  catalog?: CalendarCatalogEntry[],
): Promise<string> {
  const ids = await getAgentCalendarIds()
  if (!ids) return ''

  let entries = catalog
  if (!entries) {
    try {
      entries = await listAllGoogleCalendars()
    } catch {
      entries = []
    }
  }
  const nameById = new Map(entries.map((c) => [c.id, c.name]))
  const labels = ids.map((id) => nameById.get(id) ?? id)

  return [
    '## יומנים פעילים לניתוח (Agent calendar scope)',
    'המשתמש הגדיר שאתה מתייחס **רק** לאירועים מהיומנים הבאים:',
    ...labels.map((l) => `- ${l}`),
    'אל תכלול, אל תנתח ואל תזכיר אירועים מיומנים שלא ברשימה — גם אם הם מחוברים למערכת.',
  ].join('\n')
}

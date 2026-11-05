import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eq } from 'drizzle-orm'
import { meetings, meetingSeries, people } from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'

const events: Record<string, unknown>[] = []

vi.mock('../services/google-calendar', async (orig) => ({
  ...(await orig<typeof import('../services/google-calendar')>()),
  isGoogleCalendarConfigured: () => true,
  invalidateGoogleCalendarCache: () => {},
  fetchGoogleCalendarEvents: async () => ({ events, errors: [] }),
}))
vi.mock('../services/apple-calendar', () => ({
  fetchAppleCalendarEvents: async () => [],
  invalidateAppleCalendarCache: () => {},
}))

function dtEvent(id: string, date: string, extraAttendees: { email: string; displayName: string }[] = []) {
  return {
    id,
    title: 'Algo 4.0',
    start: `${date}T10:00:00`,
    end: `${date}T11:00:00`,
    isAllDay: false,
    location: null,
    description: 'משתתפים: Dana Levi <dana@dt.com>, Ron Cohen <ron@dt.com>',
    status: 'confirmed',
    calendarId: 'dragontail',
    attendees: extraAttendees,
    transparency: 'opaque',
    accountEmail: 'owner@gmail.com',
    recurringEventId: null,
  }
}

describe('meetings.syncFromCalendar circles', () => {
  beforeEach(async () => {
    await resetDb()
    events.length = 0
  })

  it('groups bridge events by title into one series with a participant snapshot', async () => {
    events.push(dtEvent('e1', '2026-03-02'), dtEvent('e2', '2026-03-04'))
    const caller = await createTestCaller()
    await caller.meetings.syncFromCalendar({ startDate: '2026-03-01', endDate: '2026-03-07' })

    const db = getTestDb()
    const series = await db.select().from(meetingSeries)
    expect(series).toHaveLength(1)
    expect(series[0].titleKey).toBe('dragontail|algo 4 0')
    const rows = await db.select().from(meetings).where(eq(meetings.seriesId, series[0].id))
    expect(rows).toHaveLength(2)
    expect(JSON.parse(rows[0].calendarParticipants!)).toEqual([
      { name: 'Dana Levi', email: 'dana@dt.com', source: 'description' },
      { name: 'Ron Cohen', email: 'ron@dt.com', source: 'description' },
    ])
  })

  it('does not create review-queue people from sync for a series with a saved roster', async () => {
    events.push(dtEvent('e1', '2026-03-02'), dtEvent('e2', '2026-03-04'))
    const caller = await createTestCaller()
    await caller.meetings.syncFromCalendar({ startDate: '2026-03-01', endDate: '2026-03-07' })
    const [series] = await getTestDb().select().from(meetingSeries)
    await caller.circles.saveFromCalendar({ seriesId: series.id })
    // Saving the circle links its members to People (unknown ones as unconfirmed); the sync adds nobody.
    const afterSave = (await getTestDb().select().from(people)).map((p) => p.name).sort()
    expect(afterSave).toEqual(['Dana Levi', 'Ron Cohen'])

    events.push(dtEvent('e3', '2026-03-06', [{ email: 'stranger@dt.com', displayName: 'Stranger' }]))
    await caller.meetings.syncFromCalendar({ startDate: '2026-03-01', endDate: '2026-03-07' })

    expect((await getTestDb().select().from(people)).map((p) => p.name).sort()).toEqual(afterSave)
  })
})

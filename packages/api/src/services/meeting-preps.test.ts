import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { meetingPreps, meetings } from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { getMeetingPrep, saveMeetingPrep } from './meeting-preps'

const NOW = new Date().toISOString()

beforeEach(async () => {
  await resetDb()
  await getTestDb().insert(meetings).values({
    id: 'm1',
    title: 'סנכרון שבועי',
    date: '2026-03-01',
    time: '10:00',
    source: 'calendar',
    createdAt: NOW,
    updatedAt: NOW,
  })
})

describe('saveMeetingPrep', () => {
  it('stores the agent brief with its agent id and source', async () => {
    const db = getTestDb()
    expect(await saveMeetingPrep(db, { meetingId: 'm1', bodyText: 'שלוש נקודות', source: 'agent', agentId: '04_meeting_prep_herald' })).toBe(true)
    expect(await getMeetingPrep(db, 'm1')).toMatchObject({
      bodyText: 'שלוש נקודות',
      source: 'agent',
      agentId: '04_meeting_prep_herald',
    })
  })

  it('stores a template brief without an agent id', async () => {
    const db = getTestDb()
    await saveMeetingPrep(db, { meetingId: 'm1', bodyText: 'תבנית', source: 'template' })
    expect(await getMeetingPrep(db, 'm1')).toMatchObject({ source: 'template', agentId: null })
  })

  it('a second run on the same meeting updates the row instead of duplicating it', async () => {
    const db = getTestDb()
    await saveMeetingPrep(db, { meetingId: 'm1', bodyText: 'ראשון', source: 'template', now: Date.parse('2026-03-01T09:40:00.000Z') })
    await saveMeetingPrep(db, { meetingId: 'm1', bodyText: 'שני', source: 'agent', agentId: 'a1', now: Date.parse('2026-03-01T09:45:00.000Z') })

    const rows = await db.select().from(meetingPreps).where(eq(meetingPreps.meetingId, 'm1'))
    expect(rows).toHaveLength(1)
    const prep = await getMeetingPrep(db, 'm1')
    expect(prep).toMatchObject({ bodyText: 'שני', source: 'agent', agentId: 'a1' })
    expect(prep!.createdAt).toBe('2026-03-01T09:40:00.000Z')
    expect(prep!.updatedAt).toBe('2026-03-01T09:45:00.000Z')
  })

  it('writes nothing for an unknown meeting or an empty brief', async () => {
    const db = getTestDb()
    expect(await saveMeetingPrep(db, { meetingId: 'ghost', bodyText: 'משהו', source: 'agent' })).toBe(false)
    expect(await saveMeetingPrep(db, { meetingId: 'm1', bodyText: '   ', source: 'agent' })).toBe(false)
    expect(await db.select().from(meetingPreps)).toHaveLength(0)
  })
})

describe('meetings.getPrep', () => {
  it('returns null until a prep exists, then returns it', async () => {
    const caller = await createTestCaller()
    expect(await caller.meetings.getPrep({ meetingId: 'm1' })).toBeNull()

    await saveMeetingPrep(getTestDb(), { meetingId: 'm1', bodyText: 'מה חשוב לדעת', source: 'agent', agentId: 'herald' })
    expect(await caller.meetings.getPrep({ meetingId: 'm1' })).toMatchObject({
      bodyText: 'מה חשוב לדעת',
      source: 'agent',
      agentId: 'herald',
    })
  })
})

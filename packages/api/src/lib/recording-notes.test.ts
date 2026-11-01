import { beforeEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { meetings } from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { mergeRecordingNotes } from './recording-notes'

describe('mergeRecordingNotes', () => {
  it('appends a recording block without dropping notes already on the meeting', () => {
    const merged = mergeRecordingNotes('סיכום קודם', 'לשלוח את המצגת')
    expect(merged).toContain('סיכום קודם')
    expect(merged).toContain('לשלוח את המצגת')
    expect(merged).toContain('--- הערות מההקלטה ---')
  })

  it('replaces the recording block instead of duplicating it', () => {
    const first = mergeRecordingNotes('סיכום קודם', 'לשלוח את המצגת')
    const second = mergeRecordingNotes(first, 'להתקשר לדנה')
    expect(second?.match(/--- הערות מההקלטה ---/g)).toHaveLength(1)
    expect(second).toContain('להתקשר לדנה')
    expect(second).not.toContain('לשלוח את המצגת')
    expect(second).toContain('סיכום קודם')
  })

  it('removes the block when the capture is cleared', () => {
    const first = mergeRecordingNotes('סיכום קודם', 'לשלוח')
    expect(mergeRecordingNotes(first, '   ')).toBe('סיכום קודם')
    expect(mergeRecordingNotes(null, '  ')).toBeNull()
  })
})

describe('meetings.saveRecordingNotes', () => {
  const now = new Date().toISOString()

  beforeEach(async () => {
    await resetDb()
  })

  it('writes the recording block onto the meeting and replaces it on the next save', async () => {
    const db = getTestDb()
    await db.insert(meetings).values({
      id: 'm_notes', title: 'Sync', date: '2026-10-28', time: '10:00', notes: 'סיכום קודם', createdAt: now, updatedAt: now,
    })
    const caller = await createTestCaller()
    await caller.meetings.saveRecordingNotes({ meetingId: 'm_notes', notes: 'לשלוח את המצגת' })
    await caller.meetings.saveRecordingNotes({ meetingId: 'm_notes', notes: 'להתקשר לדנה' })
    const [row] = await db.select().from(meetings).where(eq(meetings.id, 'm_notes'))
    expect(row.notes).toContain('סיכום קודם')
    expect(row.notes).toContain('להתקשר לדנה')
    expect(row.notes).not.toContain('לשלוח את המצגת')
    expect(row.title).toBe('Sync')
  })
})

describe('meetings.createManual / deleteIfEmpty', () => {
  const now = new Date().toISOString()

  beforeEach(async () => {
    await resetDb()
  })

  it('creates a manual meeting that can hold recording notes', async () => {
    const db = getTestDb()
    const caller = await createTestCaller()
    const { id } = await caller.meetings.createManual({ title: 'שיחה 2026-10-29 14:00', date: '2026-10-29', time: '14:00' })
    await caller.meetings.saveRecordingNotes({ meetingId: id, notes: 'הערה' })
    const [row] = await db.select().from(meetings).where(eq(meetings.id, id))
    expect(row.source).toBe('manual')
    expect(row.notes).toContain('הערה')
  })

  it('deletes an untouched manual meeting, including one holding only recording notes', async () => {
    const db = getTestDb()
    const caller = await createTestCaller()
    const { id } = await caller.meetings.createManual({ title: 'שיחה', date: '2026-10-29', time: '14:00' })
    await caller.meetings.saveRecordingNotes({ meetingId: id, notes: 'הערה' })
    expect(await caller.meetings.deleteIfEmpty({ meetingId: id })).toEqual({ deleted: true })
    expect(await db.select().from(meetings).where(eq(meetings.id, id))).toHaveLength(0)
  })

  it('keeps manual meetings with their own notes and never deletes calendar meetings', async () => {
    const db = getTestDb()
    const caller = await createTestCaller()
    await db.insert(meetings).values({ id: 'm_own', title: 'x', date: '2026-10-29', time: '10:00', source: 'manual', notes: 'כתבתי', createdAt: now, updatedAt: now })
    await db.insert(meetings).values({ id: 'm_cal', title: 'y', date: '2026-10-29', time: '11:00', source: 'calendar', createdAt: now, updatedAt: now })
    expect(await caller.meetings.deleteIfEmpty({ meetingId: 'm_own' })).toEqual({ deleted: false })
    expect(await caller.meetings.deleteIfEmpty({ meetingId: 'm_cal' })).toEqual({ deleted: false })
  })
})

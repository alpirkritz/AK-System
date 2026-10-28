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

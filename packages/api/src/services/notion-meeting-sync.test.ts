import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createTestCaller, resetDb } from '../test-utils'

describe('notion-meeting-sync service', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('creates a new meeting for an orphaned note', async () => {
    const { getDb, meetingNotes } = await import('@ak-system/database')
    const { ensureMeetingForNote } = await import('./notion-meeting-sync')
    const db = getDb()
    const now = new Date().toISOString()

    // Create an orphaned note
    const noteId = 'mn_test_orphan'
    await db.insert(meetingNotes).values({
      id: noteId,
      title: 'Test Corridor Discussion',
      date: '2026-09-03',
      snippet: 'Quick chat in the hallway',
      meetingId: null,
      source: 'notion',
      createdAt: now,
      updatedAt: now,
    })

    // Ensure meeting
    const result = await ensureMeetingForNote(noteId, 'Test Corridor Discussion', '2026-09-03')

    expect(result.created).toBe(true)
    expect(result.meetingId).toMatch(/^m_note_/)

    // Verify meeting was created
    const caller = await createTestCaller()
    const meetings = await caller.meetings.list()
    const meeting = meetings.find((m) => m.id === result.meetingId)

    expect(meeting).toBeDefined()
    expect(meeting?.title).toBe('Test Corridor Discussion')
    expect(meeting?.date).toBe('2026-09-03')
    expect(meeting?.source).toBe('notion_note')
    expect(meeting?.sourceNoteId).toBe(noteId)

    // Verify note was linked
    const [note] = await db.select().from(meetingNotes).where((t) => t.id === noteId)
    expect(note?.meetingId).toBe(result.meetingId)
  })

  it('reuses existing meeting with same title and date', async () => {
    const { getDb, meetingNotes, meetings } = await import('@ak-system/database')
    const { ensureMeetingForNote } = await import('./notion-meeting-sync')
    const db = getDb()
    const now = new Date().toISOString()

    // Create existing meeting
    const existingMeetingId = 'm_existing'
    await db.insert(meetings).values({
      id: existingMeetingId,
      title: 'Weekly Sync',
      date: '2026-09-03',
      time: '10:00',
      source: 'calendar',
      createdAt: now,
      updatedAt: now,
    })

    // Create orphaned note with same title/date
    const noteId = 'mn_test_reuse'
    await db.insert(meetingNotes).values({
      id: noteId,
      title: 'Weekly Sync',
      date: '2026-09-03',
      snippet: 'Notes from sync',
      meetingId: null,
      source: 'notion',
      createdAt: now,
      updatedAt: now,
    })

    // Ensure meeting
    const result = await ensureMeetingForNote(noteId, 'Weekly Sync', '2026-09-03')

    expect(result.created).toBe(false)
    expect(result.meetingId).toBe(existingMeetingId)

    // Verify note was linked to existing meeting
    const [note] = await db.select().from(meetingNotes).where((t) => t.id === noteId)
    expect(note?.meetingId).toBe(existingMeetingId)
  })

  it('returns existing meetingId if note already linked', async () => {
    const { getDb, meetingNotes, meetings } = await import('@ak-system/database')
    const { ensureMeetingForNote } = await import('./notion-meeting-sync')
    const db = getDb()
    const now = new Date().toISOString()

    // Create meeting
    const meetingId = 'm_already_linked'
    await db.insert(meetings).values({
      id: meetingId,
      title: 'Project Review',
      date: '2026-09-03',
      time: '14:00',
      source: 'notion_note',
      createdAt: now,
      updatedAt: now,
    })

    // Create note already linked
    const noteId = 'mn_test_linked'
    await db.insert(meetingNotes).values({
      id: noteId,
      title: 'Project Review',
      date: '2026-09-03',
      snippet: 'Review notes',
      meetingId,
      source: 'notion',
      createdAt: now,
      updatedAt: now,
    })

    // Ensure meeting (should return existing)
    const result = await ensureMeetingForNote(noteId, 'Project Review', '2026-09-03')

    expect(result.created).toBe(false)
    expect(result.meetingId).toBe(meetingId)
  })

  it('handles notes without date', async () => {
    const { getDb, meetingNotes } = await import('@ak-system/database')
    const { ensureMeetingForNote } = await import('./notion-meeting-sync')
    const db = getDb()
    const now = new Date().toISOString()

    // Create orphaned note without date
    const noteId = 'mn_test_no_date'
    await db.insert(meetingNotes).values({
      id: noteId,
      title: 'Ad Hoc Discussion',
      date: null,
      snippet: 'Quick chat',
      meetingId: null,
      source: 'notion',
      createdAt: now,
      updatedAt: now,
    })

    // Ensure meeting (should use current date)
    const result = await ensureMeetingForNote(noteId, 'Ad Hoc Discussion', null)

    expect(result.created).toBe(true)
    expect(result.meetingId).toMatch(/^m_note_/)

    // Verify meeting uses current date
    const caller = await createTestCaller()
    const meetings = await caller.meetings.list()
    const meeting = meetings.find((m) => m.id === result.meetingId)

    expect(meeting).toBeDefined()
    expect(meeting?.date).toBe(now.slice(0, 10)) // Current date in YYYY-MM-DD
  })
})

describe('linkOrphanedNotes', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('links multiple orphaned notes', async () => {
    const { getDb, meetingNotes } = await import('@ak-system/database')
    const { linkOrphanedNotes } = await import('./notion-meeting-sync')
    const db = getDb()
    const now = new Date().toISOString()

    // Create multiple orphaned notes
    await db.insert(meetingNotes).values([
      {
        id: 'mn_orphan_1',
        title: 'Meeting 1',
        date: '2026-09-01',
        snippet: 'First meeting',
        meetingId: null,
        source: 'notion',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'mn_orphan_2',
        title: 'Meeting 2',
        date: '2026-09-02',
        snippet: 'Second meeting',
        meetingId: null,
        source: 'notion',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'mn_orphan_3',
        title: 'Meeting 3',
        date: '2026-09-03',
        snippet: 'Third meeting',
        meetingId: null,
        source: 'notion',
        createdAt: now,
        updatedAt: now,
      },
    ])

    // Link all orphaned notes
    const result = await linkOrphanedNotes()

    expect(result.linked).toBe(3)
    expect(result.created).toBe(3)

    // Verify all notes now have meetingId
    const notes = await db.select().from(meetingNotes)
    for (const note of notes) {
      expect(note.meetingId).toBeTruthy()
    }

    // Verify meetings were created
    const caller = await createTestCaller()
    const meetings = await caller.meetings.list()
    expect(meetings.length).toBe(3)
    expect(meetings.every((m) => m.source === 'notion_note')).toBe(true)
  })

  it('returns zero counts when no orphaned notes exist', async () => {
    const { linkOrphanedNotes } = await import('./notion-meeting-sync')

    const result = await linkOrphanedNotes()

    expect(result.linked).toBe(0)
    expect(result.created).toBe(0)
  })
})

describe('meetings router - linkOrphanedNotes mutation', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('exposes linkOrphanedNotes via tRPC', async () => {
    const { getDb, meetingNotes } = await import('@ak-system/database')
    const db = getDb()
    const now = new Date().toISOString()

    // Create an orphaned note
    await db.insert(meetingNotes).values({
      id: 'mn_trpc_test',
      title: 'Test Meeting',
      date: '2026-09-03',
      snippet: 'Test',
      meetingId: null,
      source: 'notion',
      createdAt: now,
      updatedAt: now,
    })

    const caller = await createTestCaller()
    const result = await caller.meetings.linkOrphanedNotes()

    expect(result.linked).toBe(1)
    expect(result.created).toBe(1)
  })
})

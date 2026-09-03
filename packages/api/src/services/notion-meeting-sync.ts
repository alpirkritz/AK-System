/**
 * Auto-create meeting records for orphaned Notion AI meeting notes.
 * Ensures every note has a meeting to enable conversation analysis and full meeting features.
 */

import { getDb, meetings, meetingNotes, eq, and } from '@ak-system/database'

export interface EnsureMeetingResult {
  meetingId: string
  created: boolean
}

/**
 * Ensure a meeting record exists for a Notion AI meeting note.
 * 
 * If the note already has a meetingId, returns that.
 * Otherwise, searches for an existing meeting with the same title and date,
 * or creates a new meeting with source='notion_note'.
 * 
 * @param noteId - The meeting note ID
 * @param noteTitle - Title from the Notion note
 * @param noteDate - Date from the Notion note (ISO string YYYY-MM-DD) or null
 * @returns { meetingId, created } - The meeting ID and whether it was newly created
 */
export async function ensureMeetingForNote(
  noteId: string,
  noteTitle: string,
  noteDate: string | null,
): Promise<EnsureMeetingResult> {
  const db = getDb()
  const now = new Date().toISOString()

  // 1. Check if note already has a meetingId
  const [note] = await db
    .select({ meetingId: meetingNotes.meetingId })
    .from(meetingNotes)
    .where(eq(meetingNotes.id, noteId))
    .limit(1)

  if (note?.meetingId) {
    return { meetingId: note.meetingId, created: false }
  }

  // 2. Search for existing meeting with same title and date
  const effectiveDate = noteDate || now.slice(0, 10)
  
  const [existingMeeting] = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(
      and(
        eq(meetings.title, noteTitle),
        eq(meetings.date, effectiveDate)
      )
    )
    .limit(1)

  if (existingMeeting) {
    // Link the note to the existing meeting
    await db
      .update(meetingNotes)
      .set({ meetingId: existingMeeting.id, updatedAt: now })
      .where(eq(meetingNotes.id, noteId))

    return { meetingId: existingMeeting.id, created: false }
  }

  // 3. Create new meeting
  const meetingId = `m_note_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`

  await db.insert(meetings).values({
    id: meetingId,
    title: noteTitle,
    date: effectiveDate,
    time: '00:00', // Default time for note-sourced meetings
    category: 'general',
    source: 'notion_note',
    sourceNoteId: noteId,
    createdAt: now,
    updatedAt: now,
  })

  // 4. Link the note to the new meeting
  await db
    .update(meetingNotes)
    .set({ meetingId, updatedAt: now })
    .where(eq(meetingNotes.id, noteId))

  return { meetingId, created: true }
}

/**
 * One-time utility to link all orphaned notes to meetings.
 * Call this after deployment to handle historical data.
 * 
 * @returns { linked: number, created: number } - Count of notes linked and meetings created
 */
export async function linkOrphanedNotes(): Promise<{ linked: number; created: number }> {
  const db = getDb()

  // Find all orphaned notes (no meetingId)
  const orphanedNotes = await db
    .select({
      id: meetingNotes.id,
      title: meetingNotes.title,
      date: meetingNotes.date,
    })
    .from(meetingNotes)
    .where(eq(meetingNotes.meetingId, null))

  let linked = 0
  let created = 0

  for (const note of orphanedNotes) {
    const result = await ensureMeetingForNote(note.id, note.title, note.date)
    linked++
    if (result.created) {
      created++
    }
  }

  return { linked, created }
}

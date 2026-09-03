/**
 * Auto-create meeting records for orphaned Notion AI meeting notes.
 * Ensures every note has a meeting to enable conversation analysis and full meeting features.
 */

import { getDb, meetings, meetingNotes, eq, and, isNull } from '@ak-system/database'

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
    .where(isNull(meetingNotes.meetingId))

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

/**
 * Trigger conversation analysis immediately after Notion sync detects a new transcript.
 * Runs async (fire-and-forget) to not block Notion sync.
 *
 * @param meetingId - The meeting ID to analyze
 * @param noteId - The note ID containing the transcript
 * @param transcriptText - The transcript text to analyze
 */
export async function triggerAnalysisIfNeeded(
  meetingId: string,
  noteId: string,
  transcriptText: string,
): Promise<void> {
  // Dynamic imports to avoid circular dependencies
  const { getDb, meetingAnalyses, meetings, eq, desc } = await import('@ak-system/database')
  const { analyzeTranscript } = await import('./meeting-analysis')

  const db = getDb()
  const now = new Date()

  // Check existing analysis
  const [existing] = await db
    .select({ id: meetingAnalyses.id, status: meetingAnalyses.status, createdAt: meetingAnalyses.createdAt })
    .from(meetingAnalyses)
    .where(eq(meetingAnalyses.meetingId, meetingId))
    .orderBy(desc(meetingAnalyses.createdAt))
    .limit(1)

  // Skip if completed or pending
  if (existing && (existing.status === 'completed' || existing.status === 'pending')) return

  // Skip if failed but recent (< 1 hour)
  if (existing?.status === 'failed' && existing.createdAt) {
    const failedAt = new Date(existing.createdAt).getTime()
    if (now.getTime() - failedAt < 60 * 60 * 1000) return
  }

  // Trigger analysis (async, don't block sync)
  void (async () => {
    try {
      const analysisId = 'ma_' + Date.now()
      await db.insert(meetingAnalyses).values({
        id: analysisId,
        meetingId,
        meetingNoteId: noteId,
        source: 'notion_sync',
        transcriptText,
        status: 'pending',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      })

      const [meeting] = await db.select({ title: meetings.title, date: meetings.date })
        .from(meetings)
        .where(eq(meetings.id, meetingId))
        .limit(1)

      const result = await analyzeTranscript({
        transcriptText,
        meetingTitle: meeting?.title ?? 'פגישה',
        meetingDate: meeting?.date ?? now.toISOString().split('T')[0],
      })

      await db.update(meetingAnalyses)
        .set({
          ...result,
          participantsJson: JSON.stringify(result.participants),
          actionItemsJson: JSON.stringify(result.actionItems),
          model: 'gemini-2.5-flash',
          status: 'completed',
          updatedAt: now.toISOString(),
        })
        .where(eq(meetingAnalyses.id, analysisId))

      // Note: WhatsApp notification is sent by the cron job that polls for new analyses
      // (apps/web/src/app/api/cron/transcript-analysis/route.ts)
    } catch (err) {
      console.error('[notion-sync] Auto-analysis failed:', err)
      // Try to mark as failed in DB
      try {
        const failedAnalysisId = 'ma_' + Date.now() + '_err'
        await db.insert(meetingAnalyses).values({
          id: failedAnalysisId,
          meetingId,
          meetingNoteId: noteId,
          source: 'notion_sync',
          transcriptText,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
        })
      } catch (dbErr) {
        console.error('[notion-sync] Failed to save error state:', dbErr)
      }
    }
  })()
}


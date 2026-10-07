/**
 * Storage for the pre-meeting brief the herald agent (or the template fallback) generates ~15 min
 * before a meeting. One row per meeting — a re-run overwrites it, so the meeting page always shows
 * the newest brief. See docs/specs/meeting-prep-on-meeting-page.md.
 */
import { eq } from 'drizzle-orm'
import { meetingPreps, meetings, type MeetingPrepSource, type getDb } from '@ak-system/database'

type Db = ReturnType<typeof getDb>

export interface MeetingPrepRecord {
  bodyText: string
  agentId: string | null
  source: MeetingPrepSource
  createdAt: string
  updatedAt: string
}

export interface SaveMeetingPrepInput {
  meetingId: string
  bodyText: string
  source: MeetingPrepSource
  agentId?: string | null
  now?: number
}

export async function getMeetingPrep(db: Db, meetingId: string): Promise<MeetingPrepRecord | null> {
  const [row] = await db.select().from(meetingPreps).where(eq(meetingPreps.meetingId, meetingId))
  if (!row) return null
  return {
    bodyText: row.bodyText,
    agentId: row.agentId,
    source: row.source as MeetingPrepSource,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }
}

/** Upserts the brief for a meeting. Returns false when the meeting does not exist. */
export async function saveMeetingPrep(db: Db, input: SaveMeetingPrepInput): Promise<boolean> {
  const bodyText = input.bodyText.trim()
  if (!bodyText) return false
  const [meeting] = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.id, input.meetingId))
  if (!meeting) return false

  const at = new Date(input.now ?? Date.now()).toISOString()
  const [existing] = await db.select({ id: meetingPreps.id }).from(meetingPreps).where(eq(meetingPreps.meetingId, input.meetingId))
  if (existing) {
    await db
      .update(meetingPreps)
      .set({ bodyText, source: input.source, agentId: input.agentId ?? null, updatedAt: at })
      .where(eq(meetingPreps.id, existing.id))
    return true
  }
  await db.insert(meetingPreps).values({
    id: `mprep_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    meetingId: input.meetingId,
    agentId: input.agentId ?? null,
    source: input.source,
    bodyText,
    createdAt: at,
    updatedAt: at,
  })
  return true
}

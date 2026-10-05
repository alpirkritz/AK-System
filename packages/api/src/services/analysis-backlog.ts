/**
 * Meetings with a note body but no analysis. The relationships board reads
 * `meeting_analyses.score`, so an unanalysed meeting is invisible there.
 * The recent-meeting cron never reaches old notes; this drains them quietly:
 * no WhatsApp, no push, no proposed commitments.
 */
import { and, desc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm'
import { meetingAnalyses, meetingNotes, meetingPeople, meetings, type getDb } from '@ak-system/database'
import { analyzeTranscript, type AnalysisResult, type AnalyzeTranscriptOptions } from './meeting-analysis'

type Db = ReturnType<typeof getDb>

export const BACKLOG_WINDOW_DAYS = 180
export const MIN_BODY_LENGTH = 100
const FAILED_RETRY_MS = 60 * 60 * 1000

export interface BacklogMeeting {
  meetingId: string
  noteId: string
  title: string
  date: string
  bodyText: string
  hasPeople: boolean
}

function isoDaysAgo(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}

/** Eligible meetings, people-linked first, then newest first. `limit` omitted returns all. */
export async function listAnalysisBacklog(db: Db, opts: { now?: Date; limit?: number } = {}): Promise<BacklogMeeting[]> {
  const now = opts.now ?? new Date()
  const since = isoDaysAgo(BACKLOG_WINDOW_DAYS, now)
  const today = now.toISOString().slice(0, 10)
  const rows = await db
    .select({
      meetingId: meetings.id,
      title: meetings.title,
      date: meetings.date,
      noteId: meetingNotes.id,
      bodyText: meetingNotes.bodyText,
    })
    .from(meetings)
    .innerJoin(meetingNotes, eq(meetingNotes.meetingId, meetings.id))
    .where(and(isNotNull(meetingNotes.bodyText), gte(meetings.date, since), lte(meetings.date, today)))
    .orderBy(desc(meetings.date))

  const byMeeting = new Map<string, { title: string; date: string; noteId: string; bodyText: string }>()
  for (const r of rows) {
    const body = r.bodyText ?? ''
    if (body.trim().length < MIN_BODY_LENGTH) continue
    const current = byMeeting.get(r.meetingId)
    if (!current || body.length > current.bodyText.length) {
      byMeeting.set(r.meetingId, { title: r.title, date: r.date, noteId: r.noteId, bodyText: body })
    }
  }
  const ids = [...byMeeting.keys()]
  if (ids.length === 0) return []

  const analyses = await db
    .select({ meetingId: meetingAnalyses.meetingId, status: meetingAnalyses.status, createdAt: meetingAnalyses.createdAt })
    .from(meetingAnalyses)
    .where(inArray(meetingAnalyses.meetingId, ids))
  const blocked = new Set<string>()
  for (const a of analyses) {
    if (a.status === 'completed' || a.status === 'pending') blocked.add(a.meetingId)
    else if (a.status === 'failed' && now.getTime() - new Date(a.createdAt).getTime() < FAILED_RETRY_MS) blocked.add(a.meetingId)
  }

  const linked = await db
    .select({ meetingId: meetingPeople.meetingId })
    .from(meetingPeople)
    .where(inArray(meetingPeople.meetingId, ids))
  const withPeople = new Set(linked.map((l) => l.meetingId))

  const out: BacklogMeeting[] = []
  for (const [meetingId, m] of byMeeting) {
    if (blocked.has(meetingId)) continue
    out.push({ meetingId, noteId: m.noteId, title: m.title, date: m.date, bodyText: m.bodyText, hasPeople: withPeople.has(meetingId) })
  }
  out.sort((a, b) => Number(b.hasPeople) - Number(a.hasPeople) || b.date.localeCompare(a.date))
  return opts.limit != null ? out.slice(0, opts.limit) : out
}

export type Analyzer = (opts: AnalyzeTranscriptOptions) => Promise<AnalysisResult>

export interface BacklogRunResult {
  analysed: number
  failed: number
  remaining: number
  analysedMeetings: string[]
  failedMeetings: Array<{ meetingId: string; error: string }>
}

/** Analyse up to `limit` backlog meetings, sequentially and silently. */
export async function runAnalysisBacklog(
  db: Db,
  opts: { limit: number; now?: Date; analyze?: Analyzer },
): Promise<BacklogRunResult> {
  const now = opts.now ?? new Date()
  const analyze = opts.analyze ?? analyzeTranscript
  const all = await listAnalysisBacklog(db, { now })
  const batch = all.slice(0, Math.max(0, opts.limit))
  const result: BacklogRunResult = { analysed: 0, failed: 0, remaining: 0, analysedMeetings: [], failedMeetings: [] }

  for (const m of batch) {
    const stamp = new Date().toISOString()
    const analysisId = `ma_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    try {
      await db.insert(meetingAnalyses).values({
        id: analysisId,
        meetingId: m.meetingId,
        meetingNoteId: m.noteId,
        source: 'backfill',
        transcriptText: m.bodyText,
        status: 'pending',
        createdAt: stamp,
        updatedAt: stamp,
      })
      const r = await analyze({ transcriptText: m.bodyText, meetingTitle: m.title, meetingDate: m.date })
      await db
        .update(meetingAnalyses)
        .set({
          hatName: r.hatName,
          topic: r.topic,
          mood: r.mood,
          subtext: r.subtext,
          keyInsight: r.keyInsight,
          score: r.score,
          scoreRationale: r.scoreRationale,
          kaizenKeep: r.kaizenKeep,
          kaizenImprove: r.kaizenImprove,
          openQuestion: r.openQuestion,
          participantsJson: JSON.stringify(r.participants),
          actionItemsJson: JSON.stringify(r.actionItems),
          model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
          status: 'completed',
          updatedAt: new Date().toISOString(),
        })
        .where(eq(meetingAnalyses.id, analysisId))
      result.analysed++
      result.analysedMeetings.push(m.meetingId)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      try {
        await db
          .update(meetingAnalyses)
          .set({ status: 'failed', error: message, updatedAt: new Date().toISOString() })
          .where(eq(meetingAnalyses.id, analysisId))
      } catch {
        // the pending row may not exist if the insert itself failed
      }
      result.failed++
      result.failedMeetings.push({ meetingId: m.meetingId, error: message })
    }
  }

  result.remaining = Math.max(0, all.length - batch.length) + result.failed
  return result
}

/** Counts for the board strip: analysed meetings in the window, and how many still wait. */
export async function analysisBacklogSummary(db: Db, now = new Date()): Promise<{ pending: number; analysed: number; sampleTitles: string[] }> {
  const since = isoDaysAgo(BACKLOG_WINDOW_DAYS, now)
  const today = now.toISOString().slice(0, 10)
  const backlog = await listAnalysisBacklog(db, { now })
  const analysedRows = await db
    .select({ meetingId: meetingAnalyses.meetingId })
    .from(meetingAnalyses)
    .innerJoin(meetings, eq(meetings.id, meetingAnalyses.meetingId))
    .where(and(isNotNull(meetingAnalyses.score), gte(meetings.date, since), lte(meetings.date, today)))
  return {
    pending: backlog.length,
    analysed: new Set(analysedRows.map((r) => r.meetingId)).size,
    sampleTitles: backlog.slice(0, 3).map((m) => m.title),
  }
}

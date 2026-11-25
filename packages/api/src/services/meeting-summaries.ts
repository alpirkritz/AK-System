/**
 * Meeting summaries the system produced itself: the completed analysis of each recorded or
 * transcribed meeting. This is the primary record of what happened in a meeting. Notion AI
 * notes are a fallback for meetings that were never analysed here.
 */
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { meetingAnalyses, meetings, type getDb } from '@ak-system/database'
import { titlesShareTopic } from '../lib/topic-match'
import { omitSelfParticipants } from '../lib/self-identity'

type Db = ReturnType<typeof getDb>

export interface SystemMeetingSummary {
  meetingId: string
  title: string
  date: string
  time: string | null
  /** Where the analysed text came from: a recording, a transcript, a Notion note… */
  analysisSource: string
  topic: string | null
  keyInsight: string | null
  mood: string | null
  subtext: string | null
  score: number | null
  scoreRationale: string | null
  keep: string | null
  improve: string | null
  openQuestion: string | null
  participants: string[]
  actionItems: { content: string; owner: string | null }[]
  analysedAt: string
}

export interface SystemMeetingSummaryFilter {
  /** Exact meeting day, YYYY-MM-DD. */
  date?: string
  sinceDate?: string
  untilDate?: string
  meetingId?: string
  /** Free text matched against the title, topic, key insight and participants. */
  query?: string
  /** Keep only meetings on the same topic as this title (version-aware). */
  focusTitle?: string
  limit?: number
}

function parseList<T>(json: string | null): T[] {
  if (!json) return []
  try {
    const value = JSON.parse(json) as unknown
    return Array.isArray(value) ? (value as T[]) : []
  } catch {
    return []
  }
}

/** Completed analyses, newest meeting first, one per meeting (the latest analysis wins). */
export async function systemMeetingSummaries(db: Db, filter: SystemMeetingSummaryFilter = {}): Promise<SystemMeetingSummary[]> {
  const conditions = [eq(meetingAnalyses.status, 'completed')]
  if (filter.meetingId) conditions.push(eq(meetingAnalyses.meetingId, filter.meetingId))
  if (filter.date) conditions.push(eq(meetings.date, filter.date))
  if (filter.sinceDate) conditions.push(gte(meetings.date, filter.sinceDate))
  if (filter.untilDate) conditions.push(lte(meetings.date, filter.untilDate))

  const rows = await db
    .select({
      meetingId: meetings.id,
      title: meetings.title,
      date: meetings.date,
      time: meetings.time,
      analysisSource: meetingAnalyses.source,
      topic: meetingAnalyses.topic,
      keyInsight: meetingAnalyses.keyInsight,
      mood: meetingAnalyses.mood,
      subtext: meetingAnalyses.subtext,
      score: meetingAnalyses.score,
      scoreRationale: meetingAnalyses.scoreRationale,
      keep: meetingAnalyses.kaizenKeep,
      improve: meetingAnalyses.kaizenImprove,
      openQuestion: meetingAnalyses.openQuestion,
      participantsJson: meetingAnalyses.participantsJson,
      actionItemsJson: meetingAnalyses.actionItemsJson,
      analysedAt: meetingAnalyses.updatedAt,
    })
    .from(meetingAnalyses)
    .innerJoin(meetings, eq(meetings.id, meetingAnalyses.meetingId))
    .where(and(...conditions))
    .orderBy(desc(meetings.date), desc(meetings.time), desc(meetingAnalyses.updatedAt))
    .limit(400)

  const query = filter.query?.trim().toLowerCase()
  const seen = new Set<string>()
  const out: SystemMeetingSummary[] = []
  for (const row of rows) {
    if (seen.has(row.meetingId)) continue
    seen.add(row.meetingId)

    const participants = omitSelfParticipants(
      parseList<{ name?: string }>(row.participantsJson).filter((p): p is { name: string } => typeof p?.name === 'string' && !!p.name.trim()),
    ).map((p) => p.name.trim())
    const actionItems = parseList<{ content?: string; owner?: string | null; dismissed?: boolean }>(row.actionItemsJson)
      .filter((item) => typeof item?.content === 'string' && item.content.trim() && !item.dismissed)
      .map((item) => ({ content: (item.content as string).trim(), owner: item.owner?.trim() || null }))

    if (filter.focusTitle && !titlesShareTopic(row.title, filter.focusTitle)) continue
    if (query) {
      const haystack = [row.title, row.topic, row.keyInsight, ...participants].filter(Boolean).join(' ').toLowerCase()
      if (!haystack.includes(query)) continue
    }

    const { participantsJson: _p, actionItemsJson: _a, ...rest } = row
    out.push({ ...rest, participants, actionItems })
    if (out.length >= (filter.limit ?? 30)) break
  }
  return out
}

/** Compact text block for a prompt: one meeting per section. */
export function formatSystemMeetingSummary(summary: SystemMeetingSummary): string {
  const lines = [`### ${summary.title} (${summary.date}${summary.time ? ` ${summary.time}` : ''})`]
  if (summary.topic) lines.push(`נושא: ${summary.topic}`)
  if (summary.keyInsight) lines.push(`תובנה מרכזית: ${summary.keyInsight}`)
  if (summary.mood) lines.push(`אווירה: ${summary.mood}`)
  if (summary.subtext) lines.push(`תת-טקסט: ${summary.subtext}`)
  if (summary.score != null) lines.push(`ציון: ${summary.score}/10${summary.scoreRationale ? ` — ${summary.scoreRationale}` : ''}`)
  if (summary.participants.length > 0) lines.push(`משתתפים: ${summary.participants.join(', ')}`)
  if (summary.actionItems.length > 0) {
    lines.push('משימות שעלו:')
    for (const item of summary.actionItems) lines.push(`- ${item.content}${item.owner ? ` (${item.owner})` : ''}`)
  }
  if (summary.openQuestion) lines.push(`שאלה פתוחה: ${summary.openQuestion}`)
  return lines.join('\n')
}

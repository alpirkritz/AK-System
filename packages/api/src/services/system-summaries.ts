/**
 * System summaries first (docs/specs/hugo-system-summaries-first.md): per meeting, the summary the app
 * produced itself (`meeting_analyses`, completed) outranks the Notion AI note, which only fills gaps.
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import { meetingAnalyses, type getDb } from '@ak-system/database'

type Db = ReturnType<typeof getDb>

export interface SystemSummary {
  analysisId: string
  meetingId: string
  topic: string | null
  keyInsight: string | null
  text: string
}

export interface SummaryNote {
  id: string
  title: string
  date: string | null
  snippet: string | null
  bodyText: string | null
  notionUrl: string | null
  meetingId: string | null
  meetingTitle: string | null
  sourceKind: string | null
}

export interface MeetingStub {
  id: string
  title: string
  date: string
}

function parseJson<T>(raw: string | null): T[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as T[]) : []
  } catch {
    return []
  }
}

export function systemSummaryText(a: {
  topic: string | null
  keyInsight: string | null
  openQuestion: string | null
  actionItemsJson: string | null
}): string {
  const lines: string[] = []
  if (a.topic?.trim()) lines.push(`נושא: ${a.topic.trim()}`)
  if (a.keyInsight?.trim()) lines.push(`תובנה מרכזית: ${a.keyInsight.trim()}`)
  const items = parseJson<{ content?: string; owner?: string }>(a.actionItemsJson).filter((i) => i.content?.trim())
  if (items.length > 0) {
    lines.push('משימות:')
    for (const i of items) lines.push(`- ${i.content!.trim()}${i.owner ? ` (${i.owner})` : ''}`)
  }
  if (a.openQuestion?.trim()) lines.push(`שאלה פתוחה: ${a.openQuestion.trim()}`)
  return lines.join('\n')
}

/** Newest completed analysis with some content, per meeting. */
export async function loadSystemSummaries(db: Db, meetingIds: string[]): Promise<Map<string, SystemSummary>> {
  const out = new Map<string, SystemSummary>()
  if (meetingIds.length === 0) return out
  const rows = await db
    .select()
    .from(meetingAnalyses)
    .where(and(inArray(meetingAnalyses.meetingId, meetingIds), eq(meetingAnalyses.status, 'completed')))
    .orderBy(desc(meetingAnalyses.createdAt))
  for (const a of rows) {
    if (out.has(a.meetingId)) continue
    const text = systemSummaryText(a)
    if (!text) continue
    out.set(a.meetingId, { analysisId: a.id, meetingId: a.meetingId, topic: a.topic, keyInsight: a.keyInsight, text })
  }
  return out
}

/**
 * Pure merge. Notes whose meeting has a system summary get that summary instead of the Notion body;
 * meetings in `syntheticFor` that have a summary but no note are added as new entries.
 */
export function mergeSystemFirst<T extends SummaryNote>(
  notes: T[],
  summaries: Map<string, SystemSummary>,
  syntheticFor: MeetingStub[],
): SummaryNote[] {
  const covered = new Set<string>()
  const merged: SummaryNote[] = notes.map((n) => {
    const s = n.meetingId ? summaries.get(n.meetingId) : undefined
    if (!s) return n
    covered.add(s.meetingId)
    return { ...n, bodyText: s.text, snippet: s.keyInsight ?? s.topic ?? n.snippet, sourceKind: 'system' }
  })
  for (const m of syntheticFor) {
    const s = summaries.get(m.id)
    if (!s || covered.has(m.id)) continue
    covered.add(m.id)
    merged.push({
      id: `sys_${s.analysisId}`,
      title: m.title,
      date: m.date,
      snippet: s.keyInsight ?? s.topic,
      bodyText: s.text,
      notionUrl: null,
      meetingId: m.id,
      meetingTitle: m.title,
      sourceKind: 'system',
    })
  }
  return merged
}

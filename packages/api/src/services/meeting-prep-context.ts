/**
 * Everything the system itself knows that is relevant to preparing one meeting:
 * its people, open tasks tied to it, what was said in the previous meetings on the
 * same series / project / topic, open commitments, and the harness insights about
 * the attendees. Meeting prep reads this, not Notion.
 */
import { and, asc, desc, eq, gte, inArray } from 'drizzle-orm'
import { meetingPeople, meetings, people, projects, tasks, type getDb } from '@ak-system/database'
import { titlesShareTopic } from '../lib/topic-match'
import { isSelfPersonName } from '../lib/self-identity'
import { localTodayIso } from '../lib/calendar-dates'
import { systemMeetingSummaries, type SystemMeetingSummary } from './meeting-summaries'
import { meetingPrepRelationship } from './person-context'
import { listOpenInsights } from './harness-reasoner'

type Db = ReturnType<typeof getDb>

const MAX_TASKS = 8
const MAX_PREVIOUS = 3
const MAX_LINKED = 6
const PRIORITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 }

export interface MeetingPrepBundle {
  found: boolean
  meeting: {
    id: string | null
    title: string
    date: string | null
    time: string | null
    project: string | null
    recurring: boolean
    notes: string | null
  }
  people: { id: string; name: string; role: string | null }[]
  /** Open tasks tied to this meeting, its project or its topic. Never the whole backlog. */
  relatedOpenTasks: { title: string; priority: string; dueDate: string | null; overdue: boolean; why: 'meeting' | 'project' | 'topic' }[]
  /** System summaries of earlier meetings in the same series, project or topic, newest first. */
  previousMeetings: (SystemMeetingSummary & { why: 'series' | 'project' | 'topic' })[]
  /** Other meetings in the same series or project, around this one. */
  linkedMeetings: { id: string; title: string; date: string; hasSummary: boolean }[]
  /** Open commitments and relationship lines for the attendees. */
  relationshipLines: string[]
  /** Harness insights about the attendees (cross-domain, derived). */
  harnessInsights: { severity: string; title: string; body: string; person: string | null; basedOn: string[] }[]
}

export interface MeetingPrepLookup {
  meetingId?: string
  /** Calendar title; used when there is no id, and as the topic for matching. */
  title?: string
  /** YYYY-MM-DD of the meeting being prepared. Defaults to today. */
  date?: string
}

async function findMeeting(db: Db, lookup: MeetingPrepLookup, day: string) {
  if (lookup.meetingId) {
    const [row] = await db.select().from(meetings).where(eq(meetings.id, lookup.meetingId)).limit(1)
    if (row) return row
  }
  const title = lookup.title?.trim()
  if (!title) return null
  const sameTitle = await db
    .select()
    .from(meetings)
    .where(and(eq(meetings.title, title), gte(meetings.date, day)))
    .orderBy(asc(meetings.date))
    .limit(1)
  return sameTitle[0] ?? null
}

export async function meetingPrepBundle(db: Db, lookup: MeetingPrepLookup): Promise<MeetingPrepBundle> {
  const today = localTodayIso()
  const day = lookup.date ?? today
  const meeting = await findMeeting(db, lookup, day)
  const title = meeting?.title ?? lookup.title?.trim() ?? ''
  const meetingDate = meeting?.date || day

  const [projectRow, attendeeRows, openTasks, allMeetings] = await Promise.all([
    meeting?.projectId
      ? db.select({ name: projects.name }).from(projects).where(eq(projects.id, meeting.projectId)).limit(1)
      : Promise.resolve([] as { name: string }[]),
    meeting
      ? db
          .select({ id: people.id, name: people.name, role: people.role })
          .from(meetingPeople)
          .innerJoin(people, eq(people.id, meetingPeople.personId))
          .where(eq(meetingPeople.meetingId, meeting.id))
      : Promise.resolve([] as { id: string; name: string; role: string | null }[]),
    db
      .select({ title: tasks.title, priority: tasks.priority, dueDate: tasks.dueDate, meetingId: tasks.meetingId, projectId: tasks.projectId })
      .from(tasks)
      .where(eq(tasks.done, false)),
    db
      .select({ id: meetings.id, title: meetings.title, date: meetings.date, seriesId: meetings.seriesId, projectId: meetings.projectId })
      .from(meetings)
      .orderBy(desc(meetings.date)),
  ])
  const attendees = attendeeRows.filter((p) => !isSelfPersonName(p.name))

  // Tasks: an explicit link first, then the project, then a shared topic (version-aware).
  const relatedOpenTasks: MeetingPrepBundle['relatedOpenTasks'] = []
  for (const task of openTasks) {
    const why =
      meeting && task.meetingId === meeting.id ? 'meeting'
      : meeting?.projectId && task.projectId === meeting.projectId ? 'project'
      : title && titlesShareTopic(task.title, title) ? 'topic'
      : null
    if (!why) continue
    relatedOpenTasks.push({
      title: task.title,
      priority: task.priority,
      dueDate: task.dueDate,
      overdue: !!task.dueDate && task.dueDate < today,
      why,
    })
  }
  relatedOpenTasks.sort(
    (a, b) => Number(b.overdue) - Number(a.overdue) || (PRIORITY_ORDER[a.priority] ?? 1) - (PRIORITY_ORDER[b.priority] ?? 1),
  )

  // Meetings that belong with this one: same series, same project, or same topic.
  const relation = (m: { id: string; title: string; seriesId: string | null; projectId: string | null }): 'series' | 'project' | 'topic' | null => {
    if (meeting && m.id === meeting.id) return null
    if (meeting?.seriesId && m.seriesId === meeting.seriesId) return 'series'
    if (meeting?.projectId && m.projectId === meeting.projectId) return 'project'
    if (title && titlesShareTopic(m.title, title)) return 'topic'
    return null
  }
  const relationById = new Map<string, 'series' | 'project' | 'topic'>()
  for (const m of allMeetings) {
    const why = relation(m)
    if (why) relationById.set(m.id, why)
  }

  const earlierSummaries = relationById.size > 0 ? await systemMeetingSummaries(db, { untilDate: meetingDate, limit: 400 }) : []
  const summarised = new Set(earlierSummaries.map((s) => s.meetingId))
  const previousMeetings = earlierSummaries
    .filter((s) => relationById.has(s.meetingId))
    .slice(0, MAX_PREVIOUS)
    .map((s) => ({ ...s, why: relationById.get(s.meetingId)! }))

  const linkedMeetings = allMeetings
    .filter((m) => relationById.get(m.id) === 'series' || relationById.get(m.id) === 'project')
    .filter((m) => m.date && m.date <= meetingDate)
    .slice(0, MAX_LINKED)
    .map((m) => ({ id: m.id, title: m.title, date: m.date, hasSummary: summarised.has(m.id) }))

  const [relationship, openInsights] = await Promise.all([
    meeting ? meetingPrepRelationship(db, meeting.id).catch(() => null) : Promise.resolve(null),
    attendees.length > 0 ? listOpenInsights(db, { limit: 50 }).catch(() => []) : Promise.resolve([]),
  ])
  const nameById = new Map(attendees.map((p) => [p.id, p.name]))
  const harnessInsights = openInsights
    .filter((i) => i.personId && nameById.has(i.personId))
    .slice(0, 6)
    .map((i) => ({
      severity: i.severity,
      title: i.title,
      body: i.body,
      person: nameById.get(i.personId as string) ?? null,
      basedOn: i.sources.map((s) => `${s.kind}: ${s.label}`),
    }))

  return {
    found: !!meeting,
    meeting: {
      id: meeting?.id ?? null,
      title,
      date: meeting?.date ?? lookup.date ?? null,
      time: meeting?.time ?? null,
      project: projectRow[0]?.name ?? null,
      recurring: !!meeting?.seriesId,
      notes: meeting?.notes?.trim() || null,
    },
    people: attendees,
    relatedOpenTasks: relatedOpenTasks.slice(0, MAX_TASKS),
    previousMeetings,
    linkedMeetings,
    relationshipLines: relationship?.lines ?? [],
    harnessInsights,
  }
}

/** The bundle as a prompt block. Sections with nothing in them are left out. */
export function formatMeetingPrepBundle(bundle: MeetingPrepBundle): string {
  const lines: string[] = []
  if (bundle.relatedOpenTasks.length > 0) {
    lines.push('Open tasks in the system tied to this meeting:')
    for (const t of bundle.relatedOpenTasks) {
      lines.push(`- [${t.priority}${t.overdue ? ', overdue' : ''}] ${t.title}${t.dueDate ? ` (due ${t.dueDate})` : ''} — linked by ${t.why}`)
    }
  }
  if (bundle.previousMeetings.length > 0) {
    lines.push('', 'What was said in the previous meetings (system summaries, newest first):')
    for (const p of bundle.previousMeetings) {
      lines.push(`- ${p.date} · ${p.title} (same ${p.why})`)
      if (p.topic) lines.push(`  topic: ${p.topic}`)
      if (p.keyInsight) lines.push(`  key insight: ${p.keyInsight}`)
      if (p.openQuestion) lines.push(`  open question: ${p.openQuestion}`)
      for (const item of p.actionItems.slice(0, 5)) lines.push(`  action: ${item.content}${item.owner ? ` (${item.owner})` : ''}`)
    }
  }
  if (bundle.linkedMeetings.length > 0) {
    lines.push('', 'Linked meetings (same series or project):')
    for (const m of bundle.linkedMeetings) lines.push(`- ${m.date} · ${m.title}${m.hasSummary ? '' : ' (no summary)'}`)
  }
  if (bundle.harnessInsights.length > 0) {
    lines.push('', 'Harness insights about the attendees (derived, cite what they are based on):')
    for (const i of bundle.harnessInsights) {
      lines.push(`- [${i.severity}] ${i.person ? `${i.person}: ` : ''}${i.title} — ${i.body}${i.basedOn.length ? ` (based on ${i.basedOn.join('; ')})` : ''}`)
    }
  }
  return lines.join('\n').trim()
}

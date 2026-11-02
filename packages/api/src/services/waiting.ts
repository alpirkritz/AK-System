/**
 * "Who owes me what": open tasks assigned to someone other than the owner, plus accepted
 * `owner = them` commitments that never became a task. One query for the page, the dashboard
 * card, the person section and the morning briefing.
 */
import { and, eq, isNotNull, isNull, ne, notInArray } from 'drizzle-orm'
import { commitments, meetings, people, tasks, type getDb } from '@ak-system/database'
import { ensureSelfPerson } from './self-person'

type Db = ReturnType<typeof getDb>

export interface WaitingItem {
  kind: 'task' | 'commitment'
  id: string
  title: string
  personId: string
  personName: string
  personColor: string | null
  /** YYYY-MM-DD or null */
  dueDate: string | null
  /** meeting | whatsapp | email | voice | notion | manual … */
  source: string
  /** Meeting title, chat name, or null */
  sourceLabel: string | null
  meetingId: string | null
}

export interface WaitingBuckets {
  overdue: WaitingItem[]
  today: WaitingItem[]
  thisWeek: WaitingItem[]
  later: WaitingItem[]
  noDate: WaitingItem[]
}

/** Calendar date in the owner's timezone, so "today" flips at local midnight. */
export function localDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.TIMEZONE || 'Asia/Jerusalem' }).format(now)
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export function bucketWaiting(items: WaitingItem[], today: string): WaitingBuckets {
  const weekEnd = addDays(today, 7)
  const out: WaitingBuckets = { overdue: [], today: [], thisWeek: [], later: [], noDate: [] }
  for (const item of items) {
    const due = item.dueDate?.slice(0, 10) ?? null
    if (!due) out.noDate.push(item)
    else if (due < today) out.overdue.push(item)
    else if (due === today) out.today.push(item)
    else if (due <= weekEnd) out.thisWeek.push(item)
    else out.later.push(item)
  }
  const byDue = (a: WaitingItem, b: WaitingItem) => (a.dueDate ?? '').localeCompare(b.dueDate ?? '') || a.personName.localeCompare(b.personName, 'he')
  for (const key of ['overdue', 'today', 'thisWeek', 'later'] as const) out[key].sort(byDue)
  out.noDate.sort((a, b) => a.personName.localeCompare(b.personName, 'he'))
  return out
}

export async function listWaiting(db: Db, options: { personId?: string; now?: Date } = {}): Promise<WaitingBuckets> {
  const self = await ensureSelfPerson(db)

  const taskRows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      dueDate: tasks.dueDate,
      source: tasks.source,
      meetingId: tasks.meetingId,
      meetingTitle: meetings.title,
      personId: people.id,
      personName: people.name,
      personColor: people.color,
    })
    .from(tasks)
    .innerJoin(people, eq(people.id, tasks.assigneeId))
    .leftJoin(meetings, eq(meetings.id, tasks.meetingId))
    .where(
      and(
        isNotNull(tasks.assigneeId),
        ne(tasks.assigneeId, self.id),
        notInArray(tasks.status, ['done', 'cancelled']),
        options.personId ? eq(tasks.assigneeId, options.personId) : undefined,
      ),
    )

  const commitmentRows = await db
    .select({
      id: commitments.id,
      content: commitments.content,
      dueDate: commitments.dueInferred,
      source: commitments.source,
      chatName: commitments.sourceChatName,
      personId: people.id,
      personName: people.name,
      personColor: people.color,
    })
    .from(commitments)
    .innerJoin(people, eq(people.id, commitments.personId))
    .where(
      and(
        eq(commitments.owner, 'them'),
        eq(commitments.status, 'accepted'),
        isNull(commitments.taskId),
        ne(commitments.personId, self.id),
        options.personId ? eq(commitments.personId, options.personId) : undefined,
      ),
    )

  const items: WaitingItem[] = [
    ...taskRows.map((t) => ({
      kind: 'task' as const,
      id: t.id,
      title: t.title,
      personId: t.personId,
      personName: t.personName,
      personColor: t.personColor,
      dueDate: t.dueDate,
      source: t.meetingId ? 'meeting' : t.source,
      sourceLabel: t.meetingTitle ?? null,
      meetingId: t.meetingId,
    })),
    ...commitmentRows.map((c) => ({
      kind: 'commitment' as const,
      id: c.id,
      title: c.content,
      personId: c.personId!,
      personName: c.personName,
      personColor: c.personColor,
      dueDate: c.dueDate,
      source: c.source,
      sourceLabel: c.chatName,
      meetingId: null,
    })),
  ]
  return bucketWaiting(items, localDate(options.now))
}

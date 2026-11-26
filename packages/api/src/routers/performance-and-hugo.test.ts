/**
 * docs/specs/performance-and-hugo-hardening.md
 * The SQL rewrites must return what the JS versions returned, the owner must not appear
 * as one of "the people" in a meeting, and Hugo's Slack tool must filter and mark the owner.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  meetingAnalyses,
  meetingPeople,
  meetings,
  notifications,
  people,
  slackChannels,
  slackMessages,
  projects,
  tasks,
  harnessInsights,
  runMutation,
} from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { meetingInsight } from '../services/warmth'
import { meetingPrepRelationship } from '../services/person-context'

const NOW = new Date().toISOString()
const iso = (offsetDays: number) => new Date(Date.now() + offsetDays * 86400000).toISOString().split('T')[0]

describe('meetings.list time range in SQL', () => {
  beforeEach(resetDb)

  it('returns the same rows per range, with people and task ids attached', async () => {
    const caller = await createTestCaller()
    const person = await caller.people.create({ name: 'Dana Levi' })
    const past = await caller.meetings.create({ title: 'Past', date: iso(-3) })
    const today = await caller.meetings.create({ title: 'Today', date: iso(0), peopleIds: [person!.id] })
    const tomorrow = await caller.meetings.create({ title: 'Tomorrow', date: iso(1) })
    const inSix = await caller.meetings.create({ title: 'In six days', date: iso(6) })
    const far = await caller.meetings.create({ title: 'Far', date: iso(30) })
    const task = await caller.tasks.create({ title: 'Follow up', meetingId: today!.id })

    const ids = async (timeRange?: 'today' | 'tomorrow' | 'week' | 'all') =>
      (await caller.meetings.list(timeRange ? { timeRange } : undefined)).map((m) => m.id)

    expect(await ids('today')).toEqual([today!.id])
    expect(await ids('tomorrow')).toEqual([tomorrow!.id])
    expect(await ids('week')).toEqual([today!.id, tomorrow!.id, inSix!.id])
    expect(await ids('all')).toEqual([past!.id, today!.id, tomorrow!.id, inSix!.id, far!.id])
    expect(await ids()).toEqual([past!.id, today!.id, tomorrow!.id, inSix!.id, far!.id])

    const unfiltered = (await caller.meetings.list()).find((m) => m.id === today!.id)
    expect(unfiltered?.peopleIds).toEqual([person!.id])
    expect(unfiltered?.taskIds).toEqual([task!.id])
    const filtered = (await caller.meetings.list({ timeRange: 'today' }))[0]
    expect(filtered?.peopleIds).toEqual([person!.id])
    expect(filtered?.taskIds).toEqual([task!.id])
    expect((await caller.meetings.list({ withTasks: true })).map((m) => m.id)).toEqual([today!.id])
  })
})

describe('notifications counts and bulk updates', () => {
  beforeEach(async () => {
    await getTestDb().delete(notifications)
  })

  async function seed(extras: { readAt?: string | null; archivedAt?: string | null } = {}) {
    await runMutation(
      getTestDb().insert(notifications).values({
        id: crypto.randomUUID(),
        title: 't',
        body: 'b',
        url: '/chat',
        type: 'cron',
        readAt: extras.readAt ?? null,
        archivedAt: extras.archivedAt ?? null,
        createdAt: new Date().toISOString(),
      }),
    )
  }

  it('counts unread, marks all read and archives all in one statement each', async () => {
    const caller = await createTestCaller()
    expect(await caller.notifications.unreadCount()).toEqual({ count: 0 })

    await seed()
    await seed()
    await seed({ readAt: NOW })
    await seed({ archivedAt: '2026-01-01T00:00:00.000Z' })
    expect(await caller.notifications.unreadCount()).toEqual({ count: 2 })

    expect(await caller.notifications.markRead({ all: true })).toEqual({ updated: 2 })
    expect(await caller.notifications.unreadCount()).toEqual({ count: 0 })
    expect(await caller.notifications.markRead({ all: true })).toEqual({ updated: 0 })

    const archived = await caller.notifications.archiveAll({})
    expect(archived).toMatchObject({ archived: true, updated: 3 })
    expect(await caller.notifications.list({ limit: 10 })).toHaveLength(0)

    // Undo restores this batch only; the notification archived earlier stays archived.
    expect(await caller.notifications.archiveAll({ undo: true, batchAt: archived.batchAt })).toEqual({ archived: false, updated: 3 })
    expect(await caller.notifications.list({ limit: 10 })).toHaveLength(3)
  })
})

describe('owner is not one of the people in a meeting', () => {
  beforeEach(resetDb)

  it('leaves the owner out of the meeting insight and the prep relationship lines', async () => {
    const db = getTestDb()
    await db.insert(people).values([
      { id: 'me', name: 'Alpir Kritzler', status: 'confirmed', source: 'manual', createdAt: NOW },
      { id: 'dana', name: 'Dana Levi', status: 'confirmed', source: 'manual', createdAt: NOW },
    ])
    await db.insert(meetings).values({ id: 'm1', title: 'Algo 4.0 sync', date: iso(-1), time: '10:00', createdAt: NOW, updatedAt: NOW })
    await db.insert(meetingPeople).values([
      { meetingId: 'm1', personId: 'me' },
      { meetingId: 'm1', personId: 'dana' },
    ])
    await db.insert(meetingAnalyses).values({ id: 'a1', meetingId: 'm1', source: 'transcript', score: 6, status: 'completed', createdAt: NOW, updatedAt: NOW })

    const insight = await meetingInsight(db, 'm1')
    expect(insight?.people.map((p) => p.name)).toEqual(['Dana Levi'])

    const prep = await meetingPrepRelationship(db, 'm1')
    expect(prep.lines.join('\n')).not.toContain('Alpir')
  })
})

describe('slack.forTool', () => {
  beforeEach(resetDb)

  it('reports no data before anything was ingested', async () => {
    const result = await (await createTestCaller()).slack.forTool()
    expect(result).toMatchObject({ hasData: false, total: 0, messages: [] })
  })

  it('filters by channel, sender and text, and marks the owner', async () => {
    const db = getTestDb()
    const ts = Date.now() - 3600_000
    await db.insert(slackChannels).values([
      { id: 'c1', teamId: 'T', channelId: 'C1', name: 'algo-4', updatedAt: NOW },
      { id: 'c2', teamId: 'T', channelId: 'D1', name: 'design', updatedAt: NOW },
    ])
    const message = (id: string, channelId: string, userId: string, userName: string, text: string, at: number) => ({
      id, teamId: 'T', channelId, slackTs: String(at / 1000), userId, userName, text, ts: at, createdAt: NOW,
    })
    await db.insert(slackMessages).values([
      message('s1', 'C1', 'U1', 'Ron Katz', 'Algo 4.0 release slipped', ts),
      message('s2', 'C1', 'UME', 'Alpir Kritzler', 'I will check with QA', ts + 1000),
      message('s3', 'D1', 'U2', 'Dana Levi', 'Can we talk about Algo core?', ts + 2000),
      message('s4', 'C1', 'U1', 'Ron Katz', 'old news', Date.now() - 10 * 86400000),
    ])

    const caller = await createTestCaller()

    const all = await caller.slack.forTool()
    expect(all.hasData).toBe(true)
    expect(all.messages.map((m) => m.text)).toEqual(['Can we talk about Algo core?', 'I will check with QA', 'Algo 4.0 release slipped'])
    expect(all.messages[1]).toMatchObject({ channel: '#algo-4', fromOwner: true })
    expect(all.messages[0]).toMatchObject({ channel: '#design', fromOwner: false, from: 'Dana Levi' })
    expect(all.channels).toEqual([
      expect.objectContaining({ channel: '#algo-4', count: 2 }),
      expect.objectContaining({ channel: '#design', count: 1 }),
    ])

    expect((await caller.slack.forTool({ channel: '#algo-4' })).total).toBe(2)
    expect((await caller.slack.forTool({ person: 'dana' })).messages.map((m) => m.from)).toEqual(['Dana Levi'])
    expect((await caller.slack.forTool({ query: 'algo 4.0' })).messages.map((m) => m.text)).toEqual(['Algo 4.0 release slipped'])
    expect((await caller.slack.forTool({ hours: 24 * 14 })).total).toBe(4)
  })
})

describe('insights.meetingSummaries (system analyses are the primary record)', () => {
  beforeEach(resetDb)

  it('returns the latest completed analysis per meeting, without the owner or dismissed items', async () => {
    const db = getTestDb()
    await db.insert(meetings).values([
      { id: 's1', title: 'Algo 4.0 sync', date: iso(0), time: '10:00', createdAt: NOW, updatedAt: NOW },
      { id: 's2', title: 'Algo core review', date: iso(0), time: '14:00', createdAt: NOW, updatedAt: NOW },
      { id: 's3', title: 'Old meeting', date: iso(-5), time: '09:00', createdAt: NOW, updatedAt: NOW },
      { id: 's4', title: 'Pending one', date: iso(0), time: '16:00', createdAt: NOW, updatedAt: NOW },
    ])
    const analysis = (id: string, meetingId: string, extra: Record<string, unknown> = {}) => ({
      id, meetingId, source: 'voice', status: 'completed', createdAt: NOW, updatedAt: NOW, ...extra,
    })
    await db.insert(meetingAnalyses).values([
      analysis('x1', 's1', {
        topic: 'Release plan',
        keyInsight: 'QA is the bottleneck',
        participantsJson: JSON.stringify([{ name: 'Alpir Kritzler' }, { name: 'Dana Levi' }]),
        actionItemsJson: JSON.stringify([
          { content: 'Book QA slot', owner: 'Dana Levi' },
          { content: 'Dropped item', dismissed: true },
        ]),
      }),
      analysis('x2', 's2', { topic: 'Latency' }),
      analysis('x3', 's3', { topic: 'History' }),
      analysis('x4', 's4', { status: 'pending' }),
    ])

    const caller = await createTestCaller()

    const today = await caller.insights.meetingSummaries({ date: 'today' })
    expect(today.summaries.map((s) => s.meetingId)).toEqual(['s2', 's1'])
    const sync = today.summaries.find((s) => s.meetingId === 's1')
    expect(sync).toMatchObject({ topic: 'Release plan', keyInsight: 'QA is the bottleneck', participants: ['Dana Levi'] })
    expect(sync?.actionItems).toEqual([{ content: 'Book QA slot', owner: 'Dana Levi' }])

    expect((await caller.insights.meetingSummaries({ focusTitle: 'Algo 4 planning' })).summaries.map((s) => s.meetingId)).toEqual(['s1'])
    expect((await caller.insights.meetingSummaries({ query: 'dana' })).summaries.map((s) => s.meetingId)).toEqual(['s1'])
    expect((await caller.insights.meetingSummaries({ sinceDate: iso(-7), untilDate: iso(-1) })).summaries.map((s) => s.meetingId)).toEqual(['s3'])
    expect((await caller.insights.meetingSummaries()).count).toBe(3)
  })
})

describe('insights.meetingPrepBundle (prep from the system, not Notion)', () => {
  beforeEach(resetDb)

  it('collects related tasks, previous summaries, linked meetings and harness insights, and keeps Algo apart from Algo 4.0', async () => {
    const db = getTestDb()
    await db.insert(people).values([
      { id: 'me', name: 'Alpir Kritzler', status: 'confirmed', source: 'manual', createdAt: NOW },
      { id: 'dana', name: 'Dana Levi', status: 'confirmed', source: 'manual', createdAt: NOW },
    ])
    await db.insert(projects).values({ id: 'p4', name: 'Algo 4.0', createdAt: NOW, updatedAt: NOW })
    await db.insert(meetings).values([
      { id: 'next', title: 'Algo 4.0 sync', date: iso(0), time: '11:00', projectId: 'p4', createdAt: NOW, updatedAt: NOW },
      { id: 'prev', title: 'Algo 4.0 sync', date: iso(-7), time: '11:00', projectId: 'p4', createdAt: NOW, updatedAt: NOW },
      { id: 'core', title: 'Algo core review', date: iso(-3), time: '10:00', createdAt: NOW, updatedAt: NOW },
    ])
    await db.insert(meetingPeople).values([
      { meetingId: 'next', personId: 'me' },
      { meetingId: 'next', personId: 'dana' },
    ])
    await db.insert(meetingAnalyses).values([
      { id: 'ap', meetingId: 'prev', source: 'voice', status: 'completed', topic: 'Release plan', keyInsight: 'QA is the bottleneck',
        actionItemsJson: JSON.stringify([{ content: 'Book QA slot', owner: 'Dana Levi' }]), createdAt: NOW, updatedAt: NOW },
      { id: 'ac', meetingId: 'core', source: 'voice', status: 'completed', topic: 'Core latency', createdAt: NOW, updatedAt: NOW },
    ])
    const task = (id: string, title: string, extra: Record<string, unknown> = {}) => ({
      id, title, done: false, status: 'not_started', priority: 'medium', source: 'manual', createdAt: NOW, updatedAt: NOW, ...extra,
    })
    await db.insert(tasks).values([
      task('t1', 'Send agenda', { meetingId: 'next' }),
      task('t2', 'Freeze scope', { projectId: 'p4', priority: 'high', dueDate: iso(-1) }),
      task('t3', 'Algo core latency fix'),
      task('t4', 'Buy milk'),
      task('t5', 'Closed one', { projectId: 'p4', done: true }),
    ])
    await db.insert(harnessInsights).values({
      id: 'h1', kind: 'person_quiet', title: 'Dana went quiet', body: 'No reply for 9 days', severity: 'attention', score: 5,
      personId: 'dana', sources: JSON.stringify([{ nodeId: 'n1', kind: 'commitment', label: 'QA slot' }]), status: 'open',
      dedupeKey: 'k1', generatedAt: NOW, createdAt: NOW, updatedAt: NOW,
    })

    const caller = await createTestCaller()
    const bundle = await caller.insights.meetingPrepBundle({ meetingId: 'next' })

    expect(bundle.found).toBe(true)
    expect(bundle.meeting).toMatchObject({ title: 'Algo 4.0 sync', project: 'Algo 4.0' })
    expect(bundle.people.map((p) => p.name)).toEqual(['Dana Levi'])
    expect(bundle.relatedOpenTasks.map((t) => [t.title, t.why])).toEqual([
      ['Freeze scope', 'project'],
      ['Send agenda', 'meeting'],
    ])
    expect(bundle.relatedOpenTasks[0]?.overdue).toBe(true)
    expect(bundle.previousMeetings.map((m) => m.meetingId)).toEqual(['prev'])
    expect(bundle.previousMeetings[0]).toMatchObject({ why: 'project', keyInsight: 'QA is the bottleneck' })
    expect(bundle.linkedMeetings).toEqual([{ id: 'prev', title: 'Algo 4.0 sync', date: iso(-7), hasSummary: true }])
    expect(bundle.harnessInsights).toEqual([
      { severity: 'attention', title: 'Dana went quiet', body: 'No reply for 9 days', person: 'Dana Levi', basedOn: ['commitment: QA slot'] },
    ])

    // By calendar title only, for an event that has no meeting row yet.
    const byTitle = await caller.insights.meetingPrepBundle({ title: 'Algo core planning' })
    expect(byTitle.found).toBe(false)
    expect(byTitle.relatedOpenTasks.map((t) => t.title)).toEqual(['Algo core latency fix'])
    expect(byTitle.previousMeetings.map((m) => m.meetingId)).toEqual(['core'])
  })
})

import { beforeEach, describe, expect, it } from 'vitest'
import {
  harnessEdges,
  harnessInsights,
  harnessNodes,
  meetingAnalyses,
  meetings,
  memories,
  memoryLinks,
  people,
  projectPeople,
  projects,
  tasks,
  userSettings,
} from '@ak-system/database'
import { getTestDb, resetDb } from '../test-utils'
import { countTopicSources, indexHarnessWorld } from './harness-context'
import { projectContext, topicContext } from './harness-entity-context'
import { renderHarnessHeader, STALE_REASON_HOURS } from './harness-header'
import { readHarnessStamps } from './harness-stamps'
import { applyDowngrades, insightFactsHash, insightKindStats, type HarnessInsightDraft, type StoredInsight } from './harness-reasoner'
import { refreshStaleProjectStandings } from './project-standing'
import { clearMemoryRelevanceCache } from './memory-relevance'

const NOW = new Date().toISOString()
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

beforeEach(async () => {
  await resetDb()
  const db = getTestDb()
  await db.delete(memoryLinks)
  await db.delete(memories)
  await db.delete(userSettings)
  clearMemoryRelevanceCache(db)
})

async function seedProject() {
  const db = getTestDb()
  await db.insert(people).values({ id: 'p1', name: 'דנה', status: 'confirmed', source: 'manual', createdAt: NOW })
  await db.insert(projects).values({ id: 'pr1', name: 'Algo 4', standingBrief: 'מתקדם לפי התוכנית', createdAt: NOW, updatedAt: NOW })
  await db.insert(projectPeople).values({ projectId: 'pr1', personId: 'p1' })
  await db.insert(meetings).values([
    { id: 'm1', title: 'Algo 4 sync', date: day(-2), projectId: 'pr1', createdAt: NOW, updatedAt: NOW },
    { id: 'm2', title: 'DD release review', date: day(-3), createdAt: NOW, updatedAt: NOW },
  ])
  await db.insert(tasks).values([
    { id: 't1', title: 'לסגור DD checklist', projectId: 'pr1', done: false, createdAt: NOW, updatedAt: NOW },
    { id: 't2', title: 'Algo 4 milestone', projectId: 'pr1', done: false, dueDate: day(3), createdAt: NOW, updatedAt: NOW },
  ])
}

describe('project + topic nodes', () => {
  it('indexes projects with BELONGS_TO and MEMBER_OF edges, idempotently', async () => {
    await seedProject()
    const db = getTestDb()
    await indexHarnessWorld(db, { scopes: ['projects'] })
    await indexHarnessWorld(db, { scopes: ['projects'] })
    const nodes = await db.select().from(harnessNodes)
    const project = nodes.find((n) => n.id === 'project:pr1')
    expect(project?.label).toBe('Algo 4')
    expect(nodes.filter((n) => n.kind === 'project')).toHaveLength(1)
    const edges = await db.select().from(harnessEdges)
    expect(edges.map((e) => e.kind).sort()).toEqual(['BELONGS_TO', 'MEMBER_OF'])
    expect((await readHarnessStamps(db)).indexedAt).not.toBeNull()
  })

  it('topics need two sources and skip project-name tokens', () => {
    const topics = countTopicSources(
      [
        { key: 'meeting:m2', kind: 'meeting', id: 'm2', text: 'DD release review' },
        { key: 'task:t1', kind: 'task', id: 't1', text: 'לסגור DD checklist' },
        { key: 'meeting:m1', kind: 'meeting', id: 'm1', text: 'Algo 4 sync' },
        { key: 'task:t2', kind: 'task', id: 't2', text: 'Algo 4 milestone' },
        { key: 'meeting:m3', kind: 'meeting', id: 'm3', text: 'Budget planning' },
      ],
      ['Algo 4'],
    )
    expect(topics.map((t) => t.token)).toEqual(['dd'])
    expect(topics[0].meetingIds).toEqual(['m2'])
  })
})

describe('project / topic context', () => {
  it('returns the project picture and notFound for an unknown project', async () => {
    await seedProject()
    const ctx = await projectContext(getTestDb(), 'pr1')
    if (ctx.notFound) throw new Error('expected project')
    expect(ctx.name).toBe('Algo 4')
    expect(ctx.openTasks[0].title).toBe('Algo 4 milestone') // the one with a due date first
    expect(ctx.people.map((p) => p.name)).toEqual(['דנה'])
    expect(ctx.recentMeetings[0].title).toBe('Algo 4 sync')
    expect((await projectContext(getTestDb(), 'nope')).notFound).toBe(true)
  })

  it('finds meetings and tasks that carry a topic', async () => {
    await seedProject()
    const ctx = await topicContext(getTestDb(), 'DD')
    expect(ctx.notFound).toBe(false)
    if (ctx.notFound) return
    expect(ctx.meetings.map((m) => m.title)).toEqual(['DD release review'])
    expect(ctx.openTasks.map((t) => t.title)).toEqual(['לסגור DD checklist'])
    expect((await topicContext(getTestDb(), 'Zebra')).notFound).toBe(true)
  })
})

describe('stale standing refresh', () => {
  it('refreshes only stale briefs, at most the limit, and survives a failure', async () => {
    const db = getTestDb()
    const old = '2026-01-01T00:00:00.000Z'
    for (let i = 0; i < 5; i++) {
      await db.insert(projects).values({ id: `pr${i}`, name: `P${i}`, standingBrief: 'x', standingBriefAt: old, createdAt: NOW, updatedAt: `2026-11-1${i}T00:00:00.000Z` })
      await db.insert(meetings).values({ id: `m${i}`, title: `M${i}`, date: day(-1), projectId: `pr${i}`, createdAt: NOW, updatedAt: NOW })
      await db.insert(meetingAnalyses).values({ id: `a${i}`, meetingId: `m${i}`, source: 'notion', status: 'done', score: 3, createdAt: NOW, updatedAt: NOW })
    }
    const writes: string[] = []
    const res = await refreshStaleProjectStandings(db, 3, async (_db, id) => {
      writes.push(id)
      if (id === 'pr4') throw new Error('gemini down')
    })
    expect(res.refreshed.length + res.failed.length).toBe(3)
    expect(res.failed).toEqual(['pr4'])
    expect(writes[0]).toBe('pr4') // most recently updated first
  })
})

describe('harness header', () => {
  const insight = (over: Partial<StoredInsight>): StoredInsight => ({
    id: 'i', kind: 'k', title: 't', body: 'b', severity: 'info', score: 0.5, personId: null,
    sources: [{ nodeId: 'person:p', kind: 'person', label: 'דנה' }], generatedAt: NOW, notifiedAt: null, ...over,
  })

  it('orders by severity, cites basedOn, and is empty when the harness never ran', () => {
    const now = new Date()
    const text = renderHarnessHeader(
      {
        insights: [insight({ id: 'a', title: 'מידע', severity: 'info', score: 0.9 }), insight({ id: 'b', title: 'דחוף', severity: 'urgent', score: 0.1 })],
        indexedAt: NOW,
        reasonedAt: NOW,
      },
      now,
    )
    expect(text.indexOf('דחוף')).toBeLessThan(text.indexOf('מידע'))
    expect(text).toContain('basedOn: דנה')
    expect(text).not.toContain('התמונה ישנה')
    expect(renderHarnessHeader({ insights: [], indexedAt: null, reasonedAt: null }, now)).toBe('')
  })

  it('flags a stale picture and stays under the cap', () => {
    const now = new Date()
    const old = new Date(now.getTime() - (STALE_REASON_HOURS + 1) * 3600_000).toISOString()
    const many = Array.from({ length: 5 }, (_, i) => insight({ id: `i${i}`, title: 'כ'.repeat(200), body: 'ב'.repeat(300) }))
    const text = renderHarnessHeader({ insights: many, indexedAt: old, reasonedAt: old }, now)
    expect(text).toContain('התמונה ישנה')
    expect(text.length).toBeLessThanOrEqual(1500)
  })
})

describe('feedback-driven downgrade', () => {
  it('downgrades a kind dismissed ≥75% of ≥6 resolved insights', async () => {
    const db = getTestDb()
    const rows = Array.from({ length: 6 }, (_, i) => ({
      id: `h${i}`, kind: 'noisy', title: 't', body: 'b', severity: 'urgent', score: 0.5, sources: '[]',
      status: i < 5 ? 'dismissed' : 'acted', dedupeKey: `noisy:${i}`, generatedAt: NOW, createdAt: NOW, updatedAt: NOW,
    }))
    await db.insert(harnessInsights).values(rows)
    const stats = await insightKindStats(db)
    expect(stats.find((s) => s.kind === 'noisy')?.downgraded).toBe(true)

    const draft: HarnessInsightDraft = {
      kind: 'noisy', title: 't', body: 'b', severity: 'urgent', score: 0.5, personId: null, sources: [], dedupeKey: 'n', ttlDays: 1,
    }
    expect(applyDowngrades([draft], stats)[0].severity).toBe('attention')
    expect(applyDowngrades([{ ...draft, kind: 'other' }], stats)[0].severity).toBe('urgent')
  })

  it('facts hash ignores wording and changes with sources', () => {
    const base = { kind: 'k', severity: 'info' as const, sources: [{ nodeId: 'a', kind: 'person', label: 'x' }] }
    expect(insightFactsHash(base)).toBe(insightFactsHash({ ...base }))
    expect(insightFactsHash(base)).not.toBe(insightFactsHash({ ...base, sources: [{ nodeId: 'b', kind: 'person', label: 'x' }] }))
  })
})

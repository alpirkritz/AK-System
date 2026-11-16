import { beforeEach, describe, expect, it } from 'vitest'
import {
  agentEpisodes,
  meetingAnalyses,
  meetings,
  memories,
  memoryLinks,
  ownerProfile,
  people,
  projects,
  userSettings,
} from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb } from '../test-utils'
import {
  applyPrioritiesUpdate,
  diffPriorities,
  getOwnerProfile,
  proposePrioritiesUpdate,
  renderOwnerProfileBlock,
  setOwnerProfile,
} from './owner-profile'
import { runDetectors } from './harness-reasoner'
import { acceptProposal, countPendingProposals, jaccard, rejectProposals, runMemoryDistiller } from './memory-distiller'
import { buildRelevantMemoryBlock, clearMemoryRelevanceCache, resetMemoryBackfillCheck } from './memory-relevance'
import { listEpisodes, pruneEpisodes, recordEpisode, renderEpisodesBlock, summarizeReply } from './agent-episodes'

const NOW = new Date().toISOString()
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10)

beforeEach(async () => {
  await resetDb()
  const db = getTestDb()
  for (const t of [memoryLinks, memories, userSettings, ownerProfile, agentEpisodes]) await db.delete(t)
  clearMemoryRelevanceCache(db)
  resetMemoryBackfillCheck()
})

describe('owner profile', () => {
  it('renders priorities in order, hides expired ones, and is empty when unset', () => {
    const empty = { roles: '', priorities: [], principles: '', updatedAt: null }
    const ctx = { worlds: [], projectNames: new Map([['pr1', 'Algo 4']]), workspaceNames: new Map<string, string>() }
    expect(renderOwnerProfileBlock(empty, ctx)).toBe('')
    const text = renderOwnerProfileBlock(
      {
        roles: 'CTO',
        principles: '',
        updatedAt: NOW,
        priorities: [
          { id: 'a', title: 'גיוס', until: '2099-01-01' },
          { id: 'b', title: 'Algo 4 ללקוח', projectId: 'pr1' },
          { id: 'c', title: 'ישן', until: '2000-01-01' },
        ],
      },
      { ...ctx, worlds: [{ name: 'Dragontail', kind: 'employer', description: 'עבודה' }] },
      '2026-11-16',
    )
    expect(text).toContain('1. גיוס (עד 2099-01-01)')
    expect(text).toContain('2. Algo 4 ללקוח (Algo 4)')
    expect(text).toContain('פג תוקף: ישן')
    expect(text).toContain('- Dragontail (employer) — עבודה')
  })

  it('propose never writes; apply is single-use and keeps ids of kept priorities', async () => {
    const db = getTestDb()
    const saved = await setOwnerProfile(db, { priorities: [{ title: 'גיוס' }, { title: 'מכירות' }] })
    const keptId = saved.priorities[1].id
    const { token, diff } = await proposePrioritiesUpdate(db, ['מכירות', 'חופשה'])
    expect(diff).toMatchObject({ added: ['חופשה'], removed: ['גיוס'] })
    expect((await getOwnerProfile(db)).priorities.map((p) => p.title)).toEqual(['גיוס', 'מכירות'])
    const applied = await applyPrioritiesUpdate(db, token)
    expect(applied.priorities.map((p) => p.title)).toEqual(['מכירות', 'חופשה'])
    expect(applied.priorities[0].id).toBe(keptId)
    await expect(applyPrioritiesUpdate(db, token)).rejects.toThrow()
    await expect(applyPrioritiesUpdate(db, 'x', Date.now())).rejects.toThrow()
  })

  it('diff detects reordering', () => {
    expect(diffPriorities([{ id: '1', title: 'A' }, { id: '2', title: 'B' }], ['B', 'A']).reordered).toBe(true)
  })

  it('flags a priority whose project went quiet for a week, once per week', async () => {
    const db = getTestDb()
    await db.insert(projects).values([
      { id: 'quiet', name: 'Quiet', createdAt: NOW, updatedAt: NOW },
      { id: 'busy', name: 'Busy', createdAt: NOW, updatedAt: NOW },
    ])
    await db.insert(meetings).values({ id: 'mb', title: 'Busy sync', date: day(-1), projectId: 'busy', createdAt: NOW, updatedAt: NOW })
    await setOwnerProfile(db, { priorities: [{ title: 'שקט', projectId: 'quiet' }, { title: 'פעיל', projectId: 'busy' }, { title: 'בלי פרויקט' }] })
    const drafts = (await runDetectors(db)).filter((d) => d.kind === 'priority_neglected')
    expect(drafts).toHaveLength(1)
    expect(drafts[0].title).toContain('שקט')
    expect(drafts[0].dedupeKey).toMatch(/^priority_neglected:pri_[0-9a-f]+:\d{4}-W\d{2}$/)
  })
})

describe('memory distiller', () => {
  async function seedSources() {
    const db = getTestDb()
    await db.insert(people).values({ id: 'p_dan', name: 'דן כהן', status: 'confirmed', source: 'manual', createdAt: NOW })
    await db.insert(meetings).values({ id: 'm1', title: 'Algo 4 sync', date: day(0), createdAt: NOW, updatedAt: NOW })
    await db.insert(meetingAnalyses).values({ id: 'a1', meetingId: 'm1', source: 'notion', status: 'done', keyInsight: 'הוחלט לדחות את Algo 4 לפברואר', createdAt: NOW, updatedAt: NOW })
    clearMemoryRelevanceCache(db)
  }

  it('proposes confident, non-duplicate facts with links and evidence; injection ignores them', async () => {
    await seedSources()
    const db = getTestDb()
    await db.insert(memories).values({ id: 'old', content: 'אני מעדיף פגישות בבוקר', kind: 'memory', source: 'manual', pinned: false, status: 'active', createdAt: NOW, updatedAt: NOW })
    const model = async () =>
      JSON.stringify({
        facts: [
          { content: 'דן כהן מוביל את Algo 4', aboutPeople: ['דן כהן'], sourceId: 'a1', confidence: 0.9 },
          { content: 'אולי משהו', confidence: 0.3 },
          { content: 'אני מעדיף פגישות בבוקר', confidence: 0.95 },
        ],
      })
    const res = await runMemoryDistiller(db, { sinceHours: 48, model })
    expect(res).toMatchObject({ proposed: 1, dropped: 2 })
    const [row] = await db.select().from(memories).where(eq(memories.status, 'proposed'))
    expect(row.source).toBe('auto')
    expect(JSON.parse(row.evidence as string)[0].label).toBe('פגישת Algo 4 sync')
    const links = await db.select().from(memoryLinks).where(eq(memoryLinks.memoryId, row.id))
    expect(links.map((l) => l.entityId)).toEqual(['p_dan'])
    const block = await buildRelevantMemoryBlock(db, { texts: ['פגישה עם דן כהן'] })
    expect(block.block).not.toContain('מוביל את Algo 4')
    expect(await countPendingProposals(db)).toBe(1)
  })

  it('accepting a replacing proposal supersedes the old memory and keeps its links; rejected never return', async () => {
    await seedSources()
    const db = getTestDb()
    await db.insert(memories).values({ id: 'old', content: 'Algo 4 בינואר', kind: 'memory', source: 'manual', pinned: false, status: 'active', createdAt: NOW, updatedAt: NOW })
    await db.insert(memoryLinks).values({ id: 'l1', memoryId: 'old', entityKind: 'person', entityId: 'p_dan', origin: 'manual', createdAt: NOW })
    const model = async () =>
      JSON.stringify({ facts: [{ content: 'Algo 4 נדחה לפברואר', replacesMemoryId: 'old', confidence: 0.9 }, { content: 'תקציב Q1 אושר', confidence: 0.8 }] })
    await runMemoryDistiller(db, { sinceHours: 48, model })
    const proposals = await db.select().from(memories).where(eq(memories.status, 'proposed'))
    const replacing = proposals.find((p) => p.replacesMemoryId === 'old')!
    await acceptProposal(db, replacing.id)
    const [old] = await db.select().from(memories).where(eq(memories.id, 'old'))
    expect(old.status).toBe('superseded')
    const block = await buildRelevantMemoryBlock(db, { texts: ['דן כהן'] })
    expect(block.block).toContain('Algo 4 נדחה לפברואר')
    expect(block.block).not.toContain('Algo 4 בינואר')

    const other = proposals.find((p) => p.id !== replacing.id)!
    await rejectProposals(db, [other.id])
    const again = await runMemoryDistiller(db, { sinceHours: 48, model: async () => JSON.stringify({ facts: [{ content: 'תקציב Q1 אושר', confidence: 0.9 }] }) })
    expect(again.proposed).toBe(0)
  })

  it('jaccard is order-insensitive', () => {
    expect(jaccard('דן מוביל את Algo', 'Algo את מוביל דן')).toBe(1)
  })

  it('advances its cursor on scheduled runs', async () => {
    const db = getTestDb()
    await runMemoryDistiller(db, { model: async () => null })
    const [row] = await db.select().from(userSettings)
    expect(row.memoryDistilledAt).not.toBeNull()
  })
})

describe('agent episodes', () => {
  it('summarizes to three structural lines without markdown', () => {
    const text = '## בוקר\n- **פגישה** עם [דן](https://x)\n- משימה\n- עוד\nפסקה'
    expect(summarizeReply(text)).toBe('בוקר · פגישה עם דן · משימה')
    expect(summarizeReply('x'.repeat(1000)).length).toBeLessThanOrEqual(400)
  })

  it('records with anchors, ranks overlapping episodes first, and prunes old ones', async () => {
    const db = getTestDb()
    await db.insert(people).values({ id: 'p_dan', name: 'דן כהן', status: 'confirmed', source: 'manual', createdAt: NOW })
    clearMemoryRelevanceCache(db)
    await recordEpisode({ agentId: '03_morning_briefing', channel: 'cron', trigger: 'schedule', reply: '- פגישה עם דן כהן ב-10:00' }, db)
    await recordEpisode({ agentId: '04_meeting_prep_herald', channel: 'cron', trigger: 'event', reply: '- מע"מ עד ה-19' }, db)
    const eps = await listEpisodes(db)
    expect(eps).toHaveLength(2)
    const text = renderEpisodesBlock(eps, [{ kind: 'person', entityId: 'p_dan', label: 'דן כהן' }])
    const lines = text.split('\n').filter((l) => l.startsWith('- '))
    expect(lines[0]).toContain('03_morning_briefing')
    await db.update(agentEpisodes).set({ createdAt: '2020-01-01T00:00:00.000Z' })
    await pruneEpisodes(db)
    expect(await db.select().from(agentEpisodes)).toHaveLength(0)
  })
})

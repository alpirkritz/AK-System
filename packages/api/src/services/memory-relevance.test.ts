import { describe, it, expect, beforeEach } from 'vitest'
import {
  getDb,
  memories,
  memoryLinks,
  people,
  personAliases,
  projects,
  userSettings,
  workspaces,
} from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { createTestCaller } from '../test-utils'
import {
  backfillMemoryLinks,
  buildRelevantMemoryBlock,
  clearMemoryRelevanceCache,
  extractAnchors,
  findPhrase,
  PER_ENTITY_CAP,
  renderMemoryBlock,
  resetMemoryBackfillCheck,
  selectMemoriesForRun,
  wordTokens,
} from './memory-relevance'

const NOW = '2026-11-16T10:00:00.000Z'

async function reset() {
  const db = getDb()
  await db.delete(memoryLinks)
  await db.delete(memories)
  await db.delete(personAliases)
  await db.delete(people)
  await db.delete(projects)
  await db.delete(workspaces)
  await db.delete(userSettings)
  clearMemoryRelevanceCache(db)
  resetMemoryBackfillCheck()
}

async function seed() {
  const db = getDb()
  await db.insert(people).values([
    { id: 'p_dan', name: 'דן כהן', createdAt: NOW },
    { id: 'p_dana', name: 'דנה לוי', createdAt: NOW },
    { id: 'p_shani', name: 'Shani Asaraf', createdAt: NOW },
  ])
  await db.insert(personAliases).values({
    id: 'al_dan', personId: 'p_dan', alias: 'דן', aliasNorm: 'דן', source: 'manual', createdAt: NOW,
  })
  await db.insert(projects).values({ id: 'pr_algo', name: 'Algo 4', createdAt: NOW, updatedAt: NOW })
  await db.insert(workspaces).values({ id: 'ws_dt', name: 'Zeta Works', createdAt: NOW, updatedAt: NOW })
  clearMemoryRelevanceCache(db)
}

async function memory(id: string, content: string, opts: { pinned?: boolean; updatedAt?: string; kind?: string } = {}) {
  await getDb().insert(memories).values({
    id,
    content,
    kind: opts.kind ?? 'memory',
    source: 'manual',
    pinned: opts.pinned ?? false,
    createdAt: NOW,
    updatedAt: opts.updatedAt ?? NOW,
  })
}

async function link(memoryId: string, kind: string, entityId: string) {
  await getDb().insert(memoryLinks).values({
    id: `ml_${memoryId}_${kind}_${entityId}`, memoryId, entityKind: kind, entityId, origin: 'manual', createdAt: NOW,
  })
  clearMemoryRelevanceCache(getDb())
}

describe('memory-relevance tokenisation', () => {
  it('matches a phrase as whole words, allowing a Hebrew prefix on the first word', () => {
    expect(findPhrase(wordTokens('תזכור שדן מעדיף עדכונים בכתב'), ['דן'])).toBe(1)
    expect(findPhrase(wordTokens('פגישה עם דנה מחר'), ['דן'])).toBe(-1)
    expect(findPhrase(wordTokens('meeting with Shani Asaraf today'), ['shani', 'asaraf'])).toBe(2)
  })
})

describe('extractAnchors', () => {
  beforeEach(async () => {
    await reset()
    await seed()
  })

  it('finds people by name and alias, projects and workspaces, in order of appearance', async () => {
    const anchors = await extractAnchors(getDb(), ['תכין אותי לפגישה עם דן על Algo 4 ב-Zeta Works'])
    expect(anchors.map((a) => `${a.kind}:${a.entityId}`)).toEqual([
      'person:p_dan',
      'project:pr_algo',
      'workspace:ws_dt',
    ])
  })

  it('does not match a name inside a longer name (דן ≠ דנה)', async () => {
    const anchors = await extractAnchors(getDb(), ['שיחה עם דנה'])
    expect(anchors.map((a) => a.entityId)).toEqual([])
  })

  it('matches topics only when some memory already links to them, in any case', async () => {
    await memory('m_dd', 'DD release needs QA sign-off')
    await link('m_dd', 'topic', 'dd')
    const anchors = await extractAnchors(getDb(), ['מה המצב עם dd?'])
    expect(anchors).toEqual([{ kind: 'topic', entityId: 'dd', label: 'dd' }])
  })
})

describe('selectMemoriesForRun + render', () => {
  beforeEach(async () => {
    await reset()
    await seed()
  })

  it('injects scoped memories only when their entity is an anchor', async () => {
    await memory('m_global', 'תמיד לענות בקצרה')
    await memory('m_dan', 'דן מעדיף עדכונים בכתב')
    await link('m_dan', 'person', 'p_dan')

    const withDan = await buildRelevantMemoryBlock(getDb(), { texts: ['מחר פגישה עם דן'] })
    expect(withDan.block).toContain('דן מעדיף עדכונים בכתב')
    expect(withDan.block).toContain('### זיכרון — דן כהן')
    expect(withDan.block).toContain('תמיד לענות בקצרה')

    const vat = await buildRelevantMemoryBlock(getDb(), { texts: ['מה עם הדיווח למע"מ?'] })
    expect(vat.block).not.toContain('דן מעדיף')
    expect(vat.block).toContain('תמיד לענות בקצרה')
  })

  it('caps memories per entity and ranks multi-anchor matches first', async () => {
    for (let i = 0; i < PER_ENTITY_CAP + 2; i++) {
      await memory(`m_${i}`, `עובדה ${i} על דן`, { updatedAt: `2026-11-${String(i + 1).padStart(2, '0')}T00:00:00.000Z` })
      await link(`m_${i}`, 'person', 'p_dan')
    }
    await memory('m_both', 'דן מוביל את Algo 4', { updatedAt: '2020-01-01T00:00:00.000Z' })
    await link('m_both', 'person', 'p_dan')
    await link('m_both', 'project', 'pr_algo')

    const anchors = await extractAnchors(getDb(), ['דן ו-Algo 4'])
    const sel = await selectMemoriesForRun(getDb(), anchors)
    const danGroup = sel.scoped.find((g) => g.anchor.entityId === 'p_dan')!
    expect(danGroup.memories).toHaveLength(PER_ENTITY_CAP)
    expect(danGroup.memories[0].id).toBe('m_both')
    // Placed once, under the first anchor only.
    expect(sel.scoped.find((g) => g.anchor.entityId === 'pr_algo')).toBeUndefined()
    expect(sel.overCap).toHaveLength(3)
  })

  it('renders instructions, then global memories, then scoped groups, within the cap', () => {
    const { block, dropped } = renderMemoryBlock(
      {
        instructions: 'הוראה',
        global: [{ id: 'g', content: 'כללי', kind: 'memory', pinned: true, updatedAt: NOW }],
        scoped: [
          {
            anchor: { kind: 'project', entityId: 'pr', label: 'Algo 4' },
            memories: [{ id: 's', content: 'x'.repeat(5000), kind: 'memory', pinned: false, updatedAt: NOW }],
          },
        ],
      },
      1000,
    )
    expect(block.indexOf('הוראה')).toBeLessThan(block.indexOf('כללי'))
    expect(block).not.toContain('Algo 4')
    expect(dropped).toHaveLength(1)
  })
})

describe('memory router + entity lifecycle', () => {
  beforeEach(async () => {
    await reset()
    await seed()
  })

  it('creates with links, lists by entity, and setLinks replaces them', async () => {
    const caller = await createTestCaller()
    const created = await caller.memory.memories.create({
      content: 'Algo 4 נדחה לרבעון הבא',
      kind: 'memory',
      source: 'manual',
      links: [{ kind: 'project', entityId: 'pr_algo' }, { kind: 'topic', entityId: 'Algo 4.0' }],
    })
    expect(created?.links.map((l) => `${l.kind}:${l.entityId}`).sort()).toEqual(['project:pr_algo', 'topic:algo'])

    const byProject = await caller.memory.memories.list({ projectId: 'pr_algo' })
    expect(byProject.map((m) => m.id)).toEqual([created!.id])
    expect(await caller.memory.memories.list({ scope: 'global' })).toHaveLength(0)

    await caller.memory.memories.setLinks({ id: created!.id, links: [] })
    expect(await caller.memory.memories.list({ scope: 'global' })).toHaveLength(1)
  })

  it('deleting a project removes its links and leaves the memory global', async () => {
    const caller = await createTestCaller()
    await memory('m_algo', 'Algo 4 בעיכוב')
    await link('m_algo', 'project', 'pr_algo')
    await caller.projects.delete({ id: 'pr_algo' })
    const rows = await getDb().select().from(memoryLinks).where(eq(memoryLinks.memoryId, 'm_algo'))
    expect(rows).toHaveLength(0)
    expect(await getDb().select().from(memories).where(eq(memories.id, 'm_algo'))).toHaveLength(1)
  })

  it('merging people moves links without duplicating them', async () => {
    const caller = await createTestCaller()
    await memory('m_one', 'על דנה')
    await link('m_one', 'person', 'p_dana')
    await memory('m_both', 'על שניהם')
    await link('m_both', 'person', 'p_dana')
    await link('m_both', 'person', 'p_dan')
    await caller.people.merge({ fromId: 'p_dana', toId: 'p_dan' })
    const rows = await getDb().select().from(memoryLinks).where(eq(memoryLinks.entityKind, 'person'))
    expect(rows.map((r) => `${r.memoryId}:${r.entityId}`).sort()).toEqual(['m_both:p_dan', 'm_one:p_dan'])
  })

  it('resolveNames links known names and reports unknown ones', async () => {
    const caller = await createTestCaller()
    const res = await caller.memory.resolveNames({ people: ['דן כהן', 'מישהו לא קיים'], projects: ['algo 4'], topics: ['DD'] })
    expect(res.links.map((l) => `${l.kind}:${l.entityId}`)).toEqual(['person:p_dan', 'project:pr_algo', 'topic:dd'])
    expect(res.unresolved).toEqual(['מישהו לא קיים'])
  })

  it('recall returns every linked memory, with no per-entity cap', async () => {
    const caller = await createTestCaller()
    for (let i = 0; i < PER_ENTITY_CAP + 3; i++) {
      await memory(`m_${i}`, `עובדה ${i}`)
      await link(`m_${i}`, 'person', 'p_dan')
    }
    const res = await caller.memory.recall({ person: 'דן כהן' })
    expect(res.scoped[0].memories).toHaveLength(PER_ENTITY_CAP + 3)
  })
})

describe('backfill', () => {
  beforeEach(async () => {
    await reset()
    await seed()
  })

  it('links existing memories by content, skips instructions, and is idempotent', async () => {
    await memory('m_dan', 'דן אחראי על Algo 4')
    await memory('m_instr', 'דן תמיד ראשון', { kind: 'instruction' })
    await memory('m_none', 'אני מעדיף פגישות בבוקר')

    const first = await backfillMemoryLinks(getDb())
    expect(first).toBe(2)
    const second = await backfillMemoryLinks(getDb())
    expect(second).toBe(0)

    const rows = await getDb().select().from(memoryLinks)
    expect(rows.map((r) => `${r.memoryId}:${r.entityKind}:${r.origin}`).sort()).toEqual([
      'm_dan:person:backfill',
      'm_dan:project:backfill',
    ])
  })
})

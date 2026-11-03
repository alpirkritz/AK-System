import { beforeEach, describe, expect, it } from 'vitest'
import { and, eq } from 'drizzle-orm'
import { identityQueue, people, personEmailThreads, personExternalIds, personWorkspaces } from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { matchEmailCandidate, nameFromEmailLocalPart, normalizeAlias } from '../services/person-resolution'
import { headerEntries, ingestWorkMail, rankUnknownCorrespondents } from '../services/work-comms-ingest'
import { buildPersonContext } from '../services/person-context'
import { gmailThreadUrl } from '../services/commitments'
import type { EmailHeaderMessage } from '../services/email-sync'

const NOW = new Date().toISOString()
const ACCOUNT = 'alpir@work.com'

async function seed() {
  const db = getTestDb()
  await db.insert(people).values([
    { id: 'p_shani', name: 'Shani Asaraf', status: 'confirmed', source: 'notion', createdAt: NOW },
    { id: 'p_david', name: 'Tinko (David Kotin)', status: 'confirmed', source: 'notion', createdAt: NOW },
    { id: 'p_dana', name: 'דנה', email: 'dana@x.com', status: 'confirmed', source: 'manual', createdAt: NOW },
  ])
}

function msg(over: Partial<EmailHeaderMessage> & { messageId: string }): EmailHeaderMessage {
  return {
    accountEmail: ACCOUNT,
    threadId: `AAQkAD${over.messageId}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx=`,
    subject: 'עדכון',
    from: `Alpir <${ACCOUNT}>`,
    to: '',
    cc: '',
    date: NOW,
    snippet: '',
    ...over,
  }
}

describe('matchEmailCandidate', () => {
  const rows = [
    { id: 'p_shani', name: 'Shani Asaraf' },
    { id: 'p_david', name: 'Tinko (David Kotin)' },
    { id: 'p_dan1', name: 'Dan Cohen' },
    { id: 'p_dan2', name: 'Dan Cohen' },
  ]

  it('derives a name from a first.last local part only', () => {
    expect(nameFromEmailLocalPart('Shani.Asaraf@pizzahut.com')).toBe('shani asaraf')
    expect(nameFromEmailLocalPart('david_kotin2@x.com')).toBe('david kotin')
    expect(nameFromEmailLocalPart('sales@x.com')).toBeNull()
  })

  it('matches the display name in any word order', () => {
    expect(matchEmailCandidate({ name: 'Asaraf, Shani', address: 'sa@x.com' }, rows, [])).toBe('p_shani')
  })

  it('falls back to the local part, and to words inside a fuller name', () => {
    expect(matchEmailCandidate({ name: null, address: 'Shani.Asaraf@pizzahut.com' }, rows, [])).toBe('p_shani')
    expect(matchEmailCandidate({ name: 'David Kotin', address: 'David.Kotin@pizzahut.com' }, rows, [])).toBe('p_david')
  })

  it('matches through an alias', () => {
    const aliases = [{ personId: 'p_david', aliasNorm: normalizeAlias('Dudi K') }]
    expect(matchEmailCandidate({ name: 'Dudi K', address: 'dk@x.com' }, rows, aliases)).toBe('p_david')
  })

  it('suggests nobody when the name is ambiguous or unknown', () => {
    expect(matchEmailCandidate({ name: 'Dan Cohen', address: 'dan@x.com' }, rows, [])).toBeNull()
    expect(matchEmailCandidate({ name: 'Someone Else', address: 'se@x.com' }, rows, [])).toBeNull()
  })
})

describe('headerEntries', () => {
  it('splits To/Cc on commas outside quotes', () => {
    expect(headerEntries('"Asaraf, Shani" <Shani.Asaraf@pizzahut.com>, bob@x.com')).toEqual([
      { address: 'shani.asaraf@pizzahut.com', name: 'Asaraf, Shani' },
      { address: 'bob@x.com', name: null },
    ])
  })
})

describe('work mail suggestions from recipients', () => {
  beforeEach(async () => {
    await resetDb()
    await seed()
  })

  it('queues To/Cc recipients and attaches a name-matched candidate', async () => {
    const db = getTestDb()
    const result = await ingestWorkMail(db, [
      msg({ messageId: 'm1', to: '"Asaraf, Shani" <Shani.Asaraf@pizzahut.com>', cc: 'David.Kotin@pizzahut.com' }),
      msg({ messageId: 'm2', to: 'Stranger Person <stranger@x.com>' }),
      msg({ messageId: 'm3', to: 'noreply@x.com' }),
    ])
    expect(result.suggestedSenders).toBe(3)
    const rows = await db.select().from(identityQueue)
    const byEmail = Object.fromEntries(rows.map((r) => [r.email, r]))
    expect(byEmail['shani.asaraf@pizzahut.com']!.candidatePersonId).toBe('p_shani')
    expect(byEmail['david.kotin@pizzahut.com']!.candidatePersonId).toBe('p_david')
    expect(byEmail['stranger@x.com']!.candidatePersonId).toBeNull()
    expect(byEmail['shani.asaraf@pizzahut.com']!.context).toBe('מייל עבודה · נמען/ת')
    expect(byEmail['noreply@x.com']).toBeUndefined()
  })

  it('gives a pending row a candidate on a later run', async () => {
    const db = getTestDb()
    await ingestWorkMail(db, [msg({ messageId: 'm1', to: 'Ron Levi <ron@x.com>' })])
    const [before] = await db.select().from(identityQueue).where(eq(identityQueue.email, 'ron@x.com'))
    expect(before!.candidatePersonId).toBeNull()
    await db.insert(people).values({ id: 'p_ron', name: 'Ron Levi', status: 'confirmed', source: 'manual', createdAt: NOW })
    await ingestWorkMail(db, [msg({ messageId: 'm2', to: 'Ron Levi <ron@x.com>' })])
    const all = await db.select().from(identityQueue).where(eq(identityQueue.email, 'ron@x.com'))
    expect(all).toHaveLength(1)
    expect(all[0]!.candidatePersonId).toBe('p_ron')
  })

  it('ranks people who wrote to me above people I only wrote to', () => {
    const ranked = rankUnknownCorrespondents(
      [
        msg({ messageId: 'a1', to: 'only.recipient@x.com' }),
        msg({ messageId: 'a2', to: 'only.recipient@x.com, dana@x.com' }),
        msg({ messageId: 'a3', from: 'Wrote Once <wrote.once@x.com>', to: ACCOUNT }),
      ],
      new Set(['dana@x.com']),
    )
    expect(ranked.map((r) => [r.email, r.sent, r.total])).toEqual([
      ['wrote.once@x.com', 1, 1],
      ['only.recipient@x.com', 0, 2],
    ])
  })
})

describe('people.emails', () => {
  beforeEach(async () => {
    await resetDb()
    await seed()
  })

  it('fills the primary field first, then links further addresses', async () => {
    const caller = await createTestCaller()
    await caller.people.emails.add({ personId: 'p_shani', address: 'Shani.Asaraf@pizzahut.com' })
    await caller.people.emails.add({ personId: 'p_shani', address: 'shani@gmail.com' })
    const list = await caller.people.emails.list({ personId: 'p_shani' })
    expect(list).toEqual([
      { address: 'shani.asaraf@pizzahut.com', source: 'primary', accountKey: null },
      { address: 'shani@gmail.com', source: 'linked', accountKey: 'manual' },
    ])
  })

  it('refuses an address that belongs to someone else', async () => {
    const caller = await createTestCaller()
    await expect(caller.people.emails.add({ personId: 'p_shani', address: 'dana@x.com' })).rejects.toThrow(/דנה/)
  })

  it('removes a linked or primary address', async () => {
    const caller = await createTestCaller()
    await caller.people.emails.add({ personId: 'p_dana', address: 'dana@work.com' })
    await caller.people.emails.remove({ personId: 'p_dana', address: 'dana@work.com' })
    await caller.people.emails.remove({ personId: 'p_dana', address: 'dana@x.com' })
    expect(await caller.people.emails.list({ personId: 'p_dana' })).toEqual([])
    const db = getTestDb()
    const ext = await db.select().from(personExternalIds).where(and(eq(personExternalIds.personId, 'p_dana'), eq(personExternalIds.provider, 'email')))
    expect(ext).toHaveLength(0)
  })

  it('archives Outlook threads once an address is linked', async () => {
    const caller = await createTestCaller()
    await caller.people.emails.add({ personId: 'p_shani', address: 'Shani.Asaraf@pizzahut.com' })
    const db = getTestDb()
    await ingestWorkMail(db, [msg({ messageId: 'm1', subject: 'תקציב', to: 'Shani.Asaraf@pizzahut.com' })])
    const threads = await db.select().from(personEmailThreads).where(eq(personEmailThreads.personId, 'p_shani'))
    expect(threads.map((t) => t.subject)).toEqual(['תקציב'])
  })
})

describe('person context email channel', () => {
  beforeEach(async () => {
    await resetDb()
    await seed()
  })

  it('returns every address and the direction of each thread', async () => {
    const db = getTestDb()
    await db.insert(personExternalIds).values({
      id: 'pe1', personId: 'p_dana', provider: 'email', accountKey: 'work-mail', externalId: 'dana@work.com', createdAt: NOW, updatedAt: NOW,
    })
    await db.insert(personEmailThreads).values([
      { id: 'et1', personId: 'p_dana', gmailThreadId: `${ACCOUNT}::abc123`, accountEmail: ACCOUNT, subject: 'שלחתי', from: `Alpir <${ACCOUNT}>`, to: 'dana@x.com', date: NOW, messageCount: 1, lastSyncedAt: NOW, createdAt: NOW },
      { id: 'et2', personId: 'p_dana', gmailThreadId: `${ACCOUNT}::AAQkADlongconversationid0000000000000=`, accountEmail: ACCOUNT, subject: 'קיבלתי', from: 'דנה <dana@work.com>', to: ACCOUNT, date: NOW, messageCount: 2, lastSyncedAt: NOW, createdAt: NOW },
    ])
    const ctx = await buildPersonContext(db, 'p_dana')
    expect(ctx!.emailAddresses.map((e) => e.address)).toEqual(['dana@x.com', 'dana@work.com'])
    const bySubject = Object.fromEntries(ctx!.emailThreads.map((t) => [t.subject, t]))
    expect(bySubject['שלחתי']!.fromMe).toBe(true)
    expect(bySubject['קיבלתי']!.fromMe).toBe(false)
    expect(bySubject['קיבלתי']!.gmailUrl).toBeNull()
  })

  it('gives Outlook conversation ids no Gmail link', () => {
    expect(gmailThreadUrl(`${ACCOUNT}::18c2f0a1b2c3d4e5`)).toContain('mail.google.com')
    expect(gmailThreadUrl(`${ACCOUNT}::AAQkADk3ZTEwYWU5LTk0NmItNDhmMi1hZjE4LWQ=`)).toBeNull()
  })
})

describe('reports to anyone in People', () => {
  beforeEach(async () => {
    await resetDb()
    await seed()
  })

  it('adds a manager from outside the workspace to it', async () => {
    const caller = await createTestCaller()
    await caller.people.linkToWorkspace({
      personId: 'p_shani', workspaceId: 'ws_dragontail', relationshipType: 'colleague', reportsToPersonId: 'p_david',
    })
    const db = getTestDb()
    const managerRows = await db.select().from(personWorkspaces).where(eq(personWorkspaces.personId, 'p_david'))
    expect(managerRows.map((r) => [r.workspaceId, r.relationshipType])).toEqual([['ws_dragontail', 'colleague']])
    const [shani] = await caller.people.affiliations({ personId: 'p_shani' })
    expect(shani!.reportsToName).toBe('Tinko (David Kotin)')
  })

  it('leaves an existing manager affiliation untouched', async () => {
    const caller = await createTestCaller()
    await caller.people.linkToWorkspace({ personId: 'p_david', workspaceId: 'ws_dragontail', relationshipType: 'manager' })
    await caller.people.linkToWorkspace({
      personId: 'p_shani', workspaceId: 'ws_dragontail', relationshipType: 'colleague', reportsToPersonId: 'p_david',
    })
    const db = getTestDb()
    const managerRows = await db.select().from(personWorkspaces).where(eq(personWorkspaces.personId, 'p_david'))
    expect(managerRows.map((r) => r.relationshipType)).toEqual(['manager'])
  })
})

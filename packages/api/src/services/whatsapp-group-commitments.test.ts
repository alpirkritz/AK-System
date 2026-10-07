import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commitments, people, userSettings, whatsappGroups, whatsappMessages, whatsappPersonLinks } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'

const SELF_JID = '972500000001@s.whatsapp.net'
const DANA_JID = '972501234567@s.whatsapp.net'
const DANA_LID = '11122233344455@lid'
const GROUP_JID = 'grp1@g.us'

let bridgeConfigured = true
let bridgeStatus: { selfJid: string } = { selfJid: SELF_JID }

vi.mock('./whatsapp-bridge-client', () => ({
  isBridgeConfigured: () => bridgeConfigured,
  getBridgeStatus: async () => bridgeStatus,
  bridgeFetch: vi.fn(),
}))

import { ClassificationUnavailable, scanGroupCommitments, type ConversationLine, type MessageClassifier } from './whatsapp-dm'

const NOW = new Date().toISOString()

const echo = (owner: 'me' | 'them'): MessageClassifier => async (msgs) =>
  msgs.filter((m) => m.citable !== false).map((m) => ({
    messageId: m.id,
    owner,
    content: m.text,
    due: null,
    because: 'נשאר אחרי השיחה',
  }))

async function seedGroup(enabled = true) {
  await getTestDb().insert(whatsappGroups).values({
    id: 'wg1',
    jid: GROUP_JID,
    name: 'חרוזים',
    enabled,
    updatedAt: NOW,
  })
}

async function seedMessage(id: string, sender: string, text: string, ts: number, senderName = sender) {
  await getTestDb().insert(whatsappMessages).values({
    id,
    groupJid: GROUP_JID,
    waMessageId: id,
    sender,
    senderName,
    text,
    ts,
    createdAt: NOW,
  })
}

describe('WhatsApp group commitment scan', () => {
  beforeEach(async () => {
    await resetDb()
    await getTestDb().delete(whatsappMessages)
    await getTestDb().delete(whatsappGroups)
    await getTestDb().delete(userSettings)
    bridgeConfigured = true
    bridgeStatus = { selfJid: SELF_JID }
  })

  it('attributes a self-promise said in the group to the owner\'s own person', async () => {
    await seedGroup()
    const ts = Date.now() - 60_000
    await seedMessage('m1', SELF_JID, 'אשלח לקבוצה את הקובץ מחר', ts)

    const result = await scanGroupCommitments(getTestDb(), { classify: echo('me') })
    expect(result).toMatchObject({ groups: 1, commitments: 1 })
    expect(result.proposed[0]).toMatchObject({ label: 'חרוזים', content: 'אשלח לקבוצה את הקובץ מחר', because: 'נשאר אחרי השיחה' })

    const [c] = await getTestDb().select().from(commitments)
    expect(c).toMatchObject({ owner: 'me', source: 'whatsapp_group', sourceId: 'm1', status: 'proposed' })
    const [self] = await getTestDb().select().from(people).where(eq(people.id, c.personId))
    expect(self.name).toBe('Alpir Kritzler')
  })

  it('stores the message text, its own timestamp and the group it came from', async () => {
    await seedGroup()
    const ts = Date.now() - 3 * 3_600_000
    await seedMessage('m1', SELF_JID, 'אשלח לקבוצה את הקובץ מחר', ts)

    await scanGroupCommitments(getTestDb(), { classify: echo('me') })

    const [c] = await getTestDb().select().from(commitments)
    expect(c).toMatchObject({
      sourceSnippet: 'אשלח לקבוצה את הקובץ מחר',
      sourceReason: 'נשאר אחרי השיחה',
      sourceTs: ts,
      sourceChatJid: GROUP_JID,
      sourceChatName: 'חרוזים',
    })
  })

  it('exposes the source message window through commitments.sourceContext', async () => {
    await seedGroup()
    const ts = Date.now() - 60_000
    await seedMessage('m0', DANA_JID, 'מה קורה עם הקובץ?', ts - 2000, 'דנה')
    await seedMessage('m1', SELF_JID, 'אשלח לקבוצה את הקובץ מחר', ts)
    await seedMessage('m2', DANA_JID, 'סבבה', ts + 2000, 'דנה')
    await scanGroupCommitments(getTestDb(), { classify: echo('me') })
    const rows = await getTestDb().select().from(commitments)
    const fromM1 = rows.find((r) => r.sourceId === 'm1')!

    const caller = await createTestCaller()
    const context = await caller.commitments.sourceContext({ commitmentId: fromM1.id })
    expect(context.chatName).toBe('חרוזים')
    expect(context.messages.map((m) => m.text)).toEqual(['מה קורה עם הקובץ?', 'אשלח לקבוצה את הקובץ מחר', 'סבבה'])
    expect(context.messages.filter((m) => m.isSource).map((m) => m.id)).toEqual(['m1'])
  })

  it('attributes a promise from a phone-matched contact, and keeps an unidentified sender', async () => {
    await seedGroup()
    await getTestDb().insert(people).values({ id: 'p1', name: 'Dana Levi', phone: '050-123-4567', status: 'confirmed', source: 'manual', createdAt: NOW })
    const ts = Date.now() - 60_000
    await seedMessage('m1', DANA_JID, 'מזמין כוסות חדשות לקבוצה', ts)
    await seedMessage('m2', '972509999999@s.whatsapp.net', 'אשלח לכולם את הקובץ', ts + 1000, 'אורח')

    const result = await scanGroupCommitments(getTestDb(), { classify: echo('them') })
    expect(result.commitments).toBe(2)
    const rows = await getTestDb().select().from(commitments)
    expect(rows).toHaveLength(2)
    expect(rows.find((r) => r.sourceId === 'm1')).toMatchObject({ personId: 'p1', owner: 'them', senderJid: null })
    expect(rows.find((r) => r.sourceId === 'm2')).toMatchObject({
      personId: null,
      owner: 'them',
      senderJid: '972509999999@s.whatsapp.net',
      senderName: 'אורח',
      sourceSnippet: 'אשלח לכולם את הקובץ',
      sourceReason: 'נשאר אחרי השיחה',
    })
    expect(result.proposed.find((p) => p.content.includes('לכולם'))).toMatchObject({ label: 'חרוזים', unknownSender: true })
  })

  it('resolves an @lid sender through a manual whatsapp_person_links entry', async () => {
    await seedGroup()
    await getTestDb().insert(people).values({ id: 'p1', name: 'Dana Levi', status: 'confirmed', source: 'manual', createdAt: NOW })
    await getTestDb().insert(whatsappPersonLinks).values({ id: 'l1', personId: 'p1', whatsappJid: DANA_LID, matchedBy: 'manual', createdAt: NOW })
    await seedMessage('m1', DANA_LID, 'מזמין כוסות חדשות לקבוצה', Date.now() - 60_000)

    const result = await scanGroupCommitments(getTestDb(), { classify: echo('them') })
    expect(result.commitments).toBe(1)
    const [c] = await getTestDb().select().from(commitments)
    expect(c).toMatchObject({ personId: 'p1', owner: 'them' })
  })

  it('ignores a disabled group entirely', async () => {
    await seedGroup(false)
    await seedMessage('m1', SELF_JID, 'אשלח לקבוצה את הקובץ מחר', Date.now() - 60_000)
    expect(await scanGroupCommitments(getTestDb())).toEqual({ groups: 0, commitments: 0, proposed: [] })
  })

  it('files a request on the owner and keeps an unidentified sender the model still owes to them', async () => {
    await seedGroup()
    await getTestDb().insert(people).values({ id: 'p1', name: 'Dana Levi', phone: '050-123-4567', status: 'confirmed', source: 'manual', createdAt: NOW })
    const ts = Date.now() - 60_000
    await seedMessage('m1', DANA_JID, 'אל תשכחי להביא את זה בשישי', ts)
    await seedMessage('m2', '972509999999@s.whatsapp.net', 'תזכיר לי גם', ts + 1000, 'אורח')

    const seen: string[] = []
    const classify = async (msgs: ConversationLine[]) => {
      seen.push(...msgs.filter((m) => m.citable !== false).map((m) => m.speakerLabel))
      return [
        { messageId: 'm1', owner: 'me' as const, content: 'להביא את זה בשישי', due: null, because: 'דנה ביקשה' },
        { messageId: 'm2', owner: 'them' as const, content: 'לזכור', due: null, because: 'הוא לקח' },
      ]
    }
    const result = await scanGroupCommitments(getTestDb(), { classify })
    expect(seen.sort()).toEqual([DANA_JID, 'אורח'].sort())
    expect(result.commitments).toBe(2)
    const rows = await getTestDb().select().from(commitments)
    const mine = rows.find((r) => r.sourceId === 'm1')
    const [self] = await getTestDb().select().from(people).where(eq(people.id, mine!.personId!))
    expect(self.name).toBe('Alpir Kritzler')
    expect(mine).toMatchObject({ owner: 'me', content: 'להביא את זה בשישי' })
    expect(rows.find((r) => r.sourceId === 'm2')).toMatchObject({ personId: null, senderName: 'אורח', owner: 'them' })
  })

  it('does not repeat an already-proposed message on a later run', async () => {
    await seedGroup()
    const ts = Date.now() - 60_000
    await seedMessage('m1', SELF_JID, 'אשלח לקבוצה את הקובץ מחר', ts)
    expect((await scanGroupCommitments(getTestDb(), { classify: echo('me') })).commitments).toBe(1)
    expect((await scanGroupCommitments(getTestDb(), { classify: echo('me') })).commitments).toBe(0)

    await seedMessage('m2', SELF_JID, 'אטפל בזה בעצמי', ts + 1000)
    expect((await scanGroupCommitments(getTestDb(), { classify: echo('me') })).commitments).toBe(1)
    expect(await getTestDb().select().from(commitments)).toHaveLength(2)
  })

  it('does not advance the cursor past a group whose classification failed', async () => {
    await seedGroup()
    const ts = Date.now() - 60_000
    await seedMessage('m1', SELF_JID, 'אשלח לקבוצה את הקובץ', ts)
    const fail: MessageClassifier = async () => { throw new ClassificationUnavailable('down') }
    expect((await scanGroupCommitments(getTestDb(), { classify: fail })).commitments).toBe(0)
    const [settings] = await getTestDb().select().from(userSettings)
    expect(Number(settings?.whatsappGroupCommitmentScanCursor ?? 0)).toBeLessThan(ts)
    expect((await scanGroupCommitments(getTestDb(), { classify: echo('me') })).commitments).toBe(1)
  })

  it('inserts nothing when the classifier finds no standing commitment', async () => {
    await seedGroup()
    await seedMessage('m1', SELF_JID, 'חלום, מזמין כוסות חדשות', Date.now() - 60_000)
    const classify: MessageClassifier = async () => []
    expect(await scanGroupCommitments(getTestDb(), { classify })).toMatchObject({ groups: 1, commitments: 0, proposed: [] })
    expect(await getTestDb().select().from(commitments)).toHaveLength(0)
  })

  it('does not insert a source message that was already dismissed', async () => {
    await seedGroup()
    const ts = Date.now() - 60_000
    await seedMessage('m1', SELF_JID, 'אשלח לקבוצה את הקובץ', ts)
    await getTestDb().insert(people).values({ id: 'p9', name: 'Alpir', status: 'confirmed', source: 'manual', createdAt: NOW })
    await getTestDb().insert(commitments).values({
      id: 'old', personId: 'p9', owner: 'me', content: 'ישן', source: 'whatsapp_group', sourceId: 'm1', status: 'dismissed', createdAt: NOW, updatedAt: NOW,
    })
    expect((await scanGroupCommitments(getTestDb(), { classify: echo('me') })).commitments).toBe(0)
    expect(await getTestDb().select().from(commitments)).toHaveLength(1)
  })

  it('saves an unknown sender as a contact and links another without overwriting a phone', async () => {
    const db = getTestDb()
    await db.insert(people).values({ id: 'p1', name: 'Dana Levi', phone: '050-111-1111', status: 'confirmed', source: 'manual', createdAt: NOW })
    await db.insert(commitments).values([
      { id: 'cu1', personId: null, senderJid: '972509999999@s.whatsapp.net', senderName: 'אורח', owner: 'them', content: 'לשלוח קובץ', source: 'whatsapp_group', sourceId: 'u1', status: 'proposed', createdAt: NOW, updatedAt: NOW },
      { id: 'cu2', personId: null, senderJid: DANA_LID, senderName: 'דנה בקבוצה', owner: 'them', content: 'לבדוק', source: 'whatsapp_group', sourceId: 'u2', status: 'proposed', createdAt: NOW, updatedAt: NOW },
    ])
    const caller = await createTestCaller()
    const listed = await caller.commitments.listProposed()
    expect(listed.find((c) => c.id === 'cu1')).toMatchObject({ personId: null, personName: null, senderName: 'אורח' })
    await expect(caller.commitments.accept({ commitmentId: 'cu2' })).rejects.toThrow(/איש קשר/)

    const saved = await caller.commitments.saveUnknownContact({ commitmentId: 'cu1' })
    const [created] = await db.select().from(people).where(eq(people.id, saved.personId))
    expect(created).toMatchObject({ name: 'אורח', phone: '972509999999', captureWhatsapp: true })
    const [link] = await db.select().from(whatsappPersonLinks).where(eq(whatsappPersonLinks.whatsappJid, '972509999999@s.whatsapp.net'))
    expect(link.personId).toBe(saved.personId)
    const [c1] = await db.select().from(commitments).where(eq(commitments.id, 'cu1'))
    expect(c1).toMatchObject({ personId: saved.personId, senderJid: null, senderName: null })

    await caller.commitments.linkUnknownContact({ commitmentId: 'cu2', personId: 'p1' })
    const [dana] = await db.select().from(people).where(eq(people.id, 'p1'))
    expect(dana.phone).toBe('050-111-1111')
    expect(dana.captureWhatsapp).toBe(false)
    const [c2] = await db.select().from(commitments).where(eq(commitments.id, 'cu2'))
    expect(c2).toMatchObject({ personId: 'p1', senderJid: null, senderName: null })
    const [lid] = await db.select().from(whatsappPersonLinks).where(eq(whatsappPersonLinks.whatsappJid, DANA_LID))
    expect(lid.personId).toBe('p1')
  })
})

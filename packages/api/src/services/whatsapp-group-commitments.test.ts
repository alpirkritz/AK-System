import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commitments, people, userSettings, whatsappGroups, whatsappMessages, whatsappPersonLinks } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { getTestDb, resetDb } from '../test-utils'

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

import { scanGroupCommitments } from './whatsapp-dm'

const NOW = new Date().toISOString()

async function seedGroup(enabled = true) {
  await getTestDb().insert(whatsappGroups).values({
    id: 'wg1',
    jid: GROUP_JID,
    name: 'חרוזים',
    enabled,
    updatedAt: NOW,
  })
}

async function seedMessage(id: string, sender: string, text: string, ts: number) {
  await getTestDb().insert(whatsappMessages).values({
    id,
    groupJid: GROUP_JID,
    waMessageId: id,
    sender,
    senderName: sender,
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

    const result = await scanGroupCommitments(getTestDb())
    expect(result).toMatchObject({ groups: 1, commitments: 1 })
    expect(result.proposed).toEqual([{ label: 'חרוזים', content: 'אשלח לקבוצה את הקובץ מחר' }])

    const [c] = await getTestDb().select().from(commitments)
    expect(c).toMatchObject({ owner: 'me', source: 'whatsapp_group', sourceId: 'm1', status: 'proposed' })
    const [self] = await getTestDb().select().from(people).where(eq(people.id, c.personId))
    expect(self.name).toBe('Alpir Kritzler')
  })

  it('attributes a promise from a phone-matched contact, and skips an unidentified sender', async () => {
    await seedGroup()
    await getTestDb().insert(people).values({ id: 'p1', name: 'Dana Levi', phone: '050-123-4567', status: 'confirmed', source: 'manual', createdAt: NOW })
    const ts = Date.now() - 60_000
    await seedMessage('m1', DANA_JID, 'מזמין כוסות חדשות לקבוצה', ts)
    await seedMessage('m2', '972509999999@s.whatsapp.net', 'אשלח לכולם את הקובץ', ts + 1000)

    const result = await scanGroupCommitments(getTestDb())
    expect(result.commitments).toBe(1)
    const rows = await getTestDb().select().from(commitments)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ personId: 'p1', owner: 'them', source: 'whatsapp_group', sourceId: 'm1' })
  })

  it('resolves an @lid sender through a manual whatsapp_person_links entry', async () => {
    await seedGroup()
    await getTestDb().insert(people).values({ id: 'p1', name: 'Dana Levi', status: 'confirmed', source: 'manual', createdAt: NOW })
    await getTestDb().insert(whatsappPersonLinks).values({ id: 'l1', personId: 'p1', whatsappJid: DANA_LID, matchedBy: 'manual', createdAt: NOW })
    await seedMessage('m1', DANA_LID, 'מזמין כוסות חדשות לקבוצה', Date.now() - 60_000)

    const result = await scanGroupCommitments(getTestDb())
    expect(result.commitments).toBe(1)
    const [c] = await getTestDb().select().from(commitments)
    expect(c).toMatchObject({ personId: 'p1', owner: 'them' })
  })

  it('ignores a disabled group entirely', async () => {
    await seedGroup(false)
    await seedMessage('m1', SELF_JID, 'אשלח לקבוצה את הקובץ מחר', Date.now() - 60_000)
    expect(await scanGroupCommitments(getTestDb())).toEqual({ groups: 0, commitments: 0, proposed: [] })
  })

  it('uses an injected classifier, still skipping an unidentified sender it flags', async () => {
    await seedGroup()
    await getTestDb().insert(people).values({ id: 'p1', name: 'Dana Levi', phone: '050-123-4567', status: 'confirmed', source: 'manual', createdAt: NOW })
    const ts = Date.now() - 60_000
    await seedMessage('m1', DANA_JID, 'אל תשכחי להביא את זה בשישי', ts)
    await seedMessage('m2', '972509999999@s.whatsapp.net', 'תזכיר לי גם', ts + 1000)

    const seen: string[] = []
    const classify = async (msgs: { id: string; speakerLabel: string; text: string; ts: number }[]) => {
      seen.push(...msgs.map((m) => m.speakerLabel))
      return [
        { messageId: 'm1', kind: 'request' as const, content: 'להביא את זה בשישי', due: null },
        { messageId: 'm2', kind: 'request' as const, content: 'לזכור', due: null },
      ]
    }
    const result = await scanGroupCommitments(getTestDb(), { classify })
    // Both messages were sent to the model (senderName, since neither sender is the bridge's own JID)...
    expect(seen.sort()).toEqual([DANA_JID, '972509999999@s.whatsapp.net'].sort())
    // ...but only the identified sender's item survives, since m2's sender never resolves to a person.
    expect(result.commitments).toBe(1)
    const [c] = await getTestDb().select().from(commitments)
    // A "request" from a non-self sender means the request target (me) owes it, same as in DMs.
    expect(c).toMatchObject({ personId: 'p1', owner: 'me', content: 'להביא את זה בשישי' })
  })

  it('does not repeat an already-proposed message on a later run', async () => {
    await seedGroup()
    const ts = Date.now() - 60_000
    await seedMessage('m1', SELF_JID, 'אשלח לקבוצה את הקובץ מחר', ts)
    expect((await scanGroupCommitments(getTestDb())).commitments).toBe(1)
    expect((await scanGroupCommitments(getTestDb())).commitments).toBe(0)

    await seedMessage('m2', SELF_JID, 'אטפל בזה בעצמי', ts + 1000)
    expect((await scanGroupCommitments(getTestDb())).commitments).toBe(1)
    expect(await getTestDb().select().from(commitments)).toHaveLength(2)
  })
})

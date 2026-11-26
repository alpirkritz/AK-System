/** docs/specs/local-chat-cache-ingest.md — server side of the Slack desktop-cache bridge. */
import { beforeEach, describe, expect, it } from 'vitest'
import { commitments, people, personExternalIds, slackChannels, slackMessages, userSettings } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { ingestSlackCache, type SlackCachePayload } from './slack-cache-ingest'
import type { ConversationLine, MessageClassifier } from './whatsapp-dm'

const NOW = new Date().toISOString()
const T0 = Date.now() / 1000 - 3600 // an hour ago, inside the first-scan window

const ts = (offsetSec: number) => (T0 + offsetSec).toFixed(6)

function payload(over: Partial<SlackCachePayload> = {}): SlackCachePayload {
  return {
    teamId: 'E1',
    selfUserId: 'USELF',
    members: [
      { userId: 'USELF', realName: 'Alpir Kritzler', displayName: 'Alpir', email: 'alpir@x.com', title: null, isSelf: true },
      { userId: 'UDANA', realName: 'Dana Levi', displayName: 'Dana', email: 'dana@x.com', title: 'PM', isSelf: false },
      { userId: 'UNEW', realName: 'Stranger Danger', displayName: null, email: 'stranger@x.com', title: null, isSelf: false },
    ],
    conversations: [
      { channelId: 'D1', kind: 'dm', name: 'Dana Levi', isPrivate: true, memberIds: ['UDANA'], memberNames: ['Dana Levi'] },
      { channelId: 'C1', kind: 'channel', name: 'ops', isPrivate: false, memberIds: [], memberNames: [] },
      { channelId: 'C2', kind: 'channel', name: 'random', isPrivate: false, memberIds: [], memberNames: [] },
    ],
    messages: [
      { channelId: 'D1', slackTs: ts(1), userId: 'UDANA', text: 'תוכל לשלוח את הדוח?', threadTs: null },
      { channelId: 'D1', slackTs: ts(2), userId: 'USELF', text: 'כן, אשלח מחר', threadTs: null },
      { channelId: 'C1', slackTs: ts(3), userId: 'UNEW', text: '@Alpir Kritzler אפשר לאשר את התקציב?', threadTs: null },
      { channelId: 'C2', slackTs: ts(4), userId: 'UNEW', text: 'lunch?', threadTs: null },
    ],
    ...over,
  }
}

/** Fake classifier: one commitment per line whose text the test names. */
function classifierFor(rules: { text: string; owner: 'me' | 'them'; content: string }[], seen: ConversationLine[][] = []): MessageClassifier {
  return async (lines) => {
    seen.push(lines)
    return rules.flatMap((r) => {
      const line = lines.find((l) => l.citable !== false && l.text === r.text)
      return line ? [{ messageId: line.id, owner: r.owner, content: r.content, due: null, because: null }] : []
    })
  }
}

beforeEach(async () => {
  await resetDb()
  // user_settings survives resetDb; the scan cursor must start fresh per test.
  await getTestDb().update(userSettings).set({ slackCommitmentScanCursor: null })
  await getTestDb().insert(people).values({ id: 'p_dana', name: 'Dana Levi', email: 'dana@x.com', status: 'confirmed', source: 'manual', createdAt: NOW })
})

describe('ingestSlackCache', () => {
  it('auto-links by email, enables DMs and only channels Alpir is active in, and stores their messages', async () => {
    const db = getTestDb()
    const r = await ingestSlackCache(db, payload(), { classify: classifierFor([]) })
    expect(r.linked).toBe(1)
    const [link] = await db.select().from(personExternalIds).where(eq(personExternalIds.externalId, 'UDANA'))
    expect(link).toMatchObject({ personId: 'p_dana', provider: 'slack', accountKey: 'E1' })

    const channels = await db.select().from(slackChannels)
    const enabled = Object.fromEntries(channels.map((c) => [c.channelId, !!c.enabled]))
    expect(enabled).toEqual({ D1: true, C1: true, C2: false }) // C1: Alpir was @-mentioned
    expect(channels.find((c) => c.channelId === 'D1')?.kind).toBe('dm')

    const msgs = await db.select().from(slackMessages)
    expect(msgs.map((m) => m.channelId).sort()).toEqual(['C1', 'D1', 'D1'])
    expect(r.stored).toBe(3)
  })

  it('keeps the user toggle on later runs', async () => {
    const db = getTestDb()
    await ingestSlackCache(db, payload(), { classify: classifierFor([]) })
    await (await createTestCaller()).slack.updateChannel({ channelId: 'D1', enabled: false })
    await ingestSlackCache(db, payload({ messages: [] }), { classify: classifierFor([]) })
    const [d1] = await db.select().from(slackChannels).where(eq(slackChannels.channelId, 'D1'))
    expect(!!d1.enabled).toBe(false)
  })

  it('labels my own lines "אני" and attributes my promise in a DM to the counterpart', async () => {
    const db = getTestDb()
    const seen: ConversationLine[][] = []
    await ingestSlackCache(db, payload(), {
      classify: classifierFor([{ text: 'כן, אשלח מחר', owner: 'me', content: 'לשלוח לדנה את הדוח' }], seen),
    })
    expect(seen.flat().find((l) => l.text === 'כן, אשלח מחר')?.speakerLabel).toBe('אני')
    const [c] = await db.select().from(commitments)
    expect(c).toMatchObject({ personId: 'p_dana', owner: 'me', source: 'slack_channel', sourceChatName: 'Slack · Dana Levi' })
  })

  it('a channel request goes to its sender; an unknown sender waits and moves once linked', async () => {
    const db = getTestDb()
    await ingestSlackCache(db, payload(), {
      classify: classifierFor([{ text: '@Alpir Kritzler אפשר לאשר את התקציב?', owner: 'me', content: 'לאשר תקציב' }]),
    })
    const [c] = await db.select().from(commitments)
    expect(c).toMatchObject({ personId: null, senderJid: 'UNEW', owner: 'me', sourceChatName: 'Slack · #ops' })

    const caller = await createTestCaller()
    expect((await caller.slack.listMembers({ linked: false })).map((m) => m.userId)).toEqual(['UNEW'])
    const { personId } = await caller.slack.createPersonFromMember({ slackUserId: 'UNEW' })
    const [after] = await db.select().from(commitments)
    expect(after.personId).toBe(personId)
    const [person] = await db.select().from(people).where(eq(people.id, personId))
    expect(person).toMatchObject({ name: 'Stranger Danger', email: 'stranger@x.com' })
    expect(await caller.slack.listMembers({ linked: false })).toEqual([])
  })

  it('linking an unknown Slack sender from התחייבויות uses the Slack identity', async () => {
    const db = getTestDb()
    await ingestSlackCache(db, payload(), {
      classify: classifierFor([{ text: '@Alpir Kritzler אפשר לאשר את התקציב?', owner: 'me', content: 'לאשר תקציב' }]),
    })
    const [c] = await db.select().from(commitments)
    await (await createTestCaller()).commitments.linkUnknownContact({ commitmentId: c.id, personId: 'p_dana' })
    const [link] = await db.select().from(personExternalIds).where(eq(personExternalIds.externalId, 'UNEW'))
    expect(link?.personId).toBe('p_dana')
  })
})

describe('ingestSlackCache dedupe', () => {
  it('a rescan that rephrases the same message does not add a second commitment', async () => {
    const db = getTestDb()
    const rule = { text: 'תוכל לשלוח את הדוח?', owner: 'me' as const }
    await ingestSlackCache(db, payload(), { classify: classifierFor([{ ...rule, content: 'לשלוח לדנה את הדוח' }]) })
    await db.update(userSettings).set({ slackCommitmentScanCursor: null })
    await ingestSlackCache(db, payload(), { classify: classifierFor([{ ...rule, content: 'לשלוח את הדוח לדנה' }]) })
    expect(await db.select().from(commitments)).toHaveLength(1)
  })
})

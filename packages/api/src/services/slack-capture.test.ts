/** docs/specs/slack-capture-indicator.md */
import { beforeEach, describe, expect, it } from 'vitest'
import { people, personExternalIds, slackMembers } from '@ak-system/database'
import { getTestDb, resetDb } from '../test-utils'
import { ingestSlackCache, type SlackCachePayload } from './slack-cache-ingest'
import { slackBridgeStatus, slackCaptureForPerson } from './slack-capture'

const NOW = Date.now()
const T0 = NOW / 1000 - 3600
const ts = (o: number) => (T0 + o).toFixed(6)

function payload(): SlackCachePayload {
  return {
    teamId: 'E1',
    selfUserId: 'USELF',
    members: [
      { userId: 'USELF', realName: 'Alpir K', displayName: 'Alpir', email: 'a@x.com', title: null, isSelf: true },
      { userId: 'UDAVID', realName: 'David Kotin', displayName: 'David', email: 'david@x.com', title: null, isSelf: false },
    ],
    conversations: [
      { channelId: 'D1', kind: 'dm', name: 'David Kotin', isPrivate: true, memberIds: ['UDAVID'], memberNames: ['David Kotin'] },
      { channelId: 'C1', kind: 'channel', name: 'ops', isPrivate: false, memberIds: [], memberNames: [] },
    ],
    messages: [
      { channelId: 'D1', slackTs: ts(1), userId: 'UDAVID', text: 'hi', threadTs: null },
      { channelId: 'D1', slackTs: ts(2), userId: 'USELF', text: 'hello', threadTs: null },
      { channelId: 'C1', slackTs: ts(3), userId: 'UDAVID', text: 'ops msg', threadTs: null },
      { channelId: 'C1', slackTs: ts(4), userId: 'USELF', text: 'not his', threadTs: null },
    ],
  }
}

beforeEach(async () => {
  await resetDb()
})

async function seedPerson(link: boolean) {
  const db = getTestDb()
  await db.insert(people).values({ id: 'p1', name: 'David Kotin', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() } as never)
  if (link) {
    await db.insert(personExternalIds).values({
      id: 'x1', personId: 'p1', provider: 'slack', externalId: 'UDAVID', accountKey: 'E1', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
    } as never)
  }
  return db
}

describe('slackCaptureForPerson', () => {
  it('is inactive before any Slack data', async () => {
    const db = await seedPerson(false)
    expect(await slackCaptureForPerson(db, 'p1')).toMatchObject({ active: false, linked: false, count: 0 })
  })

  it('reports not linked when the member is not linked to the person', async () => {
    const db = await seedPerson(false)
    await ingestSlackCache(db, { ...payload(), members: payload().members.map((m) => m) }, { scan: false })
    await db.delete(personExternalIds)
    expect(await slackCaptureForPerson(db, 'p1')).toMatchObject({ active: true, linked: false })
  })

  it('counts DMs in both directions plus his own channel messages', async () => {
    const db = await seedPerson(true)
    await ingestSlackCache(db, payload(), { scan: false })
    const r = await slackCaptureForPerson(db, 'p1')
    expect(r).toMatchObject({ active: true, linked: true, dmCount: 2, otherCount: 1, count: 3 })
    expect(r.lastMessageAt).toBeGreaterThan(0)
  })

  it('ignores messages older than the window', async () => {
    const db = await seedPerson(true)
    await ingestSlackCache(db, payload(), { scan: false })
    const r = await slackCaptureForPerson(db, 'p1', NOW + 40 * 86_400_000)
    expect(r).toMatchObject({ linked: true, count: 0, lastMessageAt: null })
  })
})

describe('slackBridgeStatus', () => {
  it('heartbeat moves without new messages and goes stale after an hour', async () => {
    const db = await seedPerson(true)
    expect((await slackBridgeStatus(db)).active).toBe(false)
    await ingestSlackCache(db, { ...payload(), messages: [] }, { scan: false })
    const fresh = await slackBridgeStatus(db)
    expect(fresh).toMatchObject({ active: true, stale: false, messagesLast24h: 0 })
    const later = await slackBridgeStatus(db, NOW + 2 * 3_600_000)
    expect(later.stale).toBe(true)
    expect(await db.select().from(slackMembers)).toHaveLength(2)
  })
})

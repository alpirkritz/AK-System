import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  slackChannels,
  slackConnections,
  slackMessages,
} from '@ak-system/database'
import { getTestDb, resetDb } from '../test-utils'
import {
  verifySlackSignature,
  ingestSlackMessage,
  markSlackMessageEdited,
  markSlackMessageDeleted,
  detectFomoChannels,
  slackTsToMs,
} from './slack'
import * as crypto from 'crypto'
import { eq } from 'drizzle-orm'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSignature(secret: string, timestamp: string, body: string): string {
  const sig = crypto.createHmac('sha256', secret).update(`v0:${timestamp}:${body}`).digest('hex')
  return `v0=${sig}`
}

async function seedConnection(db: ReturnType<typeof getTestDb>) {
  const now = new Date().toISOString()
  await db.insert(slackConnections).values({
    id: 'slack_T123',
    teamId: 'T123',
    teamName: 'Test Team',
    botToken: 'xoxb-test',
    botUserId: 'U_bot',
    scopes: 'channels:read,channels:history',
    installedAt: now,
    updatedAt: now,
  })
}

async function seedChannel(db: ReturnType<typeof getTestDb>, opts?: { enabled?: boolean; fomoEnabled?: boolean; fomoThreshold?: number }) {
  const now = new Date().toISOString()
  await db.insert(slackChannels).values({
    id: 'sc_T123_C001',
    teamId: 'T123',
    channelId: 'C001',
    name: 'general',
    isPrivate: 0,
    enabled: opts?.enabled !== false ? 1 : 0,
    fomoEnabled: opts?.fomoEnabled ? 1 : 0,
    fomoThreshold: opts?.fomoThreshold ?? 5,
    fomoWindowMinutes: 5,
    keywords: '[]',
    updatedAt: now,
  })
}

// ─── verifySlackSignature ─────────────────────────────────────────────────────

describe('verifySlackSignature', () => {
  const secret = 'test-signing-secret'
  const body = '{"type":"url_verification"}'
  const timestamp = String(Math.floor(Date.now() / 1000))

  it('returns true for a valid signature', () => {
    const sig = makeSignature(secret, timestamp, body)
    expect(verifySlackSignature(secret, body, timestamp, sig)).toBe(true)
  })

  it('returns false for an invalid signature', () => {
    expect(verifySlackSignature(secret, body, timestamp, 'v0=bad')).toBe(false)
  })

  it('rejects timestamps older than 5 minutes', () => {
    const old = String(Math.floor(Date.now() / 1000) - 400)
    const sig = makeSignature(secret, old, body)
    expect(verifySlackSignature(secret, body, old, sig)).toBe(false)
  })
})

// ─── slackTsToMs ─────────────────────────────────────────────────────────────

describe('slackTsToMs', () => {
  it('converts Slack ts to epoch ms', () => {
    expect(slackTsToMs('1700000000.123456')).toBe(1700000000123)
  })
})

// ─── ingestSlackMessage ───────────────────────────────────────────────────────

describe('ingestSlackMessage', () => {
  let db: ReturnType<typeof getTestDb>
  beforeEach(async () => {
    db = getTestDb()
    await resetDb()
    await seedConnection(db)
  })

  it('skips a message from a disabled channel', async () => {
    await seedChannel(db, { enabled: false })
    const result = await ingestSlackMessage(
      db,
      { type: 'message', channel: 'C001', user: 'U001', text: 'hello', ts: '1700000001.000000' },
      'T123',
    )
    expect(result.stored).toBe(false)
    expect(result.skipped).toBe('channel not enabled')
  })

  it('stores a new message in an enabled channel', async () => {
    await seedChannel(db)
    const result = await ingestSlackMessage(
      db,
      { type: 'message', channel: 'C001', user: 'U001', username: 'alice', text: 'hello', ts: '1700000002.000000' },
      'T123',
    )
    expect(result.stored).toBe(true)
    const rows = await db.select().from(slackMessages).where(eq(slackMessages.channelId, 'C001'))
    expect(rows).toHaveLength(1)
    expect(rows[0].text).toBe('hello')
  })

  it('deduplicates on re-ingest of the same slack_ts', async () => {
    await seedChannel(db)
    const event = { type: 'message', channel: 'C001', user: 'U001', text: 'hello', ts: '1700000003.000000' }
    await ingestSlackMessage(db, event, 'T123')
    await ingestSlackMessage(db, event, 'T123')
    const rows = await db.select().from(slackMessages).where(eq(slackMessages.channelId, 'C001'))
    expect(rows).toHaveLength(1)
  })

  it('skips bot messages', async () => {
    await seedChannel(db)
    const result = await ingestSlackMessage(
      db,
      { type: 'message', channel: 'C001', user: undefined, subtype: 'bot_message', text: 'bot says hi', ts: '1700000004.000000' },
      'T123',
    )
    expect(result.stored).toBe(false)
  })
})

// ─── markSlackMessageEdited / markSlackMessageDeleted ──────────────────────────

describe('edit and delete', () => {
  let db: ReturnType<typeof getTestDb>
  beforeEach(async () => {
    db = getTestDb()
    await resetDb()
    await seedConnection(db)
    await seedChannel(db)
    await ingestSlackMessage(
      db,
      { type: 'message', channel: 'C001', user: 'U001', text: 'original', ts: '1700000010.000000' },
      'T123',
    )
  })

  it('updates text on edit', async () => {
    await markSlackMessageEdited(db, 'C001', '1700000010.000000', 'edited', '1700000011.000000')
    const [row] = await db.select().from(slackMessages).where(eq(slackMessages.channelId, 'C001'))
    expect(row.text).toBe('edited')
    expect(row.editedTs).toBe('1700000011.000000')
  })

  it('marks message as deleted', async () => {
    await markSlackMessageDeleted(db, 'C001', '1700000010.000000')
    const [row] = await db.select().from(slackMessages).where(eq(slackMessages.channelId, 'C001'))
    // SQLite returns 0/1 for boolean columns
    expect(row.deleted === true || row.deleted === 1).toBe(true)
  })
})

// ─── detectFomoChannels ───────────────────────────────────────────────────────

describe('detectFomoChannels', () => {
  let db: ReturnType<typeof getTestDb>
  beforeEach(async () => {
    db = getTestDb()
    await resetDb()
    await seedConnection(db)
    await seedChannel(db, { fomoEnabled: true, fomoThreshold: 3 })
  })

  it('returns nothing when there are fewer messages than the threshold', async () => {
    const now = Date.now()
    for (let i = 0; i < 2; i++) {
      await db.insert(slackMessages).values({
        id: `sm_C001_170000002${i}_000000`,
        teamId: 'T123',
        channelId: 'C001',
        slackTs: `170000002${i}.000000`,
        userId: 'U001',
        userName: 'alice',
        text: `msg ${i}`,
        threadTs: null,
        ts: now - 60000 + i * 1000,
        editedTs: null,
        deleted: false,
        createdAt: new Date().toISOString(),
      })
    }
    const result = await detectFomoChannels(db)
    expect(result).toHaveLength(0)
  })

  it('returns the channel when messages exceed the threshold in the window', async () => {
    const now = Date.now()
    for (let i = 0; i < 5; i++) {
      await db.insert(slackMessages).values({
        id: `sm_C001_fomo_${i}`,
        teamId: 'T123',
        channelId: 'C001',
        slackTs: `1700000030.00000${i}`,
        userId: 'U001',
        userName: 'alice',
        text: `burst ${i}`,
        threadTs: null,
        ts: now - 30000 + i * 1000,
        editedTs: null,
        deleted: false,
        createdAt: new Date().toISOString(),
      })
    }
    const result = await detectFomoChannels(db)
    expect(result).toHaveLength(1)
    expect(result[0].channelId).toBe('C001')
    expect(result[0].count).toBe(5)
  })
})

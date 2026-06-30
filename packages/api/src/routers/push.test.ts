import { describe, it, expect, beforeEach } from 'vitest'
import { getDb, pushSubscriptions, expoPushTokens } from '@ak-system/database'
import { appRouter } from '../index'
import { createContext, createCallerFactory } from '../trpc'
import { createTestCaller } from '../test-utils'

async function createUnauthCaller() {
  const db = getDb()
  const ctx = await createContext({ db, session: null })
  return createCallerFactory(appRouter)(ctx)
}

describe('push router', () => {
  beforeEach(async () => {
    await getDb().delete(pushSubscriptions)
    await getDb().delete(expoPushTokens)
  })

  it('getVapidPublicKey returns a string', async () => {
    const caller = await createTestCaller()
    const key = await caller.push.getVapidPublicKey()
    expect(typeof key).toBe('string')
  })

  it('subscribe inserts a subscription', async () => {
    const caller = await createTestCaller()
    const res = await caller.push.subscribe({
      endpoint: 'https://push.example.com/abc',
      keys: { p256dh: 'p', auth: 'a' },
    })
    expect(res.id).toBeDefined()

    const rows = await getDb().select().from(pushSubscriptions).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].endpoint).toBe('https://push.example.com/abc')
  })

  it('subscribe upserts (idempotent) for the same endpoint', async () => {
    const caller = await createTestCaller()
    const first = await caller.push.subscribe({
      endpoint: 'https://push.example.com/dup',
      keys: { p256dh: 'p1', auth: 'a1' },
    })
    const second = await caller.push.subscribe({
      endpoint: 'https://push.example.com/dup',
      keys: { p256dh: 'p2', auth: 'a2' },
    })
    expect(second.id).toBe(first.id)

    const rows = await getDb().select().from(pushSubscriptions).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].p256dh).toBe('p2')
  })

  it('unsubscribe removes the subscription', async () => {
    const caller = await createTestCaller()
    await caller.push.subscribe({
      endpoint: 'https://push.example.com/del',
      keys: { p256dh: 'p', auth: 'a' },
    })
    const res = await caller.push.unsubscribe({ endpoint: 'https://push.example.com/del' })
    expect(res.ok).toBe(true)

    const rows = await getDb().select().from(pushSubscriptions).all()
    expect(rows).toHaveLength(0)
  })

  it('subscribe rejects an invalid endpoint (zod)', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.push.subscribe({ endpoint: 'not-a-url', keys: { p256dh: 'p', auth: 'a' } }),
    ).rejects.toThrow()
  })

  it('subscribe requires auth', async () => {
    const caller = await createUnauthCaller()
    await expect(
      caller.push.subscribe({
        endpoint: 'https://push.example.com/x',
        keys: { p256dh: 'p', auth: 'a' },
      }),
    ).rejects.toThrow()
  })

  it('sendToAll throws when VAPID keys are not configured', async () => {
    // Only meaningful when the test env has no VAPID keys (the default).
    if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) return
    const caller = await createTestCaller()
    await expect(caller.push.sendToAll({ title: 't', body: 'b' })).rejects.toThrow()
  })

  it('registerExpoToken inserts a token', async () => {
    const caller = await createTestCaller()
    const res = await caller.push.registerExpoToken({ token: 'ExponentPushToken[abc]' })
    expect(res.id).toBeDefined()

    const rows = await getDb().select().from(expoPushTokens).all()
    expect(rows).toHaveLength(1)
    expect(rows[0].token).toBe('ExponentPushToken[abc]')
  })

  it('registerExpoToken is idempotent', async () => {
    const caller = await createTestCaller()
    const first = await caller.push.registerExpoToken({ token: 'ExponentPushToken[dup]' })
    const second = await caller.push.registerExpoToken({ token: 'ExponentPushToken[dup]' })
    expect(second.id).toBe(first.id)

    const rows = await getDb().select().from(expoPushTokens).all()
    expect(rows).toHaveLength(1)
  })

  it('unregisterExpoToken removes the token', async () => {
    const caller = await createTestCaller()
    await caller.push.registerExpoToken({ token: 'ExponentPushToken[del]' })
    const res = await caller.push.unregisterExpoToken({ token: 'ExponentPushToken[del]' })
    expect(res.ok).toBe(true)

    const rows = await getDb().select().from(expoPushTokens).all()
    expect(rows).toHaveLength(0)
  })

  it('registerExpoToken requires auth', async () => {
    const caller = await createUnauthCaller()
    await expect(caller.push.registerExpoToken({ token: 'ExponentPushToken[x]' })).rejects.toThrow()
  })
})

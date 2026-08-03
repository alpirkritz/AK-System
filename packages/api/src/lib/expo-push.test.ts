import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { getDb, expoPushTokens } from '@ak-system/database'
import { sendExpoPush } from './expo-push'

async function seedToken(token: string): Promise<void> {
  await getDb()
    .insert(expoPushTokens)
    .values({ id: crypto.randomUUID(), token, createdAt: new Date().toISOString() })
    .run()
}

describe('sendExpoPush', () => {
  beforeEach(async () => {
    await getDb().delete(expoPushTokens)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('returns 0 and never calls the Expo API when no devices are registered', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)

    const sent = await sendExpoPush('Title', 'Body')

    expect(sent).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends to every registered token and counts only "ok" tickets', async () => {
    await seedToken('ExponentPushToken[a]')
    await seedToken('ExponentPushToken[b]')
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [{ status: 'ok' }, { status: 'ok' }],
      }),
    })
    vi.stubGlobal('fetch', fetchSpy)

    const sent = await sendExpoPush('Title', 'Body', '/chat')

    expect(sent).toBe(2)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://exp.host/--/api/v2/push/send')
    const body = JSON.parse(options.body as string) as Array<{ to: string; title: string }>
    expect(body).toHaveLength(2)
    expect(body[0]?.title).toBe('Title')
  })

  it('prunes tokens that Expo reports as DeviceNotRegistered', async () => {
    await seedToken('ExponentPushToken[stale]')
    await seedToken('ExponentPushToken[fresh]')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [
            { status: 'error', details: { error: 'DeviceNotRegistered' } },
            { status: 'ok' },
          ],
        }),
      }),
    )

    const sent = await sendExpoPush('Title', 'Body')

    expect(sent).toBe(1)
    const rows = await getDb().select().from(expoPushTokens).all()
    expect(rows).toHaveLength(1)
    expect(rows[0]?.token).toBe('ExponentPushToken[fresh]')
  })

  it('keeps the token on transient ticket errors (does not prune)', async () => {
    await seedToken('ExponentPushToken[flaky]')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          data: [{ status: 'error', details: { error: 'MessageRateExceeded' } }],
        }),
      }),
    )

    const sent = await sendExpoPush('Title', 'Body')

    expect(sent).toBe(0)
    const rows = await getDb().select().from(expoPushTokens).all()
    expect(rows).toHaveLength(1)
  })

  it('returns 0 without throwing when the Expo API responds non-OK', async () => {
    await seedToken('ExponentPushToken[x]')
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'upstream error',
      }),
    )

    const sent = await sendExpoPush('Title', 'Body')

    expect(sent).toBe(0)
  })

  it('returns 0 without throwing when the network call rejects (e.g. dead tunnel URL)', async () => {
    await seedToken('ExponentPushToken[x]')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')))

    await expect(sendExpoPush('Title', 'Body')).resolves.toBe(0)
  })
})

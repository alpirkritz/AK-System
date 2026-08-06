import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getDb,
  fcmPushTokens,
  pushDeliveryLog,
  notifications,
  queryRows,
} from '@ak-system/database'

const sendEachForMulticast = vi.fn()
const firebaseApps: { name: string }[] = []

// Mirrors firebase-admin v13+, which only exposes the modular entry points.
vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn((_options: unknown, name: string) => {
    const app = { name }
    firebaseApps.push(app)
    return app
  }),
  getApps: vi.fn(() => firebaseApps),
  getApp: vi.fn((name: string) => firebaseApps.find((a) => a.name === name)),
  cert: vi.fn(() => ({})),
}))

vi.mock('firebase-admin/messaging', () => ({
  getMessaging: vi.fn(() => ({ sendEachForMulticast })),
}))

import { sendMobilePush, resetFirebaseAdminForTests } from './mobile-push'

async function seedToken(token: string): Promise<void> {
  const now = new Date().toISOString()
  await getDb()
    .insert(fcmPushTokens)
    .values({
      id: crypto.randomUUID(),
      token,
      platform: 'android',
      createdAt: now,
      updatedAt: now,
    })
    .run()
}

describe('sendMobilePush', () => {
  const prevEnv = { ...process.env }

  beforeEach(async () => {
    resetFirebaseAdminForTests()
    firebaseApps.length = 0
    sendEachForMulticast.mockReset()
    await getDb().delete(fcmPushTokens)
    await getDb().delete(pushDeliveryLog)
    await getDb().delete(notifications)
    process.env.FIREBASE_PROJECT_ID = 'helm-push-test'
    process.env.FIREBASE_CLIENT_EMAIL = 'sa@test.iam.gserviceaccount.com'
    process.env.FIREBASE_PRIVATE_KEY =
      '-----BEGIN PRIVATE KEY-----\\nABC\\n-----END PRIVATE KEY-----\\n'
  })

  afterEach(() => {
    process.env = { ...prevEnv }
    resetFirebaseAdminForTests()
    firebaseApps.length = 0
  })

  it('returns 0 and never calls FCM when no devices are registered', async () => {
    const sent = await sendMobilePush('Title', 'Body')
    expect(sent).toBe(0)
    expect(sendEachForMulticast).not.toHaveBeenCalled()
  })

  it('sends multicast with title, body, data.url, channel, and high priority', async () => {
    await seedToken('fcm-token-a')
    await seedToken('fcm-token-b')
    sendEachForMulticast.mockResolvedValue({
      successCount: 2,
      failureCount: 0,
      responses: [
        { success: true, messageId: 'm1' },
        { success: true, messageId: 'm2' },
      ],
    })

    const sent = await sendMobilePush('Title', 'Body', '/chat')

    expect(sent).toBe(2)
    expect(sendEachForMulticast).toHaveBeenCalledTimes(1)
    const payload = sendEachForMulticast.mock.calls[0]?.[0] as {
      tokens: string[]
      notification: { title: string; body: string }
      data: { url: string }
      android: { priority: string; notification: { channelId: string; sound: string } }
    }
    expect(payload.tokens).toEqual(['fcm-token-a', 'fcm-token-b'])
    expect(payload.notification).toEqual({ title: 'Title', body: 'Body' })
    expect(payload.data).toEqual({ url: '/chat' })
    expect(payload.android.priority).toBe('high')
    expect(payload.android.notification.channelId).toBe('default')

    const logs = await queryRows<{
      status: string
      provider: string
      providerMessageId: string | null
    }>(getDb().select().from(pushDeliveryLog))
    expect(logs).toHaveLength(2)
    expect(logs.every((l) => l.status === 'ok' && l.provider === 'fcm')).toBe(true)
    expect(logs.map((l) => l.providerMessageId).sort()).toEqual(['m1', 'm2'])
  })

  it('counts only successful responses and prunes dead tokens', async () => {
    await seedToken('dead-token')
    await seedToken('live-token')
    sendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 1,
      responses: [
        {
          success: false,
          error: {
            code: 'messaging/registration-token-not-registered',
            message: 'Requested entity was not found.',
          },
        },
        { success: true, messageId: 'ok-1' },
      ],
    })

    const sent = await sendMobilePush('Title', 'Body')
    expect(sent).toBe(1)

    const tokens = await getDb().select().from(fcmPushTokens).all()
    expect(tokens.map((t) => t.token)).toEqual(['live-token'])

    const logs = await queryRows<{ status: string; errorCode: string | null }>(
      getDb().select().from(pushDeliveryLog),
    )
    expect(logs.some((l) => l.status === 'error' && l.errorCode?.includes('not-registered'))).toBe(
      true,
    )
    expect(logs.some((l) => l.status === 'ok')).toBe(true)
  })

  it('returns 0 and logs MissingCredentials when Firebase env is absent', async () => {
    delete process.env.FIREBASE_PROJECT_ID
    delete process.env.FIREBASE_CLIENT_EMAIL
    delete process.env.FIREBASE_PRIVATE_KEY
    resetFirebaseAdminForTests()
    firebaseApps.length = 0
    await seedToken('orphan-token')

    const sent = await sendMobilePush('Title', 'Body')
    expect(sent).toBe(0)
    expect(sendEachForMulticast).not.toHaveBeenCalled()

    const logs = await queryRows<{ status: string; errorCode: string | null }>(
      getDb().select().from(pushDeliveryLog),
    )
    expect(logs).toHaveLength(1)
    expect(logs[0]?.status).toBe('error')
    expect(logs[0]?.errorCode).toBe('MissingCredentials')
  })

  it('truncates long bodies to 240 chars in the FCM payload', async () => {
    await seedToken('t1')
    sendEachForMulticast.mockResolvedValue({
      successCount: 1,
      failureCount: 0,
      responses: [{ success: true, messageId: 'm' }],
    })
    const long = 'x'.repeat(300)
    await sendMobilePush('T', long)
    const payload = sendEachForMulticast.mock.calls[0]?.[0] as {
      notification: { body: string }
    }
    expect(payload.notification.body.length).toBe(240)
  })
})

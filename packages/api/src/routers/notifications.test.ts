import { describe, it, expect, beforeEach } from 'vitest'
import { getDb, notifications, runMutation } from '@ak-system/database'
import { createTestCaller, getTestDb } from '../test-utils'

async function seedNotification(
  title: string,
  type: string,
): Promise<string> {
  const id = crypto.randomUUID()
  const db = getTestDb()
  await runMutation(
    db.insert(notifications).values({
      id,
      title,
      body: 'body',
      url: '/chat',
      type,
      readAt: null,
      createdAt: new Date().toISOString(),
    }),
  )
  return id
}

describe('notifications router', () => {
  beforeEach(async () => {
    await getDb().delete(notifications)
  })

  it('list returns notifications newest first', async () => {
    await seedNotification('First', 'cron')
    await new Promise((r) => setTimeout(r, 5))
    await seedNotification('Second', 'hugo')

    const caller = await createTestCaller()
    const rows = await caller.notifications.list({ limit: 10 })
    expect(rows.length).toBeGreaterThanOrEqual(2)
    expect(rows[0]?.title).toBe('Second')
  })

  it('unreadCount returns unread only', async () => {
    await seedNotification('A', 'system')
    await seedNotification('B', 'system')

    const caller = await createTestCaller()
    expect((await caller.notifications.unreadCount()).count).toBe(2)
  })

  it('markRead marks single notification', async () => {
    const id = await seedNotification('One', 'agent')

    const caller = await createTestCaller()
    const res = await caller.notifications.markRead({ id })
    expect(res.updated).toBe(1)
    expect((await caller.notifications.unreadCount()).count).toBe(0)
  })

  it('markRead all clears unread', async () => {
    await seedNotification('A', 'cron')
    await seedNotification('B', 'cron')

    const caller = await createTestCaller()
    const res = await caller.notifications.markRead({ all: true })
    expect(res.updated).toBe(2)
    expect((await caller.notifications.unreadCount()).count).toBe(0)
  })
})

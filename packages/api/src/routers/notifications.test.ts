import { describe, it, expect, beforeEach } from 'vitest'
import { getDb, notifications, runMutation } from '@ak-system/database'
import { createTestCaller, getTestDb } from '../test-utils'

async function seedNotification(
  title: string,
  type: string,
  extras?: { readAt?: string | null; archivedAt?: string | null; url?: string },
): Promise<string> {
  const id = crypto.randomUUID()
  const db = getTestDb()
  await runMutation(
    db.insert(notifications).values({
      id,
      title,
      body: 'body',
      url: extras?.url ?? '/chat',
      type,
      readAt: extras?.readAt ?? null,
      archivedAt: extras?.archivedAt ?? null,
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

  it('list excludes archived by default', async () => {
    await seedNotification('Visible', 'system')
    await seedNotification('Hidden', 'system', {
      archivedAt: new Date().toISOString(),
    })

    const caller = await createTestCaller()
    const rows = await caller.notifications.list({ limit: 50 })
    expect(rows.map((r) => r.title)).toEqual(['Visible'])
  })

  it('list includeArchived returns archived rows', async () => {
    await seedNotification('Visible', 'system')
    await seedNotification('Hidden', 'system', {
      archivedAt: new Date().toISOString(),
    })

    const caller = await createTestCaller()
    const rows = await caller.notifications.list({ limit: 50, includeArchived: true })
    expect(rows.length).toBe(2)
  })

  it('unreadCount returns unread non-archived only', async () => {
    await seedNotification('A', 'system')
    await seedNotification('B', 'system')
    await seedNotification('Archived unread', 'system', {
      archivedAt: new Date().toISOString(),
    })

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

  it('markRead all clears unread non-archived', async () => {
    await seedNotification('A', 'cron')
    await seedNotification('B', 'cron')
    await seedNotification('Archived', 'cron', {
      archivedAt: new Date().toISOString(),
    })

    const caller = await createTestCaller()
    const res = await caller.notifications.markRead({ all: true })
    expect(res.updated).toBe(2)
    expect((await caller.notifications.unreadCount()).count).toBe(0)
  })

  it('getById returns notification including archived', async () => {
    const id = await seedNotification('Archived', 'hugo', {
      archivedAt: new Date().toISOString(),
    })
    const caller = await createTestCaller()
    const row = await caller.notifications.getById({ id })
    expect(row?.title).toBe('Archived')
    expect(row?.archivedAt).toBeTruthy()
  })

  it('archive and undo', async () => {
    const id = await seedNotification('To archive', 'system')
    const caller = await createTestCaller()

    const archived = await caller.notifications.archive({ id })
    expect(archived.archived).toBe(true)
    expect((await caller.notifications.list({ limit: 10 })).length).toBe(0)

    const undone = await caller.notifications.archive({ id, undo: true })
    expect(undone.archived).toBe(false)
    expect((await caller.notifications.list({ limit: 10 }))[0]?.id).toBe(id)
  })

  it('archiveAll archives every non-archived notification with one shared batch timestamp', async () => {
    const idA = await seedNotification('A', 'system')
    const idB = await seedNotification('B', 'system', { readAt: new Date().toISOString() })
    const alreadyArchivedId = await seedNotification('Already archived', 'system', {
      archivedAt: new Date().toISOString(),
    })

    const caller = await createTestCaller()
    const res = await caller.notifications.archiveAll({})
    expect(res.archived).toBe(true)
    expect(res.updated).toBe(2)
    expect(res.batchAt).toBeTruthy()

    expect((await caller.notifications.list({ limit: 10 })).length).toBe(0)
    expect((await caller.notifications.unreadCount()).count).toBe(0)

    const allRows = await caller.notifications.list({ limit: 10, includeArchived: true })
    const a = allRows.find((r) => r.id === idA)
    const b = allRows.find((r) => r.id === idB)
    expect(a?.archivedAt).toBe(res.batchAt)
    expect(b?.archivedAt).toBe(res.batchAt)
    // pre-existing archived row keeps its own timestamp, untouched by this batch
    const already = allRows.find((r) => r.id === alreadyArchivedId)
    expect(already?.archivedAt).not.toBe(res.batchAt)
  })

  it('archiveAll is a no-op when the inbox is already empty', async () => {
    await seedNotification('Archived', 'system', { archivedAt: new Date().toISOString() })

    const caller = await createTestCaller()
    const res = await caller.notifications.archiveAll({})
    expect(res.updated).toBe(0)
  })

  it('archiveAll undo restores exactly the rows from that batch', async () => {
    const idA = await seedNotification('A', 'system')
    const idB = await seedNotification('B', 'system')

    const caller = await createTestCaller()
    const res = await caller.notifications.archiveAll({})
    expect(res.updated).toBe(2)

    const undone = await caller.notifications.archiveAll({ undo: true, batchAt: res.batchAt })
    expect(undone.archived).toBe(false)
    expect(undone.updated).toBe(2)

    const rows = await caller.notifications.list({ limit: 10 })
    expect(rows.map((r) => r.id).sort()).toEqual([idA, idB].sort())
  })
})

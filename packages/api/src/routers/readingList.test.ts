import { describe, it, expect, beforeEach } from 'vitest'
import { getDb, readingListItems } from '@ak-system/database'
import { createTestCaller } from '../test-utils'

describe('readingList router', () => {
  beforeEach(async () => {
    await getDb().delete(readingListItems)
  })

  it('create stores an unread item and returns it', async () => {
    const caller = await createTestCaller()
    const row = await caller.readingList.create({
      url: 'https://example.com/article',
      title: 'כתבה מעניינת',
      note: 'לקרוא בסוף השבוע',
    })

    expect(row?.id).toBeTruthy()
    expect(row?.url).toBe('https://example.com/article')
    expect(row?.title).toBe('כתבה מעניינת')
    expect(row?.note).toBe('לקרוא בסוף השבוע')
    expect(row?.status).toBe('unread')
    expect(row?.readAt).toBeNull()
  })

  it('create trims input and stores a missing note as null', async () => {
    const caller = await createTestCaller()
    const row = await caller.readingList.create({
      url: '  https://example.com/x  ',
      title: '  כותרת  ',
    })

    expect(row?.url).toBe('https://example.com/x')
    expect(row?.title).toBe('כותרת')
    expect(row?.note).toBeNull()
  })

  it('create rejects a non-http URL', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.readingList.create({ url: 'ftp://example.com/file', title: 'לא תקין' }),
    ).rejects.toThrow()
  })

  it('create rejects an empty title', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.readingList.create({ url: 'https://example.com', title: '' }),
    ).rejects.toThrow()
  })

  it('list returns newest first', async () => {
    const caller = await createTestCaller()
    await caller.readingList.create({ url: 'https://example.com/1', title: 'ראשון' })
    await new Promise((r) => setTimeout(r, 5))
    await caller.readingList.create({ url: 'https://example.com/2', title: 'שני' })

    const rows = await caller.readingList.list({ status: 'all' })
    expect(rows.length).toBe(2)
    expect(rows[0]?.title).toBe('שני')
  })

  it('list filters by status', async () => {
    const caller = await createTestCaller()
    const a = await caller.readingList.create({ url: 'https://example.com/a', title: 'א' })
    await caller.readingList.create({ url: 'https://example.com/b', title: 'ב' })
    await caller.readingList.markRead({ id: a!.id, read: true })

    const unread = await caller.readingList.list({ status: 'unread' })
    expect(unread.map((r) => r.title)).toEqual(['ב'])

    const read = await caller.readingList.list({ status: 'read' })
    expect(read.map((r) => r.title)).toEqual(['א'])

    expect((await caller.readingList.list({ status: 'all' })).length).toBe(2)
  })

  it('list defaults to all when called without input', async () => {
    const caller = await createTestCaller()
    await caller.readingList.create({ url: 'https://example.com/only', title: 'יחיד' })
    expect((await caller.readingList.list()).length).toBe(1)
  })

  it('markRead sets readAt, and clears it when unmarked', async () => {
    const caller = await createTestCaller()
    const created = await caller.readingList.create({
      url: 'https://example.com/toggle',
      title: 'החלפה',
    })

    const read = await caller.readingList.markRead({ id: created!.id, read: true })
    expect(read?.status).toBe('read')
    expect(read?.readAt).toBeTruthy()

    const unread = await caller.readingList.markRead({ id: created!.id, read: false })
    expect(unread?.status).toBe('unread')
    expect(unread?.readAt).toBeNull()
  })

  it('delete removes the item', async () => {
    const caller = await createTestCaller()
    const created = await caller.readingList.create({
      url: 'https://example.com/gone',
      title: 'למחיקה',
    })

    const res = await caller.readingList.delete({ id: created!.id })
    expect(res.success).toBe(true)
    expect((await caller.readingList.list({ status: 'all' })).length).toBe(0)
  })
})

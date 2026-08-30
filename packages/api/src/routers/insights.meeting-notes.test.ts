import { describe, it, expect, beforeEach } from 'vitest'
import { getDb, meetingNotes, meetings } from '@ak-system/database'
import { createTestCaller, resetDb } from '../test-utils'
import { localTodayIso } from '../lib/calendar-dates'

describe('insights.meetingNotes', () => {
  beforeEach(async () => {
    await resetDb()
  })

  async function seedNotes() {
    const db = getDb()
    const now = new Date().toISOString()
    const today = localTodayIso()
    await db.insert(meetings).values({
      id: 'm_today',
      title: 'Standup',
      date: today,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(meetingNotes).values([
      {
        id: 'mn_today',
        title: 'Standup AI notes',
        date: today,
        snippet: 'short',
        bodyText: 'Full standup body with decisions',
        notionUrl: null,
        notionPageId: '3cce7d50-cb8e-809c-8f7c-da639bce5478',
        meetingId: 'm_today',
        source: 'notion',
        sourceKind: 'meeting_page',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'mn_old',
        title: 'Old notes',
        date: '2026-01-01',
        snippet: 'old snippet',
        bodyText: 'Old body',
        notionUrl: null,
        notionPageId: 'np2',
        meetingId: null,
        source: 'notion',
        createdAt: now,
        updatedAt: now,
      },
    ])
    return { today }
  }

  it('filters by date=today and returns bodyText', async () => {
    const { today } = await seedNotes()
    const caller = await createTestCaller()
    const result = await caller.insights.meetingNotes({ date: 'today' })
    expect(result.count).toBe(1)
    expect(result.notes[0]!.date).toBe(today)
    expect(result.notes[0]!.bodyText).toBe('Full standup body with decisions')
    expect(result.notes[0]!.meetingTitle).toBe('Standup')
  })

  it('filters by meetingId', async () => {
    await seedNotes()
    const caller = await createTestCaller()
    const result = await caller.insights.meetingNotes({ meetingId: 'm_today' })
    expect(result.count).toBe(1)
    expect(result.notes[0]!.id).toBe('mn_today')
  })

  it('returns recent notes when unfiltered (capped)', async () => {
    await seedNotes()
    const caller = await createTestCaller()
    const result = await caller.insights.meetingNotes()
    expect(result.count).toBe(2)
    expect(result.notes.map((n) => n.id)).toContain('mn_today')
    expect(result.notes.map((n) => n.id)).toContain('mn_old')
  })

  it('filters by notionPageId / notionUrl and returns sourceKind', async () => {
    await seedNotes()
    const caller = await createTestCaller()
    const byId = await caller.insights.meetingNotes({
      notionPageId: '3cce7d50cb8e809c8f7cda639bce5478',
    })
    expect(byId.count).toBe(1)
    expect(byId.notes[0]!.id).toBe('mn_today')
    expect(byId.notes[0]!.sourceKind).toBe('meeting_page')

    const byUrl = await caller.insights.meetingNotes({
      notionUrl:
        'https://app.notion.com/p/alpir/3cce7d50cb8e809c8f7cda639bce5478#fb2e7d50cb8e82a193b601601b869cae',
    })
    expect(byUrl.count).toBe(1)
    expect(byUrl.notes[0]!.bodyText).toBe('Full standup body with decisions')
  })
})

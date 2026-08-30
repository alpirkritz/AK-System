import { describe, it, expect, beforeEach } from 'vitest'
import { getDb, meetingNotes, meetingPeople, meetingNotePeople, meetings, people } from '@ak-system/database'
import { createTestCaller, resetDb } from '../test-utils'
import { localTodayIso, localTomorrowIso } from '../lib/calendar-dates'

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
        sourceKind: 'meeting_page_summary',
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
    expect(byId.notes[0]!.sourceKind).toBe('meeting_page_summary')

    const byUrl = await caller.insights.meetingNotes({
      notionUrl:
        'https://app.notion.com/p/alpir/3cce7d50cb8e809c8f7cda639bce5478#fb2e7d50cb8e82a193b601601b869cae',
    })
    expect(byUrl.count).toBe(1)
    expect(byUrl.notes[0]!.bodyText).toBe('Full standup body with decisions')
  })

  it('filters by query against title', async () => {
    await seedNotes()
    const caller = await createTestCaller()
    const result = await caller.insights.meetingNotes({ query: 'standup' })
    expect(result.count).toBe(1)
    expect(result.notes[0]!.id).toBe('mn_today')
  })

  it('matches query against attendee names', async () => {
    const { today } = await seedNotes()
    const db = getDb()
    const now = new Date().toISOString()
    await db.insert(people).values({
      id: 'p_shani',
      name: 'Shani Asaraf',
      createdAt: now,
    })
    await db.insert(meetingPeople).values({ meetingId: 'm_today', personId: 'p_shani' })
    const caller = await createTestCaller()
    const result = await caller.insights.meetingNotes({ date: today, query: 'shani' })
    expect(result.count).toBe(1)
    expect(result.notes[0]!.id).toBe('mn_today')
  })

  it('matches Hebrew query שני to an English Shani meeting title', async () => {
    const { today } = await seedNotes()
    const db = getDb()
    const now = new Date().toISOString()
    await db.insert(meetings).values({
      id: 'm_shani',
      title: 'Status update with Shani',
      date: today,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(meetingNotes).values({
      id: 'mn_shani',
      title: 'Status update with Shani',
      date: today,
      snippet: 'Action items',
      bodyText: 'Action Items & Next Steps\nMeet with Tinko next week',
      notionUrl: null,
      notionPageId: 'np_shani',
      meetingId: 'm_shani',
      source: 'notion',
      sourceKind: 'meeting_page_summary',
      createdAt: now,
      updatedAt: now,
    })
    const caller = await createTestCaller()
    const result = await caller.insights.meetingNotes({ date: 'today', query: 'שני' })
    expect(result.count).toBe(1)
    expect(result.notes[0]!.id).toBe('mn_shani')
    expect(result.notes[0]!.bodyText).toContain('Action Items')
    expect(result.notes[0]!.bodyText).not.toContain('Legoland')
  })

  it('prepDate tomorrow returns a past Shani note for a 1:1 on that day', async () => {
    const db = getDb()
    const now = new Date().toISOString()
    const tomorrow = localTomorrowIso()
    const [y, m, d] = tomorrow.split('-').map(Number)
    const past = new Date(Date.UTC(y, m - 1, d - 7)).toISOString().slice(0, 10)
    await db.insert(people).values({
      id: 'p_shani',
      name: 'Shani Asaraf',
      createdAt: now,
    })
    await db.insert(meetings).values({
      id: 'm_tom_shani',
      title: 'Shani & Alpir 1:1',
      date: tomorrow,
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(meetingNotes).values({
      id: 'mn_shani_past',
      title: 'Status update with Shani',
      date: past,
      snippet: 'Action items',
      bodyText: 'Push the Tinko meeting next week',
      notionUrl: null,
      notionPageId: 'np_shani_past',
      meetingId: null,
      source: 'notion',
      sourceKind: 'meeting_page_summary',
      createdAt: now,
      updatedAt: now,
    })
    await db.insert(meetingNotePeople).values({ meetingNoteId: 'mn_shani_past', personId: 'p_shani' })

    const caller = await createTestCaller()
    const result = await caller.insights.meetingNotes({ prepDate: 'tomorrow' })
    expect(result.prepFor?.date).toBe(tomorrow)
    expect(result.prepFor?.meetingTitles).toContain('Shani & Alpir 1:1')
    expect(result.notes.map((n) => n.id)).toContain('mn_shani_past')
    expect(result.notes.find((n) => n.id === 'mn_shani_past')?.bodyText).toContain('Tinko')
  })

  it('prepDate keeps notes for every person on that day, not only the first', async () => {
    const db = getDb()
    const now = new Date().toISOString()
    const tomorrow = localTomorrowIso()
    await db.insert(people).values([
      { id: 'p_shani', name: 'Shani Asaraf', createdAt: now },
      { id: 'p_dana', name: 'Dana Cohen', createdAt: now },
    ])
    await db.insert(meetings).values([
      {
        id: 'm_tom_shani',
        title: 'Shani & Alpir 1:1',
        date: tomorrow,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'm_tom_dana',
        title: 'Dana weekly',
        date: tomorrow,
        createdAt: now,
        updatedAt: now,
      },
    ])
    await db.insert(meetingNotes).values([
      {
        id: 'mn_shani_past',
        title: 'Status update with Shani',
        date: '2026-08-20',
        snippet: 'shani',
        bodyText: 'Shani summary',
        notionUrl: null,
        notionPageId: 'np_s',
        meetingId: null,
        source: 'notion',
        sourceKind: 'meeting_page_summary',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'mn_dana_past',
        title: 'Weekly with Dana',
        date: '2026-08-18',
        snippet: 'dana',
        bodyText: 'Dana summary',
        notionUrl: null,
        notionPageId: 'np_d',
        meetingId: null,
        source: 'notion',
        sourceKind: 'meeting_page_summary',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'mn_unrelated',
        title: 'Algo architecture review',
        date: '2026-08-19',
        snippet: 'algo',
        bodyText: 'Unrelated',
        notionUrl: null,
        notionPageId: 'np_u',
        meetingId: null,
        source: 'notion',
        sourceKind: 'meeting_page_summary',
        createdAt: now,
        updatedAt: now,
      },
    ])
    await db.insert(meetingNotePeople).values([
      { meetingNoteId: 'mn_shani_past', personId: 'p_shani' },
      { meetingNoteId: 'mn_dana_past', personId: 'p_dana' },
    ])

    const caller = await createTestCaller()
    const result = await caller.insights.meetingNotes({ prepDate: 'tomorrow' })
    const ids = result.notes.map((n) => n.id)
    expect(ids).toContain('mn_shani_past')
    expect(ids).toContain('mn_dana_past')
    expect(ids).not.toContain('mn_unrelated')
  })

  it('prepDate ignores a leftover person query so other meetings are not dropped', async () => {
    const db = getDb()
    const now = new Date().toISOString()
    const tomorrow = localTomorrowIso()
    await db.insert(people).values([
      { id: 'p_shani', name: 'Shani Asaraf', createdAt: now },
      { id: 'p_dana', name: 'Dana Cohen', createdAt: now },
    ])
    await db.insert(meetings).values([
      {
        id: 'm_tom_shani',
        title: 'Shani & Alpir 1:1',
        date: tomorrow,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'm_tom_dana',
        title: 'Dana weekly',
        date: tomorrow,
        createdAt: now,
        updatedAt: now,
      },
    ])
    await db.insert(meetingNotes).values([
      {
        id: 'mn_shani_past',
        title: 'Status update with Shani',
        date: '2026-08-20',
        snippet: 'shani',
        bodyText: 'Shani summary',
        notionUrl: null,
        notionPageId: 'np_s2',
        meetingId: null,
        source: 'notion',
        sourceKind: 'meeting_page_summary',
        createdAt: now,
        updatedAt: now,
      },
      {
        id: 'mn_dana_past',
        title: 'Weekly with Dana',
        date: '2026-08-18',
        snippet: 'dana',
        bodyText: 'Dana summary',
        notionUrl: null,
        notionPageId: 'np_d2',
        meetingId: null,
        source: 'notion',
        sourceKind: 'meeting_page_summary',
        createdAt: now,
        updatedAt: now,
      },
    ])
    await db.insert(meetingNotePeople).values([
      { meetingNoteId: 'mn_shani_past', personId: 'p_shani' },
      { meetingNoteId: 'mn_dana_past', personId: 'p_dana' },
    ])

    const caller = await createTestCaller()
    const result = await caller.insights.meetingNotes({ prepDate: 'tomorrow', query: 'שני' })
    const ids = result.notes.map((n) => n.id)
    expect(ids).toContain('mn_shani_past')
    expect(ids).toContain('mn_dana_past')
  })
})

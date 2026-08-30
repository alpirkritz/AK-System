import { describe, expect, it } from 'vitest'
import {
  titlesFuzzyMatch,
  isNotionGraphConfigured,
  cleanMeetingTitle,
  shouldFetchNoteBody,
  flattenNotionBlocksToText,
  MEETING_NOTE_BODY_CAP,
} from './notion-graph-sync'

describe('cleanMeetingTitle', () => {
  it('strips trailing ISO timestamps from Notion titles', () => {
    expect(cleanMeetingTitle('Deployments Meeting  2026-07-23T16:00:00.000+03:00')).toBe(
      'Deployments Meeting',
    )
  })

  it('strips bare dates left in the title', () => {
    expect(cleanMeetingTitle('Weekly Sync 2026-07-23')).toBe('Weekly Sync')
  })

  it('leaves normal titles alone', () => {
    expect(cleanMeetingTitle('1:1 with Dana')).toBe('1:1 with Dana')
  })
})

describe('titlesFuzzyMatch', () => {
  it('matches identical titles ignoring punctuation', () => {
    expect(titlesFuzzyMatch('Weekly Sync!', 'weekly sync')).toBe(true)
  })

  it('matches when one title contains the other', () => {
    expect(titlesFuzzyMatch('DAZ standup', 'standup')).toBe(true)
  })

  it('matches Notion ISO title to calendar title', () => {
    expect(
      titlesFuzzyMatch('Deployments Meeting  2026-07-23T16:00:00.000+03:00', 'Deployments Meeting'),
    ).toBe(true)
  })

  it('rejects unrelated titles', () => {
    expect(titlesFuzzyMatch('Board meeting', '1:1 with Dana')).toBe(false)
  })
})

describe('isNotionGraphConfigured', () => {
  it('returns false when NOTION_ACCOUNTS is unset', () => {
    const prev = process.env.NOTION_ACCOUNTS
    delete process.env.NOTION_ACCOUNTS
    delete process.env.NOTION_API_KEY
    expect(isNotionGraphConfigured()).toBe(false)
    if (prev !== undefined) process.env.NOTION_ACCOUNTS = prev
  })

  it('returns true when a people or projects DB is configured', () => {
    process.env.NOTION_ACCOUNTS = JSON.stringify([
      {
        label: 'Personal',
        token: 'ntn_test',
        databases: [{ id: 'abc', name: 'People', type: 'people' }],
      },
    ])
    expect(isNotionGraphConfigured()).toBe(true)
    delete process.env.NOTION_ACCOUNTS
  })
})

describe('shouldFetchNoteBody', () => {
  it('fetches when body is missing', () => {
    expect(
      shouldFetchNoteBody({
        bodyText: null,
        bodySyncedAt: null,
        notionLastEditedAt: null,
        pageLastEdited: '2026-08-13T10:00:00.000Z',
      }),
    ).toBe(true)
  })

  it('skips when page last_edited is not newer than bodySyncedAt', () => {
    expect(
      shouldFetchNoteBody({
        bodyText: 'already have body',
        bodySyncedAt: '2026-08-13T12:00:00.000Z',
        notionLastEditedAt: '2026-08-13T11:00:00.000Z',
        pageLastEdited: '2026-08-13T11:00:00.000Z',
      }),
    ).toBe(false)
  })

  it('skips re-fetch when body is empty but already synced and page was not edited', () => {
    expect(
      shouldFetchNoteBody({
        bodyText: null,
        bodySyncedAt: '2026-08-13T12:00:00.000Z',
        notionLastEditedAt: '2026-08-13T11:00:00.000Z',
        pageLastEdited: '2026-08-13T11:00:00.000Z',
      }),
    ).toBe(false)
  })

  it('fetches when page was edited after bodySyncedAt', () => {
    expect(
      shouldFetchNoteBody({
        bodyText: 'stale body',
        bodySyncedAt: '2026-08-13T10:00:00.000Z',
        notionLastEditedAt: '2026-08-13T10:00:00.000Z',
        pageLastEdited: '2026-08-13T14:00:00.000Z',
      }),
    ).toBe(true)
  })
})

describe('flattenNotionBlocksToText', () => {
  it('joins rich_text blocks and skips image/audio/table', () => {
    const text = flattenNotionBlocksToText([
      { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Decision: ship v2' }] } },
      { type: 'image', image: { rich_text: [] } },
      { type: 'audio', audio: {} },
      { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: 'Follow up with Dana' }] } },
    ])
    expect(text).toBe('Decision: ship v2\nFollow up with Dana')
  })

  it('caps body at MEETING_NOTE_BODY_CAP', () => {
    const long = 'x'.repeat(MEETING_NOTE_BODY_CAP + 500)
    const text = flattenNotionBlocksToText(
      [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: long }] } }],
      MEETING_NOTE_BODY_CAP,
    )
    expect(text.length).toBe(MEETING_NOTE_BODY_CAP)
  })

  it('walks nested children on unsupported / child_page instead of skipping them', () => {
    const text = flattenNotionBlocksToText([
      {
        type: 'unsupported',
        has_children: true,
        children: [
          { type: 'heading_2', heading_2: { rich_text: [{ plain_text: 'Summary' }] } },
          { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Ship on Tuesday' }] } },
        ],
      },
      {
        type: 'child_page',
        child_page: { title: 'AI Meeting Notes' },
        children: [
          { type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ plain_text: 'Follow up Dana' }] } },
        ],
      },
    ])
    expect(text).toContain('Summary')
    expect(text).toContain('Ship on Tuesday')
    expect(text).toContain('AI Meeting Notes')
    expect(text).toContain('Follow up Dana')
  })
})

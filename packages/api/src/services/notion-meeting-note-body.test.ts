import { describe, expect, it } from 'vitest'
import {
  dashNotionId,
  flattenNotionBlocksToText,
  parseNotionIdFromInput,
  pickSourceBlockId,
} from './notion-meeting-note-body'

describe('parseNotionIdFromInput', () => {
  it('parses app.notion.com meeting URL with in-page notes hash', () => {
    const parsed = parseNotionIdFromInput(
      'https://app.notion.com/p/alpir/3cce7d50cb8e809c8f7cda639bce5478?source=copy_link#fb2e7d50cb8e82a193b601601b869cae',
    )
    expect(parsed).toEqual({
      pageId: '3cce7d50-cb8e-809c-8f7c-da639bce5478',
      blockId: 'fb2e7d50-cb8e-82a1-93b6-01601b869cae',
    })
  })

  it('parses dashed UUID', () => {
    expect(parseNotionIdFromInput('3cce7d50-cb8e-809c-8f7c-da639bce5478')).toEqual({
      pageId: '3cce7d50-cb8e-809c-8f7c-da639bce5478',
      blockId: null,
    })
  })

  it('parses compact hex', () => {
    expect(parseNotionIdFromInput('3cce7d50cb8e809c8f7cda639bce5478')).toEqual({
      pageId: '3cce7d50-cb8e-809c-8f7c-da639bce5478',
      blockId: null,
    })
  })

  it('returns null for empty / garbage', () => {
    expect(parseNotionIdFromInput('')).toBeNull()
    expect(parseNotionIdFromInput('not-a-notion-id')).toBeNull()
  })
})

describe('dashNotionId', () => {
  it('inserts dashes into 32-char hex', () => {
    expect(dashNotionId('3cce7d50cb8e809c8f7cda639bce5478')).toBe(
      '3cce7d50-cb8e-809c-8f7c-da639bce5478',
    )
  })
})

describe('pickSourceBlockId', () => {
  it('prefers a meeting_notes / transcription block', () => {
    const id = pickSourceBlockId([
      { id: 'aaa', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'hi' }] } },
      { id: 'fb2e7d50-cb8e-82a1-93b6-01601b869cae', type: 'transcription' },
    ])
    expect(id).toBe('fb2e7d50-cb8e-82a1-93b6-01601b869cae')
  })
})

describe('flatten nested meeting-notes widget', () => {
  it('extracts rich_text from synced_block children', () => {
    const text = flattenNotionBlocksToText([
      {
        type: 'synced_block',
        children: [
          { type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Decision logged' }] } },
        ],
      },
    ])
    expect(text).toBe('Decision logged')
  })

  it('extracts transcription.title and nested summary bullets', () => {
    const text = flattenNotionBlocksToText([
      {
        id: 'fb2e7d50-cb8e-82a1-93b6-01601b869cae',
        type: 'transcription',
        transcription: {
          title: [{ plain_text: 'Velocity Review' }, { plain_text: ' 2026-08-30' }],
        },
        children: [
          {
            type: 'paragraph',
            has_children: true,
            children: [
              { type: 'heading_3', heading_3: { rich_text: [{ plain_text: 'Summary' }] } },
              {
                type: 'bulleted_list_item',
                bulleted_list_item: { rich_text: [{ plain_text: 'Ship the notes ingest' }] },
              },
            ],
          },
        ],
      },
    ])
    expect(text).toContain('Velocity Review')
    expect(text).toContain('Summary')
    expect(text).toContain('Ship the notes ingest')
  })
})


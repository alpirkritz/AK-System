import { describe, expect, it } from 'vitest'
import { notionPageUrl } from './notion-url'

describe('notionPageUrl', () => {
  it('strips dashes from a UUID-style page id', () => {
    expect(notionPageUrl('3cce7d50-cb8e-809c-8f7c-da639bce5478')).toBe(
      'https://www.notion.so/3cce7d50cb8e809c8f7cda639bce5478',
    )
  })

  it('passes through an already-compact id', () => {
    expect(notionPageUrl('3cce7d50cb8e809c8f7cda639bce5478')).toBe(
      'https://www.notion.so/3cce7d50cb8e809c8f7cda639bce5478',
    )
  })
})

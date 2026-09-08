import { describe, expect, it } from 'vitest'
import { headingEmoji, parseNotionSummary } from './notion-summary-format'

describe('parseNotionSummary', () => {
  it('turns Notion executive-briefing lines into headings and labeled fields', () => {
    const body = [
      'R&D Monthly sync',
      'Executive Briefing (What Happened)',
      'Context & Core Trigger: This was a scheduled monthly R&D sync, not an ad-hoc meeting.',
      'High-Level Outcome: Team aligned on post-acquisition messaging strategy.',
      'Discussed Topics & Key Stances',
      'Topic 1: Pizza Hut Acquisition & Messaging Strategy',
      'Leadership emphasized the importance of showcasing recent wins.',
    ].join('\n')

    expect(parseNotionSummary(body)).toEqual([
      { kind: 'heading', level: 1, text: 'R&D Monthly sync' },
      { kind: 'heading', level: 1, text: 'Executive Briefing (What Happened)' },
      {
        kind: 'labeled',
        label: 'Context & Core Trigger',
        text: 'This was a scheduled monthly R&D sync, not an ad-hoc meeting.',
      },
      {
        kind: 'labeled',
        label: 'High-Level Outcome',
        text: 'Team aligned on post-acquisition messaging strategy.',
      },
      { kind: 'heading', level: 1, text: 'Discussed Topics & Key Stances' },
      { kind: 'heading', level: 2, text: 'Topic 1: Pizza Hut Acquisition & Messaging Strategy' },
      { kind: 'paragraph', text: 'Leadership emphasized the importance of showcasing recent wins.' },
    ])
  })

  it('keeps markdown headings, bullets, and numbered steps', () => {
    expect(parseNotionSummary('## סיכום\n* פריט\n1. שלב')).toEqual([
      { kind: 'heading', level: 2, text: 'סיכום' },
      { kind: 'bullet', text: 'פריט' },
      { kind: 'numbered', marker: '1', text: 'שלב' },
    ])
  })

  it('does not treat clock times as labeled fields', () => {
    expect(parseNotionSummary('09:00 התחלנו בשיחה')).toEqual([
      { kind: 'paragraph', text: '09:00 התחלנו בשיחה' },
    ])
  })

  it('leaves a short Hebrew body as a paragraph when it is a sentence', () => {
    expect(parseNotionSummary('החלטנו לדחות את השחרור לשלישי ולעקוב אחרי דנה')).toEqual([
      { kind: 'paragraph', text: 'החלטנו לדחות את השחרור לשלישי ולעקוב אחרי דנה' },
    ])
  })
})

describe('headingEmoji', () => {
  it('picks a cue from the section title', () => {
    expect(headingEmoji('Action Items')).toBe('✅')
    expect(headingEmoji('Key Conclusions & Decisions')).toBe('🎯')
    expect(headingEmoji('Executive Briefing (What Happened)')).toBe('📋')
  })
})

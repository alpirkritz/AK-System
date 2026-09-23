import { describe, expect, it } from 'vitest'
import { formatMorningBriefingContext } from './morning-briefing-context'

describe('formatMorningBriefingContext', () => {
  it('formats empty day', () => {
    const text = formatMorningBriefingContext('2026-07-20', [], [])
    expect(text).toContain('📅 סיכום הבוקר – 2026-07-20')
    expect(text).toContain('אין אירועים או משימות מועדות להיום.')
  })

  it('lists timed events, all-day, and due tasks', () => {
    const text = formatMorningBriefingContext(
      '2026-07-20',
      [
        { start: '2026-07-20T09:30:00', title: '1:1 עם טינקו' },
        { start: '2026-07-20', title: 'יום הולדת' },
      ],
      [{ title: 'לסגור מע״מ', priority: 'high', done: false, dueDate: '2026-07-20' }],
    )
    expect(text).toContain('• 09:30 – 1:1 עם טינקו')
    expect(text).toContain('• כל היום – יום הולדת')
    expect(text).toContain('• [high] לסגור מע״מ')
  })

  it('prints UTC instants in Israel time, not the Z clock', () => {
    const text = formatMorningBriefingContext('2026-09-23', [
      {
        start: '2026-09-23T12:30:00.000Z',
        end: '2026-09-23T13:00:00.000Z',
        title: 'חוג מדע ורפואה של רום',
      },
    ], [])
    expect(text).toContain('• 15:30–16:00 – חוג מדע ורפואה של רום')
    expect(text).not.toContain('12:30')
  })

  it('adds a finance section when something stands out', () => {
    const text = formatMorningBriefingContext('2026-07-20', [], [], ['• מזון — ₪800 מעל הרגיל'])
    expect(text).toContain('פיננסים:')
    expect(text).toContain('• מזון — ₪800 מעל הרגיל')
    expect(text).not.toContain('אין אירועים או משימות מועדות להיום.')
  })

  it('leaves the finance section out entirely when there is nothing to say', () => {
    expect(formatMorningBriefingContext('2026-07-20', [], [], [])).not.toContain('פיננסים')
  })

  it('drops due tasks when includeDueTasks is false', () => {
    const text = formatMorningBriefingContext(
      '2026-07-20',
      [{ start: '2026-07-20T09:30:00', title: '1:1 עם טינקו' }],
      [{ title: 'לסגור מע״מ', priority: 'high', done: false, dueDate: '2026-07-20' }],
      [],
      { includeDueTasks: false },
    )
    expect(text).toContain('1:1 עם טינקו')
    expect(text).not.toContain('משימות להיום')
    expect(text).not.toContain('לסגור מע״מ')
  })
})

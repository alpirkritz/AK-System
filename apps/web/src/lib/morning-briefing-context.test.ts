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

describe('formatMorningBriefingContext cooling flags', () => {
  it('marks meetings with cooling people or a cooling circle', () => {
    const text = formatMorningBriefingContext(
      '2026-07-20',
      [
        { id: 'ev1', start: '2026-07-20T10:00:00', end: '2026-07-20T11:00:00', title: 'Dana 1:1' },
        { id: 'ev2', start: '2026-07-20T12:00:00', end: '2026-07-20T13:00:00', title: 'Algo 4.0' },
        { id: 'ev3', start: '2026-07-20T14:00:00', end: '2026-07-20T15:00:00', title: 'Fine' },
      ],
      [],
      [],
      {
        coolingFlags: [
          { calendarEventId: 'ev1', title: 'Dana 1:1', coolingPeople: ['Dana'], circleCooling: false },
          { calendarEventId: 'ev2', title: 'Algo 4.0', coolingPeople: [], circleCooling: true },
        ],
      },
    )
    expect(text).toContain('Dana 1:1 (↓ Dana)')
    expect(text).toContain('Algo 4.0 (↓ הפגישה מתקררת)')
    expect(text).toMatch(/– Fine$/m)
  })
})

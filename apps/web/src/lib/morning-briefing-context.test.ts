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
})

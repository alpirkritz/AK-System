import { describe, expect, it } from 'vitest'
import { formatAgentCalendarContextForPrompt } from './agent-calendar-context'

describe('formatAgentCalendarContextForPrompt', () => {
  it('lists events and hours — never implies empty when events exist', () => {
    const text = formatAgentCalendarContextForPrompt({
      today: '2026-07-09',
      errors: [],
      events: [
        {
          id: '1',
          title: 'Algo Daily',
          start: '2026-07-09T08:30:00+03:00',
          end: '2026-07-09T09:00:00+03:00',
          isAllDay: false,
          calendarName: 'Dragontail (alpirkritz@gmail.com)',
        },
      ],
    })
    expect(text).toContain('08:30–09:00')
    expect(text).toContain('Algo Daily')
    expect(text).toContain('Dragontail')
    expect(text).toContain('Event count: 1')
    expect(text).toContain('Do NOT report 0 hours')
  })

  it('converts a UTC Z event to Israel time instead of slicing the string', () => {
    const text = formatAgentCalendarContextForPrompt({
      today: '2026-09-23',
      errors: [],
      events: [
        {
          id: 'rom',
          title: 'חוג מדע ורפואה של רום',
          start: '2026-09-23T12:30:00.000Z',
          end: '2026-09-23T13:00:00.000Z',
          isAllDay: false,
        },
      ],
    })
    expect(text).toContain('15:30–16:00')
    expect(text).not.toContain('12:30')
  })

  it('surfaces API errors', () => {
    const text = formatAgentCalendarContextForPrompt({
      today: '2026-07-09',
      events: [],
      errors: [{ email: 'alpirkritz@gmail.com', message: 'invalid_grant' }],
    })
    expect(text).toContain('invalid_grant')
    expect(text).toContain('reconnect Google')
  })

  it('lists personal blocks (e.g. אבא וצף) and instructs never to omit any event', () => {
    const text = formatAgentCalendarContextForPrompt({
      today: '2026-07-12',
      errors: [],
      events: [
        {
          id: '1',
          title: 'אבא וצף',
          start: '2026-07-12T10:15:00+03:00',
          end: '2026-07-12T12:30:00+03:00',
          isAllDay: false,
          transparency: 'opaque',
          attendees: [],
          calendarName: 'alpirkritz@gmail.com (alpirkritz@gmail.com)',
        },
      ],
    })
    expect(text).toContain('אבא וצף')
    expect(text).toContain('List EVERY event')
    // Must not rely on attendee count to classify real meetings.
    expect(text).toContain('attendee lists are often empty')
  })

  it('warns about partial data when errors coexist with events', () => {
    const text = formatAgentCalendarContextForPrompt({
      today: '2026-07-12',
      errors: [{ email: 'alpir@daz.guru', message: 'היומן "Dragontail" לא נטען: 503' }],
      events: [
        {
          id: '1',
          title: 'Jordan PTO',
          start: '2026-07-12',
          end: '2026-07-13',
          isAllDay: true,
          calendarName: 'Team (alpir@daz.guru)',
        },
      ],
    })
    // Even though an event exists, the agent must be told data may be incomplete.
    expect(text).toContain('נתונים חלקיים')
    expect(text).toContain('אל תצהיר שהיום פנוי')
    expect(text).toContain('Dragontail')
  })
})

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

  it('tags events marked Free (transparency: transparent) and excludes them from load hours', () => {
    const text = formatAgentCalendarContextForPrompt({
      today: '2026-09-29',
      errors: [],
      events: [
        {
          id: 'busy-1',
          title: 'Real sync',
          start: '2026-09-29T09:00:00+03:00',
          end: '2026-09-29T10:00:00+03:00',
          isAllDay: false,
          transparency: 'opaque',
        },
        {
          id: 'free-1',
          title: 'Tentative hold',
          start: '2026-09-29T11:00:00+03:00',
          end: '2026-09-29T13:00:00+03:00',
          isAllDay: false,
          transparency: 'transparent',
        },
      ],
    })
    expect(text).toContain('Real sync')
    expect(text).toContain('Tentative hold (מסומן כפנוי)')
    // Only the 1h opaque event counts — the 2h free event is excluded.
    expect(text).toContain('Timed meeting hours (approx): 1.0h')
    expect(text).toContain('do NOT count them toward meeting-load hours')
  })

  it('treats events with no transparency field as busy (no regression)', () => {
    const text = formatAgentCalendarContextForPrompt({
      today: '2026-09-29',
      errors: [],
      events: [
        {
          id: 'apple-1',
          title: 'Apple calendar event',
          start: '2026-09-29T09:00:00+03:00',
          end: '2026-09-29T10:00:00+03:00',
          isAllDay: false,
        },
      ],
    })
    expect(text).toContain('- 09:00–10:00 Apple calendar event\n')
    expect(text).toContain('Timed meeting hours (approx): 1.0h')
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

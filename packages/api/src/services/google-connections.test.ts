import { describe, it, expect } from 'vitest'
import {
  makeGoogleCalendarId,
  parseGoogleCalendarId,
} from './google-connections'

describe('google-connections helpers', () => {
  it('makeGoogleCalendarId encodes email and native id', () => {
    expect(makeGoogleCalendarId('alpirkritz@gmail.com', 'primary')).toBe(
      'google:alpirkritz@gmail.com:primary'
    )
  })

  it('parseGoogleCalendarId round-trips composite ids', () => {
    const composite = makeGoogleCalendarId('alpir@daz.guru', 'abc@group.calendar.google.com')
    expect(parseGoogleCalendarId(composite)).toEqual({
      email: 'alpir@daz.guru',
      calendarId: 'abc@group.calendar.google.com',
    })
  })

  it('parseGoogleCalendarId returns null for legacy native ids', () => {
    expect(parseGoogleCalendarId('primary')).toBeNull()
    expect(parseGoogleCalendarId('apple:foo')).toBeNull()
  })
})

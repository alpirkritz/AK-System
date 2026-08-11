import { describe, expect, it } from 'vitest'
import {
  mapOwaResponse,
  owaDateToIso,
  owaToSourceEvents,
  owaUid,
  type OwaRawEvent,
} from './owa-calendar-source'

function makeRaw(overrides: Partial<OwaRawEvent> = {}): OwaRawEvent {
  return {
    Id: 'AAMkAD_changekey_v1',
    iCalUId: '040000008200E00074C5B7101A82E00800000000',
    Subject: 'Algo 4 Workflow',
    Start: { DateTime: '2026-08-10T09:00:00.0000000', TimeZone: 'UTC' },
    End: { DateTime: '2026-08-10T10:00:00.0000000', TimeZone: 'UTC' },
    IsAllDay: false,
    IsCancelled: false,
    Location: { DisplayName: 'Teams' },
    BodyPreview: 'Agenda inside',
    Attendees: [],
    Type: 'SingleInstance',
    ...overrides,
  }
}

describe('owaDateToIso', () => {
  it('treats a naive OWA timestamp as UTC', () => {
    expect(owaDateToIso({ DateTime: '2026-08-10T09:00:00.0000000', TimeZone: 'UTC' })).toBe(
      '2026-08-10T09:00:00.000Z',
    )
  })

  it('respects an explicit offset when one is present', () => {
    expect(owaDateToIso({ DateTime: '2026-08-10T12:00:00+03:00' })).toBe('2026-08-10T09:00:00.000Z')
  })

  it('returns null for missing or unparseable input', () => {
    expect(owaDateToIso(undefined)).toBeNull()
    expect(owaDateToIso({ DateTime: '' })).toBeNull()
    expect(owaDateToIso({ DateTime: 'not-a-date' })).toBeNull()
  })
})

describe('mapOwaResponse', () => {
  it('maps Exchange responses onto the bridge vocabulary', () => {
    expect(mapOwaResponse('Accepted')).toBe('accepted')
    expect(mapOwaResponse('Organizer')).toBe('accepted')
    expect(mapOwaResponse('Declined')).toBe('declined')
    expect(mapOwaResponse('TentativelyAccepted')).toBe('tentative')
    expect(mapOwaResponse('NotResponded')).toBe('needsAction')
    expect(mapOwaResponse('None')).toBe('needsAction')
  })

  it('returns undefined for unknown values', () => {
    expect(mapOwaResponse(undefined)).toBeUndefined()
    expect(mapOwaResponse('Something')).toBeUndefined()
  })
})

describe('owaUid', () => {
  it('prefers iCalUId so edits do not orphan the mirrored copy', () => {
    const raw = makeRaw({ iCalUId: 'ical-1', Id: 'id-with-changekey' })
    expect(owaUid(raw, '2026-08-10T09:00:00.000Z')).toBe('ical-1_2026-08-10T09:00:00.000Z')
  })

  it('falls back to Id when iCalUId is absent', () => {
    const raw = makeRaw({ iCalUId: undefined, Id: 'id-only' })
    expect(owaUid(raw, '2026-08-10T09:00:00.000Z')).toBe('id-only_2026-08-10T09:00:00.000Z')
  })

  it('keeps recurring occurrences distinct', () => {
    const raw = makeRaw()
    expect(owaUid(raw, '2026-08-10T09:00:00.000Z')).not.toBe(
      owaUid(raw, '2026-08-17T09:00:00.000Z'),
    )
  })
})

describe('owaToSourceEvents', () => {
  it('maps a timed event onto the bridge source shape', () => {
    const [event] = owaToSourceEvents([makeRaw()])
    expect(event).toMatchObject({
      title: 'Algo 4 Workflow',
      start: '2026-08-10T09:00:00.000Z',
      end: '2026-08-10T10:00:00.000Z',
      allDay: false,
      location: 'Teams',
      description: 'Agenda inside',
    })
  })

  it('carries all-day events through with the flag set', () => {
    const [event] = owaToSourceEvents([
      makeRaw({
        IsAllDay: true,
        Subject: 'Itai PTO',
        Start: { DateTime: '2026-07-23T00:00:00.0000000', TimeZone: 'UTC' },
        End: { DateTime: '2026-07-24T00:00:00.0000000', TimeZone: 'UTC' },
      }),
    ])
    expect(event.allDay).toBe(true)
    expect(event.start).toBe('2026-07-23T00:00:00.000Z')
  })

  it('drops cancelled events so they are deleted from Dragontail', () => {
    expect(owaToSourceEvents([makeRaw({ IsCancelled: true })])).toEqual([])
  })

  it('drops events without a usable subject', () => {
    expect(owaToSourceEvents([makeRaw({ Subject: '   ' })])).toEqual([])
    expect(owaToSourceEvents([makeRaw({ Subject: undefined })])).toEqual([])
  })

  it('drops events whose times cannot be parsed rather than emitting Invalid Date', () => {
    expect(owaToSourceEvents([makeRaw({ Start: { DateTime: 'nope' } })])).toEqual([])
    expect(owaToSourceEvents([makeRaw({ End: undefined })])).toEqual([])
  })

  it('normalises blank location and body to null', () => {
    const [event] = owaToSourceEvents([
      makeRaw({ Location: { DisplayName: '  ' }, BodyPreview: '' }),
    ])
    expect(event.location).toBeNull()
    expect(event.description).toBeNull()
  })

  it('maps attendees with their response status', () => {
    const [event] = owaToSourceEvents([
      makeRaw({
        Attendees: [
          {
            Status: { Response: 'Accepted' },
            EmailAddress: { Name: 'Alpir Kritzler', Address: 'alpir.kritzler@pizzahut.com' },
          },
          { Status: { Response: 'NotResponded' }, EmailAddress: { Name: 'Room 3' } },
        ],
      }),
    ])
    expect(event.attendees).toEqual([
      {
        email: 'alpir.kritzler@pizzahut.com',
        name: 'Alpir Kritzler',
        responseStatus: 'accepted',
      },
      { email: null, name: 'Room 3', responseStatus: 'needsAction' },
    ])
  })
})

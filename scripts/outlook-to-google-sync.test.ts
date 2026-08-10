import { describe, expect, it } from 'vitest'
import {
  AK_SOURCE,
  ATTENDEES_CLEARED_VERSION,
  eventBody,
  findDuplicateBridgeCopies,
  googleEventMatchFields,
  isBlockedTitle,
  isBridgeCopy,
  matchKey,
  needsAttendeeCleanup,
  parseBlocklist,
  normalizeStart,
  planSyncActions,
  signature,
  toSourceEvents,
  type GoogleEvent,
  type SourceEvent,
} from './outlook-to-google-sync'

function makeSource(overrides: Partial<SourceEvent> = {}): SourceEvent {
  const base = {
    title: 'Team Sync',
    start: '2026-07-06T14:00:00+03:00',
    end: '2026-07-06T15:00:00+03:00',
    allDay: false,
    location: null,
    description: null,
    attendees: [],
    uid: 'evt1_2026-07-06T14:00:00+03:00',
    sig: '',
  }
  const merged = { ...base, ...overrides }
  merged.sig = signature(merged)
  return merged
}

function makeGoogle(
  overrides: Partial<GoogleEvent> & { id: string },
): GoogleEvent {
  return {
    summary: 'Team Sync',
    start: { dateTime: '2026-07-06T11:00:00.000Z' },
    end: { dateTime: '2026-07-06T12:00:00.000Z' },
    ...overrides,
  }
}

describe('matchKey', () => {
  it('normalizes title whitespace and case', () => {
    const a = matchKey({ title: '  Team   Sync  ', start: '2026-07-06T14:00:00+03:00', allDay: false })
    const b = matchKey({ title: 'team sync', start: '2026-07-06T11:00:00.000Z', allDay: false })
    expect(a).toBe(b)
  })

  it('uses date-only key for all-day events', () => {
    const key = matchKey({ title: 'Holiday', start: '2026-07-06T00:00:00+03:00', allDay: true })
    expect(key).toBe('holiday|2026-07-06')
  })
})

describe('normalizeStart', () => {
  it('converts timed starts to UTC ISO', () => {
    expect(normalizeStart('2026-07-06T14:00:00+03:00', false)).toBe('2026-07-06T11:00:00.000Z')
  })

  it('keeps date portion for all-day', () => {
    expect(normalizeStart('2026-07-06T00:00:00+03:00', true)).toBe('2026-07-06')
  })
})

describe('signature', () => {
  it('changes when attendees change', () => {
    const base = {
      title: 'Sync',
      start: '2026-07-06T14:00:00+03:00',
      end: '2026-07-06T15:00:00+03:00',
      allDay: false,
      location: null,
      description: null,
      attendees: [] as SourceEvent['attendees'],
    }
    const without = signature(base)
    const withAttendee = signature({
      ...base,
      attendees: [{ email: 'a@example.com', name: 'A', responseStatus: 'accepted' }],
    })
    expect(without).not.toBe(withAttendee)
  })
})

describe('eventBody', () => {
  it('puts all attendees in description and never sets attendees field', () => {
    const source = makeSource({
      attendees: [
        { email: 'bob@example.com', name: 'Bob', responseStatus: 'accepted' },
        { email: null, name: 'No Email', responseStatus: 'unknown' },
      ],
    })
    const body = eventBody(source)
    expect(body.extendedProperties).toEqual({
      private: {
        akSource: AK_SOURCE,
        akSourceUid: source.uid,
        akSig: source.sig,
        akAttendeesCleared: ATTENDEES_CLEARED_VERSION,
      },
    })
    // Attendees must never be set on the Google event — only in description.
    expect(body.attendees).toEqual([])
    expect(body.description).toContain('Bob <bob@example.com>')
    expect(body.description).toContain('No Email')
  })
})

describe('toSourceEvents', () => {
  it('parses attendees from raw helper output', () => {
    const events = toSourceEvents([
      {
        id: 'x',
        title: 'Meet',
        start: '2026-07-06T14:00:00+03:00',
        end: '2026-07-06T15:00:00+03:00',
        allDay: false,
        calendar: 'Calendar',
        calendarId: 'c1',
        calSource: 'Exchange',
        calType: 2,
        status: 'confirmed',
        attendees: [{ email: 'a@x.com', name: 'A', responseStatus: 'tentative' }],
      },
    ])
    expect(events).toHaveLength(1)
    expect(events[0].attendees).toEqual([
      { email: 'a@x.com', name: 'A', responseStatus: 'tentative' },
    ])
  })
})

describe('googleEventMatchFields', () => {
  it('reads all-day and timed starts', () => {
    expect(googleEventMatchFields(makeGoogle({
      id: '1',
      start: { date: '2026-07-06' },
    }))).toEqual({ title: 'Team Sync', start: '2026-07-06', allDay: true })

    expect(googleEventMatchFields(makeGoogle({ id: '2' }))).toEqual({
      title: 'Team Sync',
      start: '2026-07-06T11:00:00.000Z',
      allDay: false,
    })
  })
})

describe('planSyncActions', () => {
  const source = makeSource()

  it('creates when no match exists', () => {
    const actions = planSyncActions([source], [], [])
    expect(actions).toEqual([{ action: 'create', source }])
  })

  it('skips unchanged bridge copy', () => {
    const copy = makeGoogle({
      id: 'g1',
      extendedProperties: {
        private: {
          akSource: AK_SOURCE,
          akSourceUid: source.uid,
          akSig: source.sig,
          akAttendeesCleared: ATTENDEES_CLEARED_VERSION,
        },
      },
    })
    const actions = planSyncActions([source], [copy], [copy])
    expect(actions[0].action).toBe('unchanged')
  })

  it('adopts untagged duplicate instead of creating', () => {
    const untagged = makeGoogle({ id: 'legacy' })
    const actions = planSyncActions([source], [], [untagged])
    expect(actions).toEqual([{ action: 'adopt', source, match: untagged }])
    expect(isBridgeCopy(untagged)).toBe(false)
  })

  it('updates when signature differs', () => {
    const copy = makeGoogle({
      id: 'g1',
      extendedProperties: {
        private: {
          akSource: AK_SOURCE,
          akSourceUid: source.uid,
          akSig: 'old-signature',
        },
      },
    })
    const actions = planSyncActions([source], [copy], [copy])
    expect(actions[0].action).toBe('update')
  })

  it('forces update to clear legacy Google attendees', () => {
    const copy = makeGoogle({
      id: 'g1',
      extendedProperties: {
        private: {
          akSource: AK_SOURCE,
          akSourceUid: source.uid,
          akSig: source.sig,
        },
      },
    })
    expect(needsAttendeeCleanup(copy)).toBe(true)
    const actions = planSyncActions([source], [copy], [copy])
    expect(actions[0].action).toBe('update')
  })
})

describe('parseBlocklist', () => {
  it('returns an empty list when unset or empty', () => {
    expect(parseBlocklist(undefined)).toEqual([])
    expect(parseBlocklist('')).toEqual([])
    expect(parseBlocklist('   ')).toEqual([])
  })

  it('trims, lowercases and drops blank entries', () => {
    expect(parseBlocklist(' Town Hall , ,TECH HOUR,, [HOLD] ')).toEqual([
      'town hall',
      'tech hour',
      '[hold]',
    ])
  })
})

describe('isBlockedTitle', () => {
  it('never blocks when the list is empty', () => {
    expect(isBlockedTitle('Global D&T Town Hall [HOLD]', [])).toBe(false)
  })

  it('matches case-insensitively on a substring', () => {
    const patterns = parseBlocklist('town hall,tech hour')
    expect(isBlockedTitle('Global D&T Town Hall [HOLD]', patterns)).toBe(true)
    expect(isBlockedTitle('  TECH HOUR [Details Enclosed]  ', patterns)).toBe(true)
  })

  it('leaves unrelated meetings alone', () => {
    const patterns = parseBlocklist('town hall,tech hour')
    expect(isBlockedTitle('Algo Weekly', patterns)).toBe(false)
    expect(isBlockedTitle('Alpir - Tinko 1:1', patterns)).toBe(false)
  })

  it('drops a blocked event from the source set', () => {
    const patterns = parseBlocklist('town hall')
    const sources = [
      makeSource({ title: 'Algo Weekly' }),
      makeSource({ title: 'Global D&T Town Hall [HOLD]' }),
    ]
    const kept = sources.filter((s) => !isBlockedTitle(s.title, patterns))
    expect(kept.map((s) => s.title)).toEqual(['Algo Weekly'])
  })

  it('leaves the bridge copy of a blocked title orphaned so the delete pass removes it', () => {
    const blocked = makeSource({ title: 'Global D&T Town Hall [HOLD]' })
    const copy = makeGoogle({
      id: 'g-townhall',
      summary: blocked.title,
      extendedProperties: {
        private: {
          akSource: AK_SOURCE,
          akSourceUid: blocked.uid,
          akSig: blocked.sig,
          akAttendeesCleared: ATTENDEES_CLEARED_VERSION,
        },
      },
    })
    const patterns = parseBlocklist('town hall')
    const sources = [blocked].filter((s) => !isBlockedTitle(s.title, patterns))

    expect(planSyncActions(sources, [copy], [copy])).toEqual([])
    const sourceUids = new Set(sources.map((s) => s.uid))
    expect(sourceUids.has(blocked.uid)).toBe(false)
  })
})

describe('findDuplicateBridgeCopies', () => {
  it('returns extras when the same akSourceUid appears twice', () => {
    const a = makeGoogle({
      id: 'keep',
      extendedProperties: {
        private: { akSource: AK_SOURCE, akSourceUid: 'uid-1', akSig: 's' },
      },
    })
    const b = makeGoogle({
      id: 'drop',
      extendedProperties: {
        private: { akSource: AK_SOURCE, akSourceUid: 'uid-1', akSig: 's' },
      },
    })
    const c = makeGoogle({
      id: 'other',
      extendedProperties: {
        private: { akSource: AK_SOURCE, akSourceUid: 'uid-2', akSig: 's' },
      },
    })
    expect(findDuplicateBridgeCopies([a, b, c]).map((e) => e.id)).toEqual(['drop'])
  })
})

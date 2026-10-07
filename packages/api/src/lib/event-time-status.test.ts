import { describe, expect, it } from 'vitest'
import { eventTimeStatus, groupEventsByTime, nowClockBlock } from './event-time-status'

/** 15:51 Israel time — the hour the schedule bug was reported at. */
const NOW = new Date('2026-10-06T12:51:00.000Z')

const event = (id: string, start: string, end: string | null, isAllDay = false) => ({
  id,
  start,
  end,
  isAllDay,
})

describe('eventTimeStatus', () => {
  it('reads a finished meeting as past and a later one as upcoming', () => {
    expect(eventTimeStatus(event('a', '2026-10-06T09:00:00+03:00', '2026-10-06T09:30:00+03:00'), NOW)).toBe('past')
    expect(eventTimeStatus(event('b', '2026-10-06T18:00:00+03:00', '2026-10-06T19:00:00+03:00'), NOW)).toBe('upcoming')
  })

  it('reads a meeting spanning now as current', () => {
    expect(eventTimeStatus(event('c', '2026-10-06T15:30:00+03:00', '2026-10-06T16:30:00+03:00'), NOW)).toBe('current')
  })

  it('treats an event ending exactly now as past, and one starting exactly now as current', () => {
    expect(eventTimeStatus(event('d', '2026-10-06T15:00:00+03:00', '2026-10-06T15:51:00+03:00'), NOW)).toBe('past')
    expect(eventTimeStatus(event('e', '2026-10-06T15:51:00+03:00', '2026-10-06T16:00:00+03:00'), NOW)).toBe('current')
  })

  it('never calls an all-day event past, even late in the day', () => {
    expect(eventTimeStatus(event('f', '2026-10-06T00:00:00+03:00', '2026-10-06T23:59:00+03:00', true), NOW)).toBe(
      'allDay',
    )
  })

  it('falls back to upcoming when the start is unreadable rather than asserting it is over', () => {
    expect(eventTimeStatus(event('g', 'not-a-date', 'also-not-a-date'), NOW)).toBe('upcoming')
  })

  it('assumes an hour when the end is missing, so a morning event is not "happening now" all afternoon', () => {
    expect(eventTimeStatus(event('h', '2026-10-06T09:00:00+03:00', null), NOW)).toBe('past')
    expect(eventTimeStatus(event('i', '2026-10-06T15:40:00+03:00', null), NOW)).toBe('current')
  })

  it('labels a wholly past day and a wholly future day consistently', () => {
    expect(eventTimeStatus(event('j', '2026-10-05T09:00:00+03:00', '2026-10-05T10:00:00+03:00'), NOW)).toBe('past')
    expect(eventTimeStatus(event('k', '2026-10-07T09:00:00+03:00', '2026-10-07T10:00:00+03:00'), NOW)).toBe('upcoming')
  })
})

describe('groupEventsByTime', () => {
  const day = [
    event('birthday', '2026-10-06T00:00:00+03:00', '2026-10-06T23:59:00+03:00', true),
    event('standup', '2026-10-06T09:00:00+03:00', '2026-10-06T09:30:00+03:00'),
    event('sync', '2026-10-06T11:00:00+03:00', '2026-10-06T12:00:00+03:00'),
    event('kids', '2026-10-06T15:30:00+03:00', '2026-10-06T21:00:00+03:00'),
    event('dinner', '2026-10-06T19:00:00+03:00', '2026-10-06T20:00:00+03:00'),
  ]

  it('splits the day into buckets an agent cannot conflate', () => {
    const g = groupEventsByTime(day, NOW)
    expect(g.inProgress.map((e) => e.id)).toEqual(['kids'])
    expect(g.upcoming.map((e) => e.id)).toEqual(['dinner'])
    expect(g.past.map((e) => e.id)).toEqual(['standup', 'sync'])
    expect(g.summary).toEqual({ inProgress: 1, upcoming: 1, allDay: 1, past: 2 })
  })

  it('keeps an all-day event out of past, where agents kept filing today\u2019s birthdays', () => {
    const g = groupEventsByTime(day, NOW)
    expect(g.allDay.map((e) => e.id)).toEqual(['birthday'])
    expect(g.past.map((e) => e.id)).not.toContain('birthday')
  })

  it('accounts for every event exactly once and keeps order within a bucket', () => {
    const g = groupEventsByTime(day, NOW)
    const ids = [...g.inProgress, ...g.upcoming, ...g.allDay, ...g.past].map((e) => e.id)
    expect(ids.slice().sort()).toEqual(day.map((e) => e.id).sort())
    expect(g.past.map((e) => e.id)).toEqual(['standup', 'sync'])
  })

  it('puts the whole day ahead at 07:00, so the morning briefing is unchanged', () => {
    const morning = new Date('2026-10-06T04:00:00.000Z')
    const g = groupEventsByTime(day, morning)
    expect(g.past).toHaveLength(0)
    expect(g.upcoming.map((e) => e.id)).toEqual(['standup', 'sync', 'kids', 'dinner'])
  })
})

describe('nowClockBlock', () => {
  it('reports the local wall clock, not UTC', () => {
    expect(nowClockBlock(NOW)).toEqual({
      localTime: '15:51',
      iso: '2026-10-06T12:51:00.000Z',
      timeZone: 'Asia/Jerusalem',
    })
  })
})

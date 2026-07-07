import { describe, expect, it } from 'vitest'
import {
  filterEventsByCalendarScope,
  setAgentCalendarIds,
  getAgentCalendarIds,
  getAgentCalendarScopePromptBlock,
} from './agent-calendar-scope'

describe('filterEventsByCalendarScope', () => {
  const events = [
    { id: '1', calendarId: 'google:a@x.com:primary', title: 'A' },
    { id: '2', calendarId: 'google:a@x.com:dragontail', title: 'B' },
    { id: '3', calendarId: 'google:b@x.com:primary', title: 'C' },
  ]

  it('returns all events when scope is null', () => {
    expect(filterEventsByCalendarScope(events, null)).toHaveLength(3)
  })

  it('returns all events when scope is empty', () => {
    expect(filterEventsByCalendarScope(events, [])).toHaveLength(3)
  })

  it('filters to selected calendar ids', () => {
    const scoped = filterEventsByCalendarScope(events, [
      'google:a@x.com:dragontail',
      'google:b@x.com:primary',
    ])
    expect(scoped.map((e) => e.id)).toEqual(['2', '3'])
  })

  it('drops events without calendarId when scoped', () => {
    const mixed = [...events, { id: '4', calendarId: undefined }]
    const scoped = filterEventsByCalendarScope(mixed, ['google:a@x.com:primary'])
    expect(scoped).toHaveLength(1)
    expect(scoped[0]?.id).toBe('1')
  })
})

describe('agent calendar scope persistence', () => {
  it('defaults to null (all calendars)', async () => {
    const ids = await getAgentCalendarIds()
    expect(ids).toBeNull()
  })

  it('round-trips calendar ids', async () => {
    const input = ['google:alpirkritz@gmail.com:dragontail', 'google:alpir@daz.guru:primary']
    await setAgentCalendarIds(input)
    const loaded = await getAgentCalendarIds()
    expect(loaded).toEqual(input)
    await setAgentCalendarIds(null)
    expect(await getAgentCalendarIds()).toBeNull()
  })
})

describe('getAgentCalendarScopePromptBlock', () => {
  it('returns empty string when scope is unset', async () => {
    await setAgentCalendarIds(null)
    expect(await getAgentCalendarScopePromptBlock()).toBe('')
  })

  it('lists scoped calendar names from catalog', async () => {
    await setAgentCalendarIds(['google:alpirkritz@gmail.com:dragontail'])
    const block = await getAgentCalendarScopePromptBlock([
      {
        id: 'google:alpirkritz@gmail.com:dragontail',
        name: 'dragontail (alpirkritz@gmail.com)',
        color: '#4285f4',
        source: 'google',
        accountEmail: 'alpirkritz@gmail.com',
      },
    ])
    expect(block).toContain('יומנים פעילים לניתוח')
    expect(block).toContain('dragontail (alpirkritz@gmail.com)')
    expect(block).toContain('אל תכלול')
    await setAgentCalendarIds(null)
  })
})

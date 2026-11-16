import { describe, expect, it, vi } from 'vitest'

vi.mock('expo-constants', () => ({ default: { expoConfig: { extra: {} } } }))

const { mobileRouteForNotificationUrl, notificationHref } = await import('./api')

const hrefFor = (url: string) => notificationHref(mobileRouteForNotificationUrl(url))

describe('notification deep links', () => {
  it('opens the agent conversation for /agents?agent=<id>', () => {
    expect(hrefFor('/agents?agent=morning_briefing')).toEqual({
      pathname: '/chat',
      params: { agent: 'morning_briefing' },
    })
  })

  it('keeps /agents without an id on the agents list', () => {
    expect(hrefFor('/agents')).toEqual({ pathname: '/agents', params: {} })
  })

  it('forwards chat message and agent params', () => {
    expect(hrefFor('/chat?message=m1&agent=hugo')).toEqual({
      pathname: '/chat',
      params: { message: 'm1', agent: 'hugo' },
    })
  })

  it('opens meeting detail for /meetings/<id> and /meeting/<id>, keeping id case', () => {
    expect(hrefFor('/meetings/AbC123')).toEqual({ pathname: '/meeting/[id]', params: { id: 'AbC123' } })
    expect(hrefFor('/meeting/xyz')).toEqual({ pathname: '/meeting/[id]', params: { id: 'xyz' } })
  })

  it('forwards meetings focus', () => {
    expect(hrefFor('/meetings?focus=m9')).toEqual({ pathname: '/meetings', params: { focus: 'm9' } })
  })

  it('opens task detail for /tasks/<id>', () => {
    expect(hrefFor('/tasks/t-1')).toEqual({ pathname: '/task/[id]', params: { id: 't-1' } })
    expect(hrefFor('/tasks')).toEqual({ pathname: '/tasks', params: {} })
  })
})

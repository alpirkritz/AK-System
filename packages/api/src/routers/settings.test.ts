import { describe, it, expect, beforeEach } from 'vitest'
import { getDb, userSettings, notificationPreferences } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { createTestCaller } from '../test-utils'
import {
  resolveNotificationChannels,
  getNotificationRouting,
} from '../services/notification-preferences'

describe('settings agentCalendars router', () => {
  beforeEach(async () => {
    await getDb().delete(userSettings)
  })

  it('get returns null when unset', async () => {
    const caller = await createTestCaller()
    const res = await caller.settings.agentCalendars.get()
    expect(res.calendarIds).toBeNull()
  })

  it('set persists and get returns calendar ids', async () => {
    const caller = await createTestCaller()
    const ids = [
      'google:alpirkritz@gmail.com:dragontail',
      'google:alpir@daz.guru:primary',
    ]
    const saved = await caller.settings.agentCalendars.set({ calendarIds: ids })
    expect(saved.calendarIds).toEqual(ids)

    const loaded = await caller.settings.agentCalendars.get()
    expect(loaded.calendarIds).toEqual(ids)
  })

  it('set null clears scope (all calendars)', async () => {
    const caller = await createTestCaller()
    await caller.settings.agentCalendars.set({
      calendarIds: ['google:alpirkritz@gmail.com:primary'],
    })
    const cleared = await caller.settings.agentCalendars.set({ calendarIds: null })
    expect(cleared.calendarIds).toBeNull()

    const row = await getDb()
      .select()
      .from(userSettings)
      .where(eq(userSettings.id, 'default'))
      .limit(1)
    expect(row[0]?.agentCalendarIds).toBeNull()
  })
})

describe('settings notifications router', () => {
  beforeEach(async () => {
    await getDb().delete(notificationPreferences)
  })

  it('list returns the full catalog with channel status', async () => {
    const caller = await createTestCaller()
    const res = await caller.settings.notifications.list()
    expect(res.items.length).toBeGreaterThanOrEqual(10)
    expect(res.items.some((i) => i.id === 'morning_briefing')).toBe(true)
    expect(res.channels).toHaveProperty('whatsapp')
    expect(res.channels).toHaveProperty('telegram')
    expect(res.channels).toHaveProperty('push')
  })

  it('defaults to all supported channels enabled when no row exists', async () => {
    const resolved = await resolveNotificationChannels('morning_briefing')
    expect(resolved).toEqual({ enabled: true, whatsapp: true, push: true, telegram: true })
  })

  it('push-only types never resolve non-push channels', async () => {
    const resolved = await resolveNotificationChannels('whatsapp_fomo')
    expect(resolved.push).toBe(true)
    expect(resolved.whatsapp).toBe(false)
    expect(resolved.telegram).toBe(false)
  })

  it('upsert disables a channel and resolve reflects it', async () => {
    const caller = await createTestCaller()
    await caller.settings.notifications.upsert({
      typeId: 'morning_briefing',
      channels: { whatsapp: false },
    })
    const resolved = await resolveNotificationChannels('morning_briefing')
    expect(resolved.whatsapp).toBe(false)
    expect(resolved.push).toBe(true)
    expect(resolved.telegram).toBe(true)
  })

  it('disabling a type shuts every channel off in resolve', async () => {
    const caller = await createTestCaller()
    await caller.settings.notifications.upsert({ typeId: 'task_reminder', enabled: false })
    const resolved = await resolveNotificationChannels('task_reminder')
    expect(resolved.enabled).toBe(false)
  })

  it('rejects scheduleTimes for a non-schedulable type', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.settings.notifications.upsert({
        typeId: 'task_reminder',
        scheduleTimes: ['09:00'],
      }),
    ).rejects.toThrow()
  })

  it('persists scheduleTimes for a schedulable type', async () => {
    const caller = await createTestCaller()
    await caller.settings.notifications.upsert({
      typeId: 'morning_briefing',
      scheduleTimes: ['08:30'],
    })
    const res = await caller.settings.notifications.list()
    const morning = res.items.find((i) => i.id === 'morning_briefing')
    expect(morning?.scheduleTimes).toEqual(['08:30'])
  })

  it('resetDefaults clears stored rows', async () => {
    const caller = await createTestCaller()
    await caller.settings.notifications.upsert({ typeId: 'feed_digest', enabled: false })
    const { reset } = await caller.settings.notifications.resetDefaults()
    expect(reset).toBeGreaterThanOrEqual(1)
    const resolved = await resolveNotificationChannels('feed_digest')
    expect(resolved.enabled).toBe(true)
  })

  it('list exposes routable flag and the available agents', async () => {
    const caller = await createTestCaller()
    const res = await caller.settings.notifications.list()
    const morning = res.items.find((i) => i.id === 'morning_briefing')
    expect(morning?.routable).toBe(true)
    expect(morning?.suggestedAgentId).toBe('03_morning_briefing')
    const feed = res.items.find((i) => i.id === 'feed_digest')
    expect(feed?.routable).toBeFalsy()
    expect(Array.isArray(res.agents)).toBe(true)
  })

  it('persists agentId + triggerMessage for a routable type', async () => {
    const caller = await createTestCaller()
    await caller.settings.notifications.upsert({
      typeId: 'morning_briefing',
      agentId: '06_calendar_optimizer',
      triggerMessage: 'סכם את היומן והצע אופטימיזציה',
    })
    const routing = await getNotificationRouting('morning_briefing')
    expect(routing.agentId).toBe('06_calendar_optimizer')
    expect(routing.triggerMessage).toBe('סכם את היומן והצע אופטימיזציה')
  })

  it('clearing agentId reverts to the template (null routing)', async () => {
    const caller = await createTestCaller()
    await caller.settings.notifications.upsert({
      typeId: 'morning_briefing',
      agentId: '06_calendar_optimizer',
    })
    await caller.settings.notifications.upsert({ typeId: 'morning_briefing', agentId: null })
    const routing = await getNotificationRouting('morning_briefing')
    expect(routing.agentId).toBeNull()
  })

  it('rejects agentId for a non-routable type', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.settings.notifications.upsert({ typeId: 'feed_digest', agentId: '06_calendar_optimizer' }),
    ).rejects.toThrow()
  })

  it('getNotificationRouting returns null routing for non-routable types', async () => {
    const routing = await getNotificationRouting('feed_digest')
    expect(routing.agentId).toBeNull()
  })
})

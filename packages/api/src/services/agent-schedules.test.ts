import { describe, it, expect, beforeEach } from 'vitest'
import {
  getDb,
  agentSchedules,
  agentTriggers,
  notificationPreferences,
  userSettings,
} from '@ak-system/database'
import { eq } from 'drizzle-orm'
import {
  hasAgentRunInSlot,
  listAgentsDueAtTime,
  markAgentRan,
  migrateAgentSchedulesOnce,
  setAgentSchedule,
  setEventSubscription,
  wasAgentRunInSlot,
} from './agent-schedules'
import { getNotificationRouting } from './notification-preferences'

async function scheduleRow(agentId: string) {
  const rows = await getDb()
    .select()
    .from(agentSchedules)
    .where(eq(agentSchedules.agentId, agentId))
    .all()
  return rows[0] ?? null
}

describe('agent schedules service', () => {
  beforeEach(async () => {
    const db = getDb()
    await db.delete(agentSchedules)
    await db.delete(agentTriggers)
    await db.delete(notificationPreferences)
    await db.delete(userSettings)
  })

  it('carries legacy agent_triggers rows over exactly once', async () => {
    const db = getDb()
    await db.insert(agentTriggers).values({
      agentId: '07_email_assistant',
      enabled: true,
      scheduleTimes: '["09:30"]',
      triggerMessage: 'legacy message',
      lastRunAt: '2026-08-01T06:00:00.000Z',
      lastRunStatus: 'ok',
      lastRunError: null,
      updatedAt: '2026-08-01T06:00:00.000Z',
    })

    const first = await migrateAgentSchedulesOnce()
    expect(first.alreadyDone).toBe(false)
    expect(first.migrated).toBe(1)

    const migrated = await scheduleRow('07_email_assistant')
    expect(migrated?.enabled).toBe(true)
    expect(migrated?.scheduleTimes).toBe('["09:30"]')
    expect(migrated?.triggerMessage).toBe('legacy message')
    expect(migrated?.lastRunStatus).toBe('ok')

    // A schedule the user deletes afterwards must not come back.
    await getDb().delete(agentSchedules)
    const second = await migrateAgentSchedulesOnce()
    expect(second.alreadyDone).toBe(true)
    expect(second.migrated).toBe(0)
    expect(await scheduleRow('07_email_assistant')).toBeNull()
  })

  it('seeds pre-meeting routing so meeting prep works out of the box', async () => {
    const res = await migrateAgentSchedulesOnce()
    expect(res.seededEvents).toContain('pre_meeting_briefing')
    expect((await getNotificationRouting('pre_meeting_briefing')).agentId).toBe(
      '04_meeting_prep_herald',
    )
  })

  it('does not override an existing pre-meeting routing choice', async () => {
    await setEventSubscription({
      agentId: '01_Hugo_orchestrator',
      typeId: 'pre_meeting_briefing',
      subscribed: true,
    })

    const res = await migrateAgentSchedulesOnce()
    expect(res.seededEvents).not.toContain('pre_meeting_briefing')
    expect((await getNotificationRouting('pre_meeting_briefing')).agentId).toBe(
      '01_Hugo_orchestrator',
    )
  })

  it('markAgentRan stamps a run even with no schedule configured', async () => {
    await markAgentRan('06_calendar_optimizer', 'ok')

    const row = await scheduleRow('06_calendar_optimizer')
    expect(row?.lastRunStatus).toBe('ok')
    expect(row?.lastRunAt).toBeTruthy()
    // Stamping a run must not silently switch an agent on.
    expect(row?.enabled).toBe(false)
  })

  it('markAgentRan preserves an existing schedule and records errors', async () => {
    await setAgentSchedule({
      agentId: '03_morning_briefing',
      enabled: true,
      scheduleTimes: ['07:00'],
    })
    await markAgentRan('03_morning_briefing', 'error', 'gemini overloaded')

    const row = await scheduleRow('03_morning_briefing')
    expect(row?.enabled).toBe(true)
    expect(row?.scheduleTimes).toBe('["07:00"]')
    expect(row?.lastRunStatus).toBe('error')
    expect(row?.lastRunError).toBe('gemini overloaded')
  })

  it('setAgentSchedule keeps last-run history when times change', async () => {
    await markAgentRan('05_ibkr_daily_import', 'ok')
    const before = await scheduleRow('05_ibkr_daily_import')

    await setAgentSchedule({
      agentId: '05_ibkr_daily_import',
      enabled: true,
      scheduleTimes: ['18:00'],
    })

    const after = await scheduleRow('05_ibkr_daily_import')
    expect(after?.lastRunAt).toBe(before?.lastRunAt)
    expect(after?.lastRunStatus).toBe('ok')
  })

  it('wasAgentRunInSlot only matches the same day and slot', () => {
    const tz = 'Asia/Jerusalem'
    const now = new Date()
    const slot = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(now)

    expect(wasAgentRunInSlot(now.toISOString(), slot, tz)).toBe(true)
    expect(wasAgentRunInSlot(now.toISOString(), '00:01', tz)).toBe(false)
    expect(wasAgentRunInSlot(null, slot, tz)).toBe(false)

    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
    expect(wasAgentRunInSlot(yesterday.toISOString(), slot, tz)).toBe(false)
  })

  it('hasAgentRunInSlot lets one trigger path stand down for the other', async () => {
    const tz = 'Asia/Jerusalem'
    const slot = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(new Date())

    expect(await hasAgentRunInSlot('03_morning_briefing', slot, tz)).toBe(false)

    await markAgentRan('03_morning_briefing', 'ok')
    expect(await hasAgentRunInSlot('03_morning_briefing', slot, tz)).toBe(true)

    // A failed run must not block a retry in the same slot.
    await markAgentRan('03_morning_briefing', 'error', 'boom')
    expect(await hasAgentRunInSlot('03_morning_briefing', slot, tz)).toBe(false)
  })

  it('listAgentsDueAtTime ignores disabled agents and other slots', async () => {
    await setAgentSchedule({
      agentId: '03_morning_briefing',
      enabled: true,
      scheduleTimes: ['07:00', '20:00'],
    })
    await setAgentSchedule({
      agentId: '07_email_assistant',
      enabled: false,
      scheduleTimes: ['07:00'],
    })

    expect((await listAgentsDueAtTime('07:00')).map((r) => r.agentId)).toEqual([
      '03_morning_briefing',
    ])
    expect((await listAgentsDueAtTime('20:00')).map((r) => r.agentId)).toEqual([
      '03_morning_briefing',
    ])
    expect(await listAgentsDueAtTime('12:00')).toHaveLength(0)
  })
})

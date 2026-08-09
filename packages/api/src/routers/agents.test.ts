import fs from 'fs'
import path from 'path'
import { describe, it, expect, beforeEach } from 'vitest'
import {
  getDb,
  agentSchedules,
  agentTriggers,
  notificationPreferences,
  userSettings,
} from '@ak-system/database'
import { appRouter } from '../index'
import { createContext, createCallerFactory } from '../trpc'
import { createTestCaller } from '../test-utils'
import { getNotificationRouting } from '../services/notification-preferences'

async function createUnauthCaller() {
  const db = getDb()
  const ctx = await createContext({ db, session: null })
  return createCallerFactory(appRouter)(ctx)
}

const AGENTS_DIR = path.resolve(process.cwd(), '../..', 'A_Agents')

describe('agents router', () => {
  beforeEach(async () => {
    const db = getDb()
    await db.delete(agentSchedules)
    await db.delete(agentTriggers)
    await db.delete(notificationPreferences)
    await db.delete(userSettings)
  })

  it('list discovers every agent card and treats them all as schedulable', async () => {
    const caller = await createTestCaller()
    const res = await caller.agents.list()

    expect(res.agents.length).toBeGreaterThan(0)

    const morning = res.agents.find((a) => a.agentId === '03_morning_briefing')
    expect(morning).toBeDefined()
    expect(morning?.enabled).toBe(false)
    expect(morning?.suggestedScheduleTimes).toContain('07:00')

    // Previously blocked by the SCHEDULABLE_AGENT_IDS allowlist.
    expect(res.agents.find((a) => a.agentId === '08_startup_coo')).toBeDefined()
    expect(res.agents.find((a) => a.agentId === '01_Hugo_orchestrator')).toBeDefined()
  })

  it('list exposes the routable event catalog', async () => {
    const caller = await createTestCaller()
    const { events } = await caller.agents.list()

    const preMeeting = events.find((e) => e.typeId === 'pre_meeting_briefing')
    expect(preMeeting).toBeDefined()
    expect(preMeeting?.suggestedAgentId).toBe('04_meeting_prep_herald')
    expect(events.some((e) => e.typeId === 'morning_briefing')).toBe(true)
  })

  it('a new agent card is configurable with no code change', async () => {
    const tmpId = '99_zz_dynamic_test_agent'
    const tmpFile = path.join(AGENTS_DIR, `${tmpId}.md`)
    fs.writeFileSync(
      tmpFile,
      '# Dynamic Test Agent\n\n## Role\n\nTemporary agent used by the agents router test.\n',
      'utf-8',
    )

    try {
      const caller = await createTestCaller()
      const listed = await caller.agents.list()
      expect(listed.agents.some((a) => a.agentId === tmpId)).toBe(true)

      const saved = await caller.agents.setSchedule({
        agentId: tmpId,
        enabled: true,
        scheduleTimes: ['06:45'],
      })
      expect(saved.enabled).toBe(true)
      expect(saved.scheduleTimes).toEqual(['06:45'])

      const due = await caller.agents.dueAtTime({ time: '06:45' })
      expect(due.agents.map((a) => a.agentId)).toContain(tmpId)
    } finally {
      fs.rmSync(tmpFile, { force: true })
    }
  })

  it('setSchedule persists times and trigger message', async () => {
    const caller = await createTestCaller()
    const saved = await caller.agents.setSchedule({
      agentId: '03_morning_briefing',
      enabled: true,
      scheduleTimes: ['07:00', '08:00'],
      triggerMessage: 'בוקר טוב',
    })
    expect(saved.enabled).toBe(true)
    expect(saved.scheduleTimes).toEqual(['07:00', '08:00'])
    expect(saved.triggerMessage).toBe('בוקר טוב')

    const list = await caller.agents.list()
    const row = list.agents.find((a) => a.agentId === '03_morning_briefing')
    expect(row?.enabled).toBe(true)
    expect(row?.scheduleTimes).toEqual(['07:00', '08:00'])
  })

  it('setSchedule refuses to enable a schedule with no times', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.agents.setSchedule({
        agentId: '03_morning_briefing',
        enabled: true,
        scheduleTimes: [],
      }),
    ).rejects.toThrow()
  })

  it('setSchedule rejects times that could never match a cron slot', async () => {
    const caller = await createTestCaller()
    for (const bad of ['99:99', '24:00', '7:00', '07:60', 'morning']) {
      await expect(
        caller.agents.setSchedule({ agentId: '03_morning_briefing', scheduleTimes: [bad] }),
      ).rejects.toThrow()
    }
  })

  it('setSchedule rejects an unknown agent', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.agents.setSchedule({ agentId: 'nope_not_an_agent', scheduleTimes: ['07:00'] }),
    ).rejects.toThrow()
  })

  it('setEventSubscription routes an event to the agent and clears it again', async () => {
    const caller = await createTestCaller()

    const on = await caller.agents.setEventSubscription({
      agentId: '04_meeting_prep_herald',
      typeId: 'pre_meeting_briefing',
      subscribed: true,
    })
    expect(on.routedAgentId).toBe('04_meeting_prep_herald')
    expect((await getNotificationRouting('pre_meeting_briefing')).agentId).toBe(
      '04_meeting_prep_herald',
    )

    const listed = await caller.agents.list()
    const herald = listed.agents.find((a) => a.agentId === '04_meeting_prep_herald')
    expect(herald?.subscribedEvents).toContain('pre_meeting_briefing')

    const off = await caller.agents.setEventSubscription({
      agentId: '04_meeting_prep_herald',
      typeId: 'pre_meeting_briefing',
      subscribed: false,
    })
    expect(off.routedAgentId).toBeNull()
    expect((await getNotificationRouting('pre_meeting_briefing')).agentId).toBeNull()
  })

  it('subscribing takes an event over from the agent that held it', async () => {
    const caller = await createTestCaller()
    await caller.agents.setEventSubscription({
      agentId: '03_morning_briefing',
      typeId: 'morning_briefing',
      subscribed: true,
    })
    await caller.agents.setEventSubscription({
      agentId: '06_calendar_optimizer',
      typeId: 'morning_briefing',
      subscribed: true,
    })

    expect((await getNotificationRouting('morning_briefing')).agentId).toBe(
      '06_calendar_optimizer',
    )
  })

  it('unsubscribing does not clear an event owned by a different agent', async () => {
    const caller = await createTestCaller()
    await caller.agents.setEventSubscription({
      agentId: '03_morning_briefing',
      typeId: 'morning_briefing',
      subscribed: true,
    })
    await caller.agents.setEventSubscription({
      agentId: '07_email_assistant',
      typeId: 'morning_briefing',
      subscribed: false,
    })

    expect((await getNotificationRouting('morning_briefing')).agentId).toBe(
      '03_morning_briefing',
    )
  })

  it('setEventSubscription rejects a non-routable event', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.agents.setEventSubscription({
        agentId: '03_morning_briefing',
        typeId: 'whatsapp_fomo',
        subscribed: true,
      }),
    ).rejects.toThrow()
  })

  it('dueAtTime returns only enabled agents matching the slot', async () => {
    const caller = await createTestCaller()
    await caller.agents.setSchedule({
      agentId: '03_morning_briefing',
      enabled: true,
      scheduleTimes: ['07:00'],
    })
    await caller.agents.setSchedule({
      agentId: '07_email_assistant',
      enabled: true,
      scheduleTimes: ['09:00'],
    })
    await caller.agents.setSchedule({
      agentId: '06_calendar_optimizer',
      enabled: false,
      scheduleTimes: ['07:00'],
    })

    const at7 = await caller.agents.dueAtTime({ time: '07:00' })
    expect(at7.agents.map((a) => a.agentId)).toEqual(['03_morning_briefing'])

    const at9 = await caller.agents.dueAtTime({ time: '09:00' })
    expect(at9.agents.map((a) => a.agentId)).toEqual(['07_email_assistant'])
  })

  it('list requires auth', async () => {
    const caller = await createUnauthCaller()
    await expect(caller.agents.list()).rejects.toThrow()
  })

  it('run delegates to the context runner', async () => {
    const db = getDb()
    const ctx = await createContext({
      db,
      session: { user: { id: 'test', email: 't@t.com', name: 'T' } },
      runAgentTrigger: async (agentId) => ({ ok: true, text: `ran ${agentId}` }),
    })
    const caller = createCallerFactory(appRouter)(ctx)
    const res = await caller.agents.run({ agentId: '03_morning_briefing' })
    expect(res.ok).toBe(true)
    expect(res.text).toContain('03_morning_briefing')
  })

  it('run rejects an unknown agent', async () => {
    const db = getDb()
    const ctx = await createContext({
      db,
      session: { user: { id: 'test', email: 't@t.com', name: 'T' } },
      runAgentTrigger: async (agentId) => ({ ok: true, text: `ran ${agentId}` }),
    })
    const caller = createCallerFactory(appRouter)(ctx)
    await expect(caller.agents.run({ agentId: 'nope_not_an_agent' })).rejects.toThrow()
  })
})

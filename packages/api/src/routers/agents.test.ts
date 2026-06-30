import { describe, it, expect, beforeEach } from 'vitest'
import { getDb, agentTriggers } from '@ak-system/database'
import { appRouter } from '../index'
import { createContext, createCallerFactory } from '../trpc'
import { createTestCaller } from '../test-utils'

async function createUnauthCaller() {
  const db = getDb()
  const ctx = await createContext({ db, session: null })
  return createCallerFactory(appRouter)(ctx)
}

describe('agents triggers router', () => {
  beforeEach(async () => {
    await getDb().delete(agentTriggers)
  })

  it('list returns agents with default schedule suggestions', async () => {
    const caller = await createTestCaller()
    const res = await caller.agents.triggers.list()
    expect(res.agents.length).toBeGreaterThan(0)

    const morning = res.agents.find((a) => a.agentId === '03_morning_briefing')
    expect(morning).toBeDefined()
    expect(morning?.schedulable).toBe(true)
    expect(morning?.scheduleTimes).toContain('07:00')
    expect(morning?.enabled).toBe(false)
  })

  it('upsert saves trigger config', async () => {
    const caller = await createTestCaller()
    const saved = await caller.agents.triggers.upsert({
      agentId: '03_morning_briefing',
      enabled: true,
      scheduleTimes: ['07:00', '08:00'],
      triggerMessage: 'בוקר טוב',
    })
    expect(saved.enabled).toBe(true)
    expect(saved.scheduleTimes).toEqual(['07:00', '08:00'])
    expect(saved.triggerMessage).toBe('בוקר טוב')

    const list = await caller.agents.triggers.list()
    const row = list.agents.find((a) => a.agentId === '03_morning_briefing')
    expect(row?.enabled).toBe(true)
    expect(row?.scheduleTimes).toEqual(['07:00', '08:00'])
  })

  it('upsert rejects schedule for non-schedulable agent', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.agents.triggers.upsert({
        agentId: '01_Hugo_orchestrator',
        scheduleTimes: ['07:00'],
      }),
    ).rejects.toThrow()
  })

  it('dueAtTime returns enabled agents matching slot', async () => {
    const caller = await createTestCaller()
    await caller.agents.triggers.upsert({
      agentId: '03_morning_briefing',
      enabled: true,
      scheduleTimes: ['07:00'],
    })
    await caller.agents.triggers.upsert({
      agentId: '07_email_assistant',
      enabled: true,
      scheduleTimes: ['09:00'],
    })

    const at7 = await caller.agents.triggers.dueAtTime({ time: '07:00' })
    expect(at7.agents).toHaveLength(1)
    expect(at7.agents[0].agentId).toBe('03_morning_briefing')

    const at9 = await caller.agents.triggers.dueAtTime({ time: '09:00' })
    expect(at9.agents).toHaveLength(1)
    expect(at9.agents[0].agentId).toBe('07_email_assistant')
  })

  it('dueAtTime ignores disabled agents', async () => {
    const caller = await createTestCaller()
    await caller.agents.triggers.upsert({
      agentId: '03_morning_briefing',
      enabled: false,
      scheduleTimes: ['07:00'],
    })

    const at7 = await caller.agents.triggers.dueAtTime({ time: '07:00' })
    expect(at7.agents).toHaveLength(0)
  })

  it('list requires auth', async () => {
    const caller = await createUnauthCaller()
    await expect(caller.agents.triggers.list()).rejects.toThrow()
  })

  it('run delegates to context runner', async () => {
    const db = getDb()
    const ctx = await createContext({
      db,
      session: { user: { id: 'test', email: 't@t.com', name: 'T' } },
      runAgentTrigger: async (agentId) => ({ ok: true, text: `ran ${agentId}` }),
    })
    const caller = createCallerFactory(appRouter)(ctx)
    const res = await caller.agents.triggers.run({ agentId: '03_morning_briefing' })
    expect(res.ok).toBe(true)
    expect(res.text).toContain('03_morning_briefing')
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { agentFeedback, getDb, memories, memoryLinks, userSettings } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import {
  applyAgentFeedback,
  listAgentFeedback,
  listAgentRules,
  recordAgentFeedback,
  rejectAgentFeedback,
  setAgentRuleEnabled,
} from './agent-feedback'
import {
  AGENT_RULE_CAP,
  buildRelevantMemoryBlock,
  clearMemoryRelevanceCache,
  resetMemoryBackfillCheck,
} from './memory-relevance'

const OPT = '06_calendar_optimizer'
const PREP = '04_meeting_prep_herald'

beforeEach(async () => {
  const db = getDb()
  await db.delete(agentFeedback)
  await db.delete(memoryLinks)
  await db.delete(memories)
  await db.delete(userSettings)
  clearMemoryRelevanceCache(db)
  resetMemoryBackfillCheck()
})

describe('agent feedback loop', () => {
  it('records the complaint with a suggested rule, and survives a model failure', async () => {
    const ok = await recordAgentFeedback(getDb(), { agentId: OPT, feedback: 'תמיד מפספס ימי הולדת' }, async () => '«אל תדלג על אירועי יום הולדת»')
    expect(ok.suggestedRule).toBe('אל תדלג על אירועי יום הולדת')
    const failed = await recordAgentFeedback(getDb(), { agentId: OPT, feedback: 'שוב' }, async () => null)
    expect(failed.suggestedRule).toBeNull()
    expect(await listAgentFeedback(getDb(), { agentId: OPT })).toHaveLength(2)
  })

  it('an applied rule reaches only its own agent', async () => {
    const row = await recordAgentFeedback(getDb(), { agentId: OPT, feedback: 'x' }, async () => null)
    await applyAgentFeedback(getDb(), row.id, 'אל תציע פגישות אחרי 18:00')

    const own = await buildRelevantMemoryBlock(getDb(), { texts: [''], agentId: OPT })
    expect(own.block).toContain('### כללים לסוכן הזה')
    expect(own.block).toContain('אל תציע פגישות אחרי 18:00')
    const other = await buildRelevantMemoryBlock(getDb(), { texts: [''], agentId: PREP })
    expect(other.block).not.toContain('אל תציע פגישות אחרי 18:00')

    const [fb] = await getDb().select().from(agentFeedback).where(eq(agentFeedback.id, row.id))
    expect(fb.status).toBe('applied')
    expect(await listAgentFeedback(getDb(), { agentId: OPT })).toHaveLength(0)
  })

  it('disabled rules are not injected, and rejecting leaves no rule', async () => {
    const row = await recordAgentFeedback(getDb(), { agentId: OPT, feedback: 'x' }, async () => null)
    const { memoryId } = await applyAgentFeedback(getDb(), row.id, 'כלל א')
    await setAgentRuleEnabled(getDb(), memoryId, false)
    expect((await buildRelevantMemoryBlock(getDb(), { texts: [''], agentId: OPT })).block).not.toContain('כלל א')
    expect((await listAgentRules(getDb(), OPT))[0].enabled).toBe(false)

    const other = await recordAgentFeedback(getDb(), { agentId: OPT, feedback: 'y' }, async () => null)
    await rejectAgentFeedback(getDb(), other.id)
    expect(await listAgentRules(getDb(), OPT)).toHaveLength(1)
  })

  it('caps agent rules at AGENT_RULE_CAP', async () => {
    for (let i = 0; i < AGENT_RULE_CAP + 2; i++) {
      const row = await recordAgentFeedback(getDb(), { agentId: OPT, feedback: `f${i}` }, async () => null)
      await applyAgentFeedback(getDb(), row.id, `כלל מספר ${i}`)
    }
    const res = await buildRelevantMemoryBlock(getDb(), { texts: [''], agentId: OPT })
    expect(res.block.match(/כלל מספר/g)).toHaveLength(AGENT_RULE_CAP)
  })
})

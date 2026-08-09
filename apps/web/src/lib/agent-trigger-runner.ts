import { agentSchedules, getDb } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import {
  importIBKREmails,
  formatImportReport,
  markAgentRan,
  parseJsonTimes,
  resolveAgentDisplayName,
  wasAgentRunInSlot,
} from '@ak-system/api'
import {
  getDefaultTriggerMessage,
  getAgentEngine,
} from './abc-agents'
import { getAgentHistory, saveAgentMessage } from './agent-chat-store'
import { runAgentForUser } from './agent-runner'
import { pushAssistantMessage } from './push-notifications'

async function resolveTriggerMessage(agentId: string): Promise<string> {
  const db = getDb()
  const rows = await db
    .select()
    .from(agentSchedules)
    .where(eq(agentSchedules.agentId, agentId))
    .limit(1)
  const custom = rows[0]?.triggerMessage?.trim()
  if (custom) return custom
  return getDefaultTriggerMessage(agentId)
}

const IBKR_AGENT_ID = '05_ibkr_daily_import'

/**
 * IBKR daily import runs as deterministic code (Gmail → finance_trades), not
 * through the LLM. This keeps the import working even when the Gemini engine is
 * unavailable or overloaded.
 */
async function runIbkrImportTrigger(agentId: string): Promise<{
  ok: boolean
  text?: string
  error?: string
}> {
  const agentName = await resolveAgentDisplayName(agentId)
  try {
    await saveAgentMessage(agentId, 'user', await resolveTriggerMessage(agentId))
    const result = await importIBKREmails({ maxEmails: 100 })
    const text = formatImportReport(result)

    await saveAgentMessage(agentId, 'assistant', text)
    await pushAssistantMessage(`🤖 ${agentName}\n\n${text}`, 'cron', {
      title: `${agentName} — סיים`,
      url: `/agents?agent=${encodeURIComponent(agentId)}`,
      typeId: 'agent_run',
    })
    await markAgentRan(agentId, 'ok')
    return { ok: true, text }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'IBKR import failed'
    console.error('[runIbkrImportTrigger]', err)
    await markAgentRan(agentId, 'error', msg.slice(0, 500))
    return { ok: false, error: msg }
  }
}

/** Run an ABC agent from a trigger (manual or cron). */
export async function runAgentTrigger(agentId: string): Promise<{
  ok: boolean
  text?: string
  error?: string
}> {
  if (agentId === IBKR_AGENT_ID) {
    return runIbkrImportTrigger(agentId)
  }

  if (getAgentEngine() !== 'gemini') {
    return {
      ok: false,
      error: 'טריגרים אוטומטיים זמינים רק עם מנוע Gemini',
    }
  }

  const message = await resolveTriggerMessage(agentId)

  try {
    // Keep scheduled runs isolated from prior chat: with 20 messages of history,
    // yesterday's malformed output became today's few-shot example. 3 turns are
    // enough for continuity without format contamination.
    const history = (await getAgentHistory(agentId, 3))
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }))

    await saveAgentMessage(agentId, 'user', message)

    const result = await runAgentForUser({
      agentId,
      message,
      history,
      channel: 'cron',
    })

    await saveAgentMessage(agentId, 'assistant', result.text)

    const agentName = await resolveAgentDisplayName(agentId)
    const pushText = `🤖 ${agentName}\n\n${result.text}`
    await pushAssistantMessage(pushText, 'cron', {
      title: `${agentName} — סיים`,
      url: `/agents?agent=${encodeURIComponent(agentId)}`,
      typeId: 'agent_run',
    })

    await markAgentRan(agentId, 'ok')

    return { ok: true, text: result.text }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Agent trigger failed'
    console.error('[runAgentTrigger]', agentId, err)
    await markAgentRan(agentId, 'error', msg.slice(0, 500))
    return { ok: false, error: msg }
  }
}

export { parseJsonTimes, wasAgentRunInSlot }

import { agentTriggers, getDb } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { importIBKREmails, formatImportReport, resolveAgentDisplayName } from '@ak-system/api'
import {
  getDefaultTriggerMessage,
  getAgentEngine,
} from './abc-agents'
import { getAgentHistory, saveAgentMessage } from './agent-chat-store'
import { runAgentForUser } from './agent-runner'
import { pushAssistantMessage } from './push-notifications'

function parseJsonTimes(raw: string | null | undefined): string[] {
  if (!raw) return []
  try {
    const v = JSON.parse(raw) as unknown
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

async function resolveTriggerMessage(agentId: string): Promise<string> {
  const db = getDb()
  const rows = await db
    .select()
    .from(agentTriggers)
    .where(eq(agentTriggers.agentId, agentId))
    .limit(1)
  const custom = rows[0]?.triggerMessage?.trim()
  if (custom) return custom
  return getDefaultTriggerMessage(agentId)
}

async function updateRunStatus(
  agentId: string,
  status: 'ok' | 'error',
  error?: string,
): Promise<void> {
  const db = getDb()
  const now = new Date().toISOString()
  const existing = await db
    .select()
    .from(agentTriggers)
    .where(eq(agentTriggers.agentId, agentId))
    .limit(1)

  if (existing[0]) {
    await db
      .update(agentTriggers)
      .set({
        lastRunAt: now,
        lastRunStatus: status,
        lastRunError: error ?? null,
        updatedAt: now,
      })
      .where(eq(agentTriggers.agentId, agentId))
  } else {
    await db.insert(agentTriggers).values({
      agentId,
      enabled: false,
      scheduleTimes: '[]',
      triggerMessage: null,
      lastRunAt: now,
      lastRunStatus: status,
      lastRunError: error ?? null,
      updatedAt: now,
    })
  }
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
    await updateRunStatus(agentId, 'ok')
    return { ok: true, text }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'IBKR import failed'
    console.error('[runIbkrImportTrigger]', err)
    await updateRunStatus(agentId, 'error', msg.slice(0, 500))
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
    const history = (await getAgentHistory(agentId, 20))
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

    await updateRunStatus(agentId, 'ok')

    return { ok: true, text: result.text }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Agent trigger failed'
    console.error('[runAgentTrigger]', agentId, err)
    await updateRunStatus(agentId, 'error', msg.slice(0, 500))
    return { ok: false, error: msg }
  }
}

/** Whether this agent already ran successfully for the given calendar day + HH:MM slot. */
export function wasAgentRunInSlot(
  lastRunAt: string | null | undefined,
  slot: string,
  timezone: string,
): boolean {
  if (!lastRunAt) return false
  try {
    const runDate = new Date(lastRunAt)
    const runSlot = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).format(runDate)
    const runDay = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(runDate)

    const now = new Date()
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now)

    return runDay === today && runSlot === slot && lastRunAt !== null
  } catch {
    return false
  }
}

export { parseJsonTimes }

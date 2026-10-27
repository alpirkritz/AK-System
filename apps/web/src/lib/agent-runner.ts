import type { ChatTurn } from './gemini-agent-engine'
import { runGeminiAgentChat } from './gemini-agent-engine'
import { notifyAgentRunComplete, type AgentNotifyChannel } from './agent-notifications'
import { HUGO_AGENT_ID } from './abc-agents'
import { getAgentHistory, saveAgentMessage } from './agent-chat-store'

/** How many prior turns of Hugo's thread to replay as context. */
const HUGO_HISTORY_TURNS = 20

/** Run a specialist agent and deliver results on the active channel (+ Notion archive). */
export async function runAgentForUser(options: {
  agentId: string
  message: string
  history?: ChatTurn[]
  channel: AgentNotifyChannel
  /**
   * Whether this call owns the completion push. The cron and event paths send
   * their own, with an event-specific title and deep link, so they pass false —
   * otherwise one run reaches the user as two identical notifications.
   */
  notifyOnComplete?: boolean
  /** ISO date for the calendar context (06_calendar_optimizer scheduled runs only). */
  calendarPlanDate?: string
}): Promise<{ text: string }> {
  const result = await runGeminiAgentChat({
    agentId: options.agentId,
    message: options.message,
    history: options.history,
    channel: options.channel,
    calendarPlanDate: options.calendarPlanDate,
  })

  notifyAgentRunComplete({
    agentId: options.agentId,
    summary: result.text,
    channel: options.channel,
    push: options.notifyOnComplete ?? true,
  }).catch((err) => console.warn('[runAgentForUser] notify failed:', err))

  return result
}

/**
 * Talk to Hugo — the assistant behind every conversational surface (web chat,
 * Telegram, WhatsApp). All of them read and write the one thread stored under
 * `HUGO_AGENT_ID`, so context carries across channels instead of each surface
 * keeping a private history.
 *
 * Replaces the former nameless general assistant, which had its own inline prompt
 * and its own history; every behaviour rule had to be written twice and drifted.
 */
export async function runHugoConversation(options: {
  message: string
  channel: AgentNotifyChannel
  /**
   * Interactive surfaces deliver the reply themselves and must pass false — the user
   * is already looking at it, and a push would be a duplicate.
   */
  notifyOnComplete?: boolean
}): Promise<{ text: string }> {
  const history = (await getAgentHistory(HUGO_AGENT_ID, HUGO_HISTORY_TURNS))
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  await saveAgentMessage(HUGO_AGENT_ID, 'user', options.message)

  const result = await runAgentForUser({
    agentId: HUGO_AGENT_ID,
    message: options.message,
    history,
    channel: options.channel,
    notifyOnComplete: options.notifyOnComplete,
  })

  await saveAgentMessage(HUGO_AGENT_ID, 'assistant', result.text)
  return result
}

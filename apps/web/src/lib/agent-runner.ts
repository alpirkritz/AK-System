import type { ChatTurn } from './gemini-agent-engine'
import { runGeminiAgentChat } from './gemini-agent-engine'
import { notifyAgentRunComplete, type AgentNotifyChannel } from './agent-notifications'

/** Run a specialist agent and deliver results on the active channel (+ Notion archive). */
export async function runAgentForUser(options: {
  agentId: string
  message: string
  history?: ChatTurn[]
  channel: AgentNotifyChannel
}): Promise<{ text: string }> {
  const result = await runGeminiAgentChat({
    agentId: options.agentId,
    message: options.message,
    history: options.history,
    channel: options.channel,
  })

  notifyAgentRunComplete({
    agentId: options.agentId,
    summary: result.text,
    channel: options.channel,
  }).catch((err) => console.warn('[runAgentForUser] notify failed:', err))

  return result
}

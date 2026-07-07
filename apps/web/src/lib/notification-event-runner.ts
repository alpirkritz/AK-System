import { getDefaultTriggerMessage, getNotificationRouting } from '@ak-system/api'
import { getAgentDisplayName } from './abc-agents'
import { runAgentForUser } from './agent-runner'
import { pushAssistantMessage } from './push-notifications'

interface EventAgentOptions {
  /** Extra context appended to the agent prompt (e.g. meeting details, due tasks). */
  context?: string
  /** Deep-link path for the delivered push (default: /chat). */
  url?: string
}

/**
 * If the event type is routed to an ABC agent, run that agent and deliver its
 * output via the notification fan-out. Returns the agent text, or `null` when
 * the event is not routed — in which case the caller runs its built-in template.
 */
export async function runEventAgentIfRouted(
  typeId: string,
  options?: EventAgentOptions,
): Promise<string | null> {
  const { agentId, triggerMessage } = await getNotificationRouting(typeId)
  if (!agentId) return null

  const base = triggerMessage || getDefaultTriggerMessage(agentId)
  const message = options?.context ? `${base}\n\n${options.context}` : base

  const result = await runAgentForUser({ agentId, message, channel: 'cron' })

  const agentName = getAgentDisplayName(agentId)
  await pushAssistantMessage(`🤖 ${agentName}\n\n${result.text}`, 'cron', {
    title: `${agentName} — ${typeId}`,
    url: options?.url ?? '/chat',
    typeId,
  })

  return result.text
}

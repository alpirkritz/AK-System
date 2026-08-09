import {
  getDefaultTriggerMessage,
  getNotificationRouting,
  hasAgentRunInSlot,
  markAgentRan,
  resolveAgentDisplayName,
} from '@ak-system/api'
import { runAgentForUser } from './agent-runner'
import { pushAssistantMessage } from './push-notifications'

interface EventAgentOptions {
  /** Extra context appended to the agent prompt (e.g. meeting details, due tasks). */
  context?: string
  /** Deep-link path for the delivered push (default: /chat). */
  url?: string
  /**
   * Current HH:MM slot. Pass this for once-per-slot digests so the agent stands
   * down when its own clock schedule already ran it in this slot. Omit for
   * per-item events (pre-meeting prep runs once per meeting).
   */
  dedupeSlot?: string
  /** Timezone for `dedupeSlot` comparison. Defaults to TIMEZONE / Asia/Jerusalem. */
  timezone?: string
}

export type EventAgentOutcome =
  /** No agent is routed to this event — the caller should run its built-in template. */
  | { status: 'not_routed' }
  | { status: 'ran'; agentId: string; text: string }
  /** The agent already ran in this slot via its clock schedule; nothing was sent. */
  | { status: 'skipped_duplicate'; agentId: string }

/**
 * If the event type is routed to an ABC agent, run that agent and deliver its
 * output via the notification fan-out.
 *
 * Every run is stamped on the agent's schedule row, so the scheduled-agents cron
 * skips an agent an event already ran this slot — that plus `dedupeSlot` is what
 * keeps an agent wired to both a schedule and an event from firing twice.
 */
export async function runEventAgentIfRouted(
  typeId: string,
  options?: EventAgentOptions,
): Promise<EventAgentOutcome> {
  const { agentId, triggerMessage } = await getNotificationRouting(typeId)
  if (!agentId) return { status: 'not_routed' }

  if (options?.dedupeSlot) {
    const timezone = options.timezone ?? process.env.TIMEZONE ?? 'Asia/Jerusalem'
    if (await hasAgentRunInSlot(agentId, options.dedupeSlot, timezone)) {
      console.log(`[event-agent] ${typeId}: ${agentId} already ran in slot ${options.dedupeSlot}`)
      return { status: 'skipped_duplicate', agentId }
    }
  }

  const base = triggerMessage || getDefaultTriggerMessage(agentId)
  const message = options?.context ? `${base}\n\n${options.context}` : base

  try {
    const result = await runAgentForUser({ agentId, message, channel: 'cron' })

    const agentName = await resolveAgentDisplayName(agentId)
    await pushAssistantMessage(`🤖 ${agentName}\n\n${result.text}`, 'cron', {
      title: `${agentName} — ${typeId}`,
      url: options?.url ?? '/chat',
      typeId,
    })

    await markAgentRan(agentId, 'ok')
    return { status: 'ran', agentId, text: result.text }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Event agent failed'
    console.error('[event-agent]', typeId, agentId, err)
    await markAgentRan(agentId, 'error', msg.slice(0, 500))
    throw err
  }
}

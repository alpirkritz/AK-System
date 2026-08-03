import fs from 'fs'
import path from 'path'
import { getAbcRootPath } from './abc-agents'

const MEMORY_FILE = 'agents_daily_sync.md'

export type AgentFeedbackEntry = {
  agentId: string
  feedback: string
  /** Where the correction came from, for traceability in the log. */
  channel?: string
}

export type AgentFeedbackResult = {
  logged: true
  agentId: string
  path: string
}

function memoryFilePath(): string {
  return path.join(getAbcRootPath(), 'M_Memory', MEMORY_FILE)
}

function todayStamp(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Appends a user-submitted correction to `M_Memory/agents_daily_sync.md` for human review.
 *
 * Deliberately never touches `A_Agents/*.md` — agent behavior stays human-curated
 * (.cursorrules Rule 3: M_Memory is append-only, agent cards are not machine-edited).
 */
export function appendAgentFeedback(entry: AgentFeedbackEntry): AgentFeedbackResult {
  const agentId = path.basename(entry.agentId ?? '').trim()
  if (!agentId || agentId !== entry.agentId?.trim() || agentId.includes('..')) {
    throw new Error(`Invalid agent id: ${entry.agentId}`)
  }
  const feedback = entry.feedback?.trim()
  if (!feedback) throw new Error('feedback is required')

  const filePath = memoryFilePath()
  const dir = path.dirname(filePath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  const source = entry.channel ? ` (${entry.channel})` : ''
  const block = [
    '',
    '---',
    '',
    `## ${todayStamp()} — ${agentId} — User correction (pending review)`,
    '',
    '**Workflow:** User feedback via ARO chat — no workflow step',
    '**Status:** Blocked',
    '',
    '### Stand-up',
    `- **Goal:** Route a user-reported correction to ${agentId} for human review.`,
    `- **Context:** Submitted by the user in chat${source}. Verbatim, not interpreted.`,
    '',
    '### Actions Taken',
    '1. Logged the correction verbatim below. No agent card was modified.',
    '',
    '### Feedback (verbatim)',
    `> ${feedback.split('\n').join('\n> ')}`,
    '',
    '### Compliance',
    '- [x] Append-only — no existing entry overwritten',
    `- [x] \`A_Agents/${agentId}.md\` NOT edited automatically`,
    '',
    '### Blockers / Escalations',
    `- Pending human review: decide whether this becomes a change to \`A_Agents/${agentId}.md\` or its workflow.`,
    '',
  ].join('\n')

  fs.appendFileSync(filePath, block, 'utf-8')

  return { logged: true, agentId, path: path.join('M_Memory', MEMORY_FILE) }
}

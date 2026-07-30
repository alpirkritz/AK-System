import { Agent } from '@cursor/sdk'
import type { SDKAgent } from '@cursor/sdk'
import {
  agentNeedsNotionContext,
  getAbcRootPath,
  getAgentInstructions,
} from './abc-agents'
import { formatNotionContextForPrompt, getNotionContext } from './notion'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface RunAgentResult {
  text: string
  cursorAgentId: string
}

function getCursorApiKey(): string {
  const key = process.env.CURSOR_API_KEY
  if (!key) throw new Error('CURSOR_API_KEY is not set')
  return key
}

function getModelId(): string {
  return process.env.CURSOR_AGENT_MODEL ?? 'composer-2.5'
}

function formatDateLabel(): string {
  const today = new Date()
  return today.toLocaleDateString('he-IL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

async function buildPrompt(
  agentId: string,
  userMessage: string,
  history: ChatTurn[],
): Promise<string> {
  const instructions = getAgentInstructions(agentId)
  const parts: string[] = [
    `You are operating as ABC agent \`${agentId}\`.`,
    `Today is ${formatDateLabel()} (${new Date().toISOString().split('T')[0]}).`,
    `Repository root (ABC workspace): ${getAbcRootPath()}`,
    '',
    'Your FULL response is delivered directly in ARO chat (web or mobile). Do NOT redirect the user to Notion as the only output channel.',
    'Notion archiving is handled by the platform. Give a complete answer in this reply.',
    '',
    'Follow your agent instructions below. You may read files under A_Agents/, S_Skills/, B_Brain/, C_Core/, and stage outputs to O_Output/ when appropriate.',
    '',
    '---',
    '',
    instructions,
    '',
    '---',
  ]

  if (agentNeedsNotionContext(agentId)) {
    try {
      const ctx = await getNotionContext()
      parts.push(formatNotionContextForPrompt(ctx), '', '---', '')
    } catch (err) {
      parts.push(
        `_Notion context unavailable: ${err instanceof Error ? err.message : 'error'}_`,
        '',
        '---',
        '',
      )
    }
  }

  if (history.length > 0) {
    parts.push('## Recent conversation', '')
    for (const turn of history.slice(-8)) {
      parts.push(`**${turn.role}:** ${turn.content}`, '')
    }
    parts.push('---', '')
  }

  parts.push(`**user:** ${userMessage}`)
  return parts.join('\n')
}

async function disposeAgent(agent: SDKAgent): Promise<void> {
  try {
    if (typeof agent[Symbol.asyncDispose] === 'function') {
      await agent[Symbol.asyncDispose]()
    } else {
      agent.close()
    }
  } catch {
    agent.close()
  }
}

async function extractAssistantText(run: Awaited<ReturnType<SDKAgent['send']>>): Promise<string> {
  const result = await run.wait()
  if (result.status === 'error') {
    throw new Error(result.result ?? 'Cursor agent run failed')
  }
  if (result.result?.trim()) return result.result.trim()
  if (run.result?.trim()) return run.result.trim()
  return 'לא התקבלה תשובה מהסוכן.'
}

export async function runAgentChat(options: {
  agentId: string
  message: string
  cursorAgentId?: string | null
  history?: ChatTurn[]
}): Promise<RunAgentResult> {
  const apiKey = getCursorApiKey()
  const abcRoot = getAbcRootPath()
  const prompt = await buildPrompt(
    options.agentId,
    options.message,
    options.history ?? [],
  )

  let agent: SDKAgent
  if (options.cursorAgentId) {
    agent = await Agent.resume(options.cursorAgentId, {
      apiKey,
      local: { cwd: abcRoot },
    })
  } else {
    agent = await Agent.create({
      apiKey,
      model: { id: getModelId() },
      local: { cwd: abcRoot },
    })
  }

  try {
    const run = await agent.send(prompt)
    const text = await extractAssistantText(run)
    return { text, cursorAgentId: agent.agentId }
  } finally {
    await disposeAgent(agent)
  }
}

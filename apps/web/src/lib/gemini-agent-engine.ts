import { GoogleGenerativeAI, FunctionCallingMode } from '@google/generative-ai'
import {
  agentNeedsNotionContext,
  getAbcRootPath,
  getAgentInstructions,
  getAgentWorkflowContent,
} from './abc-agents'
import { createApiCaller, executeTool, toolDeclarations } from './conversation-engine'
import { formatNotionContextForPrompt, getNotionContext } from './notion'

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
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

function todayIso(): string {
  return new Date().toISOString().split('T')[0]!
}

async function buildSystemInstruction(agentId: string): Promise<string> {
  const instructions = getAgentInstructions(agentId)
  const workflow = getAgentWorkflowContent(agentId)
  const parts: string[] = [
    `You are operating as ABC agent \`${agentId}\` inside AK System.`,
    `Today is ${formatDateLabel()} (${todayIso()}).`,
    `ABC workspace root: ${getAbcRootPath()}`,
    '',
    'Follow your agent card instructions exactly. Recommendations only unless the user explicitly approves an action.',
    'Respond in the same language the user writes in: Hebrew for Hebrew, English for English.',
    'Be concise and structured. Use bullet points for lists.',
    'You have tools to read calendar, tasks, meetings, contacts, and more — use them when needed for your analysis.',
    '',
    '---',
    '',
    instructions,
    '',
    '---',
  ]

  if (workflow) {
    parts.push('', '## Applicable workflow (S_Skills)', '', workflow, '', '---')
  }

  if (agentNeedsNotionContext(agentId)) {
    try {
      const ctx = await getNotionContext()
      parts.push('', formatNotionContextForPrompt(ctx), '', '---')
    } catch (err) {
      parts.push(
        '',
        `_Notion context unavailable: ${err instanceof Error ? err.message : 'error'}_`,
        '',
        '---',
      )
    }
  }

  return parts.join('\n')
}

function buildHistoryContents(history: ChatTurn[]): Array<{ role: 'user' | 'model'; parts: [{ text: string }] }> {
  return history.slice(-8).map((turn) => ({
    role: turn.role === 'user' ? ('user' as const) : ('model' as const),
    parts: [{ text: turn.content }],
  }))
}

type ToolArgs = Record<string, unknown>

export async function runGeminiAgentChat(options: {
  agentId: string
  message: string
  history?: ChatTurn[]
}): Promise<{ text: string }> {
  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) throw new Error('GEMINI_API_KEY is not set')

  const genAI = new GoogleGenerativeAI(geminiKey)
  const caller = await createApiCaller()
  const systemInstruction = await buildSystemInstruction(options.agentId)

  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    systemInstruction,
    tools: [{ functionDeclarations: toolDeclarations }],
    toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } },
  })

  const history = options.history ?? []
  const chat = model.startChat({
    history: buildHistoryContents(history),
  })

  let result = await chat.sendMessage(options.message)

  let iterations = 0
  while (iterations < 10) {
    const calls = result.response.functionCalls()
    if (!calls || calls.length === 0) break

    const responses = await Promise.all(
      calls.map(async (call) => {
        let toolResult: unknown
        try {
          toolResult = await executeTool(call.name, call.args as ToolArgs, caller)
        } catch (err) {
          toolResult = { error: err instanceof Error ? err.message : 'Tool execution failed' }
        }
        return { functionResponse: { name: call.name, response: { result: toolResult } } }
      }),
    )

    result = await chat.sendMessage(responses)
    iterations++
  }

  const text = result.response.text()?.trim()
  return { text: text || 'לא התקבלה תשובה מהסוכן.' }
}

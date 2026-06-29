import { GoogleGenerativeAI, FunctionCallingMode } from '@google/generative-ai'
import {
  agentNeedsNotionContext,
  getAbcRootPath,
  getAgentInstructions,
  getAgentWorkflowContent,
  HUGO_AGENT_ID,
} from './abc-agents'
import { createApiCaller, executeTool, getToolDeclarations, type ToolExecutionContext } from './conversation-engine'
import {
  getGeminiModelOptions,
  getGeminiModelOptionsFast,
  sanitizeChatHistory,
  type ChatTurn,
} from './gemini-config'
import { formatNotionContextForPrompt, getNotionContext } from './notion'
import type { AgentNotifyChannel } from './agent-notifications'

export type { ChatTurn } from './gemini-config'

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

async function buildSystemInstruction(agentId: string, channel?: AgentNotifyChannel): Promise<string> {
  const instructions = getAgentInstructions(agentId)
  const workflow = getAgentWorkflowContent(agentId)
  const channelLabel =
    channel === 'whatsapp'
      ? 'WhatsApp (Message Yourself)'
      : channel === 'telegram'
        ? 'Telegram'
        : channel === 'web'
          ? 'AK System — ממשק הסוכנים (Web)'
          : 'AK System chat'

  const parts: string[] = [
    `You are operating as ABC agent \`${agentId}\` inside AK System.`,
    `Today is ${formatDateLabel()} (${todayIso()}).`,
    `ABC workspace root: ${getAbcRootPath()}`,
    '',
    `## Delivery channel: ${channelLabel}`,
    'Your FULL analysis and recommendations MUST appear in this chat reply — this is the primary output.',
    'Do NOT tell the user to check Notion Inbox or open Notion as the only way to see results.',
    'Notion archiving and push notifications are handled automatically by the platform after you respond.',
    'Use your tools (calendar, tasks, meetings, contacts, Gmail, WhatsApp, etc.) and deliver a complete answer here.',
    '',
    'Follow your agent card instructions exactly. Recommendations only unless the user explicitly approves an action.',
    'Respond in the same language the user writes in: Hebrew for Hebrew, English for English.',
    'Be concise and structured. Use bullet points for lists.',
    'You have tools to read calendar, tasks, meetings, contacts, Gmail, WhatsApp groups, and more — use them when needed for your analysis.',
    'For on-demand WhatsApp group summaries (סיכום וואטסאפ / daily digest), use summarize_whatsapp_groups.',
    '',
    '---',
    '',
    instructions,
    '',
    '---',
  ]

  if (agentId === HUGO_AGENT_ID) {
    parts.splice(
      8,
      0,
      '',
      '## Hugo orchestrator — primary interface',
      'You are the user\'s main assistant on this channel. Handle requests directly when you can (calendar, tasks, Gmail, WhatsApp status, WhatsApp group summaries).',
      '',
      '### Delegation rules (mandatory)',
      'This platform is **fully synchronous** — there is NO background follow-up message. You must finish the entire answer in this single reply.',
      'NEVER say you will update the user later (e.g. "אעדכן אותך", "אחזור אליך", "I\'ll get back to you", "I am activating agent X").',
      'For specialist workflows (morning brief/בוקר/הכנה ליום, calendar/יומן, meeting prep/פגישה, email/מייל, IBKR, startup COO): **call run_abc_agent immediately**, wait for the tool result, then synthesize the specialist output into your reply.',
      'Valid agentIds: `03_morning_briefing`, `04_meeting_prep_herald`, `06_calendar_optimizer`, `07_email_assistant`, `05_ibkr_daily_import`, `08_startup_coo`.',
      'The ONLY async exception is summarize_whatsapp_groups — those summaries arrive as separate WhatsApp messages; confirm status briefly in your reply.',
      '',
      'For calendar / יומן / schedule questions, delegate to run_abc_agent agentId 06_calendar_optimizer — call him **אופטי** (the calendar advisor) in your replies.',
      'For tasks, use Notion context (Dragontail/DT, CRM/Con, Personal To-do) plus get_open_tasks. For tomorrow\'s meetings prep, use run_abc_agent 04_meeting_prep_herald.',
      'WhatsApp bridge buffers group messages since last restart — summarize_whatsapp_groups covers buffered activity, not phone "unread" badges.',
      'Never tell the user to open another app or Notion to get the answer — deliver everything here.',
      '',
    )
  }

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
  return sanitizeChatHistory(history).map((turn) => ({
    role: turn.role === 'user' ? ('user' as const) : ('model' as const),
    parts: [{ text: turn.content }],
  }))
}

function isGeminiNetworkError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('fetch failed') || msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT')
}

const DEFERRAL_PATTERNS = [
  /אעדכן\s+(אותך|ברגע)/i,
  /אחזור\s+אליך/i,
  /ברגע\s+ש.{0,40}מוכנ/i,
  /מפעיל\s+את\s+סוכן/i,
  /מעביר\s+את\s+הבקשה/i,
  /i\s+will\s+update\s+you/i,
  /i'?ll\s+get\s+back\s+to\s+you/i,
  /i\s+am\s+(activating|delegating)/i,
  /passing\s+(your\s+)?request/i,
]

function looksLikeDeferredDelegation(text: string): boolean {
  return DEFERRAL_PATTERNS.some((p) => p.test(text))
}

const DELEGATION_RETRY_PROMPT =
  'CRITICAL: You promised a later update but this platform has NO async follow-up. ' +
  'Call run_abc_agent NOW with the correct agentId, wait for the tool result, then write the COMPLETE answer in this reply. ' +
  'Do not say you will update later. Use the same language as the user.'

type FunctionCall = { name: string; args: ToolArgs }

async function processToolCalls(
  calls: FunctionCall[],
  caller: Awaited<ReturnType<typeof createApiCaller>>,
  toolCtx: ToolExecutionContext | undefined,
  toolsCalled: Set<string>,
) {
  return Promise.all(
    calls.map(async (call) => {
      toolsCalled.add(call.name)
      let toolResult: unknown
      try {
        toolResult = await executeTool(call.name, call.args as ToolArgs, caller, toolCtx)
      } catch (err) {
        toolResult = { error: err instanceof Error ? err.message : 'Tool execution failed' }
      }
      return { functionResponse: { name: call.name, response: { result: toolResult } } }
    }),
  )
}

async function runToolLoop(
  chat: ReturnType<ReturnType<GoogleGenerativeAI['getGenerativeModel']>['startChat']>,
  initialResult: Awaited<ReturnType<typeof chat.sendMessage>>,
  caller: Awaited<ReturnType<typeof createApiCaller>>,
  toolCtx: ToolExecutionContext | undefined,
  toolsCalled: Set<string>,
  maxIterations: number,
): Promise<Awaited<ReturnType<typeof chat.sendMessage>>> {
  let result = initialResult
  let iterations = 0
  while (iterations < maxIterations) {
    const calls = result.response.functionCalls() as FunctionCall[] | undefined
    if (!calls || calls.length === 0) break
    const responses = await processToolCalls(calls, caller, toolCtx, toolsCalled)
    result = await chat.sendMessage(responses)
    iterations++
  }
  return result
}

async function runChatLoop(
  model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>,
  agentId: string,
  history: ChatTurn[],
  message: string,
  caller: Awaited<ReturnType<typeof createApiCaller>>,
  toolCtx: ToolExecutionContext | undefined,
): Promise<string> {
  const chat = model.startChat({ history: buildHistoryContents(history) })
  const toolsCalled = new Set<string>()
  let result = await runToolLoop(chat, await chat.sendMessage(message), caller, toolCtx, toolsCalled, 10)

  let text = extractResponseText(result)

  if (
    agentId === HUGO_AGENT_ID &&
    text &&
    looksLikeDeferredDelegation(text) &&
    !toolsCalled.has('run_abc_agent')
  ) {
    console.warn('[GeminiAgent] Hugo deferred without run_abc_agent — forcing retry')
    result = await runToolLoop(
      chat,
      await chat.sendMessage(DELEGATION_RETRY_PROMPT),
      caller,
      toolCtx,
      toolsCalled,
      5,
    )
    text = extractResponseText(result)
  }

  if (!text && toolsCalled.size > 0) {
    result = await chat.sendMessage(
      'Based on the tool results above, write your complete answer to the user now. Use the same language as the user. Do not call any more tools.',
    )
    text = extractResponseText(result)
  }

  return text || 'לא התקבלה תשובה מהסוכן.'
}

type ToolArgs = Record<string, unknown>

function extractResponseText(result: { response: { text: () => string } }): string {
  try {
    return result.response.text()?.trim() ?? ''
  } catch {
    return ''
  }
}

export async function runGeminiAgentChat(options: {
  agentId: string
  message: string
  history?: ChatTurn[]
  channel?: AgentNotifyChannel
}): Promise<{ text: string }> {
  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) throw new Error('GEMINI_API_KEY is not set')

  const genAI = new GoogleGenerativeAI(geminiKey)
  const caller = await createApiCaller()
  const toolCtx: ToolExecutionContext | undefined = options.channel
    ? { channel: options.channel }
    : undefined
  const systemInstruction = await buildSystemInstruction(options.agentId, options.channel)
  const history = options.history ?? []

  const buildModel = (modelOpts: ReturnType<typeof getGeminiModelOptions>) =>
    genAI.getGenerativeModel({
      ...modelOpts,
      systemInstruction,
      tools: [{ functionDeclarations: getToolDeclarations() }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } },
    })

  try {
    return { text: await runChatLoop(buildModel(getGeminiModelOptions()), options.agentId, history, options.message, caller, toolCtx) }
  } catch (err) {
    if (!isGeminiNetworkError(err)) throw err
    console.warn('[GeminiAgent] extended thinking failed, retrying without thinking:', err)
    return {
      text: await runChatLoop(buildModel(getGeminiModelOptionsFast()), options.agentId, history, options.message, caller, toolCtx),
    }
  }
}

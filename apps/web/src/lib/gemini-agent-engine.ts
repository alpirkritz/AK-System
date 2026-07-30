import { GoogleGenerativeAI, FunctionCallingMode } from '@google/generative-ai'
import {
  agentNeedsCalendarContext,
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
import { getMemoryPromptBlock } from './agent-memory'
import type { AgentNotifyChannel } from './agent-notifications'
import { getAgentCalendarScopePromptBlock, localTodayIso, getAgentCalendarContext, formatAgentCalendarContextForPrompt } from '@ak-system/api'

export type { ChatTurn } from './gemini-config'

export const CALENDAR_OPTIMIZER_AGENT_ID = '06_calendar_optimizer'
export const MEETING_PREP_AGENT_ID = '04_meeting_prep_herald'

/** Hard override: Notion-parity brief on every channel (WhatsApp / Telegram / ARO). */
export function getCalendarOptimizerBriefOverride(): string {
  return [
    '## Calendar Optimizer — Notion-parity brief (MANDATORY — overrides conflicting card/workflow table instructions)',
    'PRIMARY DATA SOURCE: ARO-connected calendars (prefetched calendar context + calendar tools). Notion is OPTIONAL enrichment for Reminders only.',
    'If Notion is missing or fails: still deliver the FULL calendar brief from calendar data. NEVER refuse or say you depend on Notion.',
    'Write a rich daily calendar brief matching Notion Calendar Optimizer depth. Use headings + bullets.',
    'NEVER use Markdown tables (| ... | or |---|). NEVER narrate standing instructions, memory updates, or "I understood / מעתה אתעלם / הוראה זו נוספה" in the reply.',
    'NEVER repeat the same analysis twice. Meeting context ≤20 words; never paste full task bodies.',
    'Match the user language (Hebrew ↔ English). Required sections IN ORDER:',
    '1) Title: Daily Calendar Summary — <weekday, date> (or סיכום יומן יומי — …)',
    '2) Quick Summary / סיכום מהיר — 3–5 bullets: conflicts yes/no, back-to-back, load (hours + light/manageable/heavy or קל/סביר/עמוס), optional day context',
    '3) Today\'s Meetings / הפגישות להיום — one bullet per timed event: `HH:MM–HH:MM — Title` + duration + short context (attendees/team/organizer/calendar). Do not omit events (except all-day / ≥8h).',
    '4) Conflicts & Overlaps / קונפליקטים וחפיפות — explicit None/אין when clean; else list real conflicts and awareness overlaps (incl. zero-buffer back-to-back)',
    '5) Load Analysis / ניתוח עומס — total hours vs 4h threshold + main free windows',
    '6) Focus Time Opportunities / חלונות פוקוס — 1–3 concrete windows with start–end + one-line suggestion',
    '7) Reminders / תזכורות (optional) — only if grounded in calendar/tasks/Notion/memory; skip section if empty; never invent',
    '8) Recommendations / המלצות (optional, ≤3) — only for real conflict/overload actions, with 2–3 alt slots when suggesting a move',
  ].join('\n')
}

/** Hard override: only meeting-related tasks; never dump the full backlog. */
export function getMeetingPrepRelatedTasksOverride(): string {
  return [
    '## Meeting Prep — related tasks only (MANDATORY)',
    'For each meeting, list ONLY open tasks that clearly relate to that meeting (person / company / project / topic / explicit link).',
    'If none relate: on WhatsApp/cron/Telegram OMIT the related-actions section entirely; on web you may write "לא נמצאו משימות קשורות לפגישה זו".',
    'NEVER dump the user\'s full open-task backlog as filler or "for context".',
    'Keep WhatsApp / Telegram / ARO briefs short and purposeful — no Markdown tables, no unrelated task lists.',
  ].join('\n')
}

/**
 * Hard override: Notion-quality single-meeting prep on outbound channels.
 * Bans pasting calendar invite fluff; requires grounded talk-about / stance / actions.
 */
export function getMeetingPrepNotionParityOverride(): string {
  return [
    '## Meeting Prep — Notion-parity brief (MANDATORY — overrides conflicting card paste habits)',
    'Focus on the ONE meeting named in the user message / context block (pre-meeting cron or tagged ask).',
    'NEVER paste, quote, or lightly paraphrase the calendar event description / Outlook invite (From/Sent/To/Cc/Subject/When) / Teams "Need help?" / dial-in / mission-statement fluff.',
    'You MUST call tools for real context: at least get_notion_tasks and get_notion_meeting_notes; add people/projects/companies/search_notion when useful. Grounding rules still apply — no invention.',
    'Write a skimmable brief matching Notion Meeting Prep quality. No Markdown tables. No meta narration ("I understood…").',
    'Omit any section that has nothing grounded. Prefer Hebrew or English to match the user/trigger.',
    'Required shape when data exists:',
    '1) Header — title, time, location, participants (names only, ≤8 + ועוד N if needed)',
    '2) What you should talk about / על מה לדבר — 3–6 numbered concrete topics grounded in notes/tasks (ownership, decisions, open gaps)',
    '3) Your recommended stance / עמדה מומלצת — optional; label clearly as המלצה — לא מהנתונים; omit if no factual basis',
    '4) Also relevant / גם רלוונטי — related open action items only; omit section if none',
  ].join('\n')
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
  return localTodayIso()
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
          ? 'ARO — ממשק הסוכנים (Web)'
          : 'ARO chat'

  const parts: string[] = [
    `You are operating as ABC agent \`${agentId}\` inside ARO.`,
    `Today is ${formatDateLabel()} (${todayIso()}).`,
    `ABC workspace root: ${getAbcRootPath()}`,
    '',
    `## Delivery channel: ${channelLabel}`,
    'Your FULL analysis and recommendations MUST appear in this chat reply — this is the primary output.',
    'Do NOT tell the user to check Notion Inbox or open Notion as the only way to see results.',
    'Notion archiving and push notifications are handled automatically by the platform after you respond.',
    'Use your tools (calendar, tasks, meetings, contacts, Gmail, WhatsApp, etc.) and deliver a complete answer here.',
    'If calendar tools return `calendarErrors`, report the connection problem — never describe the day as empty when errors are present.',
    '',
    'Follow your agent card instructions exactly. Recommendations only unless the user explicitly approves an action.',
    'Respond in the same language the user writes in: Hebrew for Hebrew, English for English.',
    'Be concise and structured. Use bullet points for lists.',
    'You have tools to read calendar, tasks, meetings, contacts, Gmail, WhatsApp groups, and more — use them when needed for your analysis.',
    'For on-demand WhatsApp group summaries (סיכום וואטסאפ / daily digest), use summarize_whatsapp_groups and include the returned summary text directly in your reply.',
    '',
  ]

  if (agentId === CALENDAR_OPTIMIZER_AGENT_ID) {
    parts.push(getCalendarOptimizerBriefOverride(), '')
  }

  if (agentId === MEETING_PREP_AGENT_ID) {
    parts.push(getMeetingPrepRelatedTasksOverride(), '')
    if (channel === 'whatsapp' || channel === 'telegram' || channel === 'cron') {
      parts.push(getMeetingPrepNotionParityOverride(), '')
    }
  }

  parts.push(
    '---',
    '',
    instructions,
    '',
    '---',
  )

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
      'summarize_whatsapp_groups returns the summary text inline (from stored history) — include it directly in your reply. Do NOT tell the user it will arrive as a separate message.',
      '',
      'For calendar / יומן / schedule questions, delegate to run_abc_agent agentId 06_calendar_optimizer — call him **אופטי** (the calendar advisor) in your replies.',
      'When folding אופטי / calendar optimizer output into your reply: pass the Notion-parity brief through almost verbatim — do NOT add a long preamble, do NOT re-analyze, do NOT wrap it in Markdown tables.',
      'Notion access: you CAN read Notion across ALL connected accounts via tools — get_notion_meetings (meetings), get_notion_tasks (tasks), search_notion (find an item), notion_status (diagnose access). NEVER tell the user you have no access to Notion; if a database fails, call notion_status and say which database needs to be shared with the integration.',
      'For daily prep / "תכין אותי ליום" / "מה יש לי היום": call get_notion_meetings and get_notion_tasks (both accounts) and fold them into your answer, in addition to calendar/tasks tools.',
      'For tasks, use Notion (get_notion_tasks + the injected Notion context: Dragontail/DT, CRM/Con, Personal To-do) plus get_open_tasks. For tomorrow\'s meetings prep, use run_abc_agent 04_meeting_prep_herald.',
      'summarize_whatsapp_groups summarizes stored group history (not phone "unread" badges); if there is no recent activity it will say so — never claim the system is busy.',
      'Never tell the user to open another app or Notion to get the answer — deliver everything here.',
      '',
    )
  }

  if (workflow) {
    parts.push('', '## Applicable workflow (S_Skills)', '', workflow, '', '---')
  }

  const memoryBlock = await getMemoryPromptBlock()
  if (memoryBlock) {
    parts.push('', memoryBlock, '', '---')
  }

  const calendarScopeBlock = await getAgentCalendarScopePromptBlock()
  if (calendarScopeBlock) {
    parts.push('', calendarScopeBlock, '', '---')
  }

  if (agentNeedsCalendarContext(agentId)) {
    try {
      const calCtx = await getAgentCalendarContext({
        forCalendarOptimizer: agentId === CALENDAR_OPTIMIZER_AGENT_ID,
      })
      parts.push('', formatAgentCalendarContextForPrompt(calCtx), '', '---')
    } catch (err) {
      parts.push(
        '',
        `_Google Calendar context unavailable: ${err instanceof Error ? err.message : 'error'}_`,
        '',
        '---',
      )
    }
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

/** Exported for prompt-contract tests. */
export async function buildAgentSystemInstruction(
  agentId: string,
  channel?: AgentNotifyChannel,
): Promise<string> {
  return buildSystemInstruction(agentId, channel)
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

/** Tools that provide real meeting-prep data. If none was called, the briefing is ungrounded. */
const MEETING_PREP_GROUNDING_TOOLS = [
  'get_notion_tasks',
  'get_notion_meeting_notes',
  'get_notion_people',
  'get_notion_projects',
  'get_notion_companies',
  'get_notion_meetings',
  'get_next_meeting_brief',
  'search_notion',
]

const MEETING_PREP_GROUNDING_RETRY_PROMPT =
  'STOP — do not invent meeting-prep content. You have not called any data tool yet. ' +
  'Call get_notion_tasks and get_notion_meeting_notes now (and get_notion_people / ' +
  'get_notion_projects / get_notion_companies for a focused meeting), then brief ONLY from ' +
  'those tool results and the injected context. Never infer participants from the meeting ' +
  'title. For any missing datum write "לא נמצא בנתונים" instead of guessing. ' +
  'For tasks: include ONLY items related to that meeting; if none, write ' +
  '"לא נמצאו משימות קשורות לפגישה זו" — NEVER dump the full open backlog. ' +
  'Reply in the same language as the user.'

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

  // Meeting Prep Herald must ground its briefing in real data. If it answered without
  // calling any data tool, force a single grounding retry before returning.
  if (
    agentId === MEETING_PREP_AGENT_ID &&
    !MEETING_PREP_GROUNDING_TOOLS.some((t) => toolsCalled.has(t))
  ) {
    console.warn('[GeminiAgent] Meeting prep answered without a data tool — forcing grounding retry')
    result = await runToolLoop(
      chat,
      await chat.sendMessage(MEETING_PREP_GROUNDING_RETRY_PROMPT),
      caller,
      toolCtx,
      toolsCalled,
      5,
    )
    text = extractResponseText(result)
  }

  if (!text && toolsCalled.size > 0) {
    result = await chat.sendMessage(
      'Based on the tool results above, write your complete answer to the user now. ' +
        'Use ONLY facts present in the tool results or injected context; if a datum is missing, ' +
        'say it is missing (write "לא נמצא בנתונים") rather than inventing it. ' +
        'Use the same language as the user. Do not call any more tools.',
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

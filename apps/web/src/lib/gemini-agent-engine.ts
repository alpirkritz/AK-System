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

  // Universal outbound-channel formatting guard — applies to EVERY agent, not
  // only 04/06 (the email assistant used to emit Markdown tables into WhatsApp).
  if (channel === 'whatsapp' || channel === 'telegram' || channel === 'cron') {
    parts.push(
      '## Channel formatting (MANDATORY on WhatsApp / Telegram / cron delivery)',
      'NEVER use Markdown tables (| ... | or |---|) — they do not render on these channels. Use short grouped bullet lines instead.',
      'Keep output concise and phone-skimmable. No meta-narration, no announcing agents or workflow steps, no "I understood / הוראה נקלטה".',
      'Write in Hebrew unless the user/trigger message is in English.',
      '',
    )
  }

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
      '## Chief of Staff — primary interface',
      'You are the user\'s wise Chief of Staff (ראש מטה) — not a switchboard. Own the recommendation. Specialists are staff inputs only.',
      '',
      '### Judgment contract (mandatory)',
      'Every reply you deliver must include: (1) מה חשוב עכשיו — 1–3 grounded bullets, (2) למה — one short line each, (3) המלצה — one primary next step, (4) מה לא לטפל עכשיו — optional. Decision-needed: Context / Impact / recommended path + 1–2 alternatives. Zero filler.',
      'Never ship a specialist dump as the whole reply. Keep specialist facts; CoS judgment is mandatory (at least 2–4 judgment lines after any run_abc_agent).',
      '',
      '### Multi-source scan (vague asks)',
      'On מה חשוב / מה המצב / תעזור לי / תכין אותי / similar vague intent: call at least TWO of YOUR OWN tools from DIFFERENT domains before answering. Do NOT call run_abc_agent as the first action.',
      '### Date grounding (CRITICAL — מחר / tomorrow)',
      'If the user asks about מחר / tomorrow / a specific date: you MUST call get_day_schedule with date "tomorrow" (or that YYYY-MM-DD) AND get_notion_meetings with range "tomorrow" (and get_notion_tasks filter "tomorrow" when tasks matter) BEFORE answering.',
      'NEVER use get_today_schedule or Notion range "today" for a tomorrow question. NEVER claim "אין פגישות מחר" / empty day unless those tool results for THAT date returned empty events/meetings AND calendarErrors is empty. If calendarErrors is present, say which calendars failed — do not invent an empty day.',
      'Prefetched calendar context is for TODAY only — it is NOT proof about tomorrow.',
      '',
      'Always include a Notion depth pass when the ask touches the day, prep, people, or "מצב": (1) get_notion_meetings for the correct day (tomorrow vs today), (2) get_notion_meeting_notes — AI Meeting Notes live ON the Notion meeting page (in-page block), not a separate DB; pass date / meetingId / notionUrl when the user pasted a link; empty body → לא נמצא בנתונים, (3) for people who appear, get_notion_people (+ projects/companies/search_notion when named).',
      'Also pull calendar via get_day_schedule / get_today_schedule as appropriate + get_open_tasks / get_notion_tasks. When money or overall "מצב" fits: get_cashflow_insights / get_trading_insights / get_finance_overview.',
      'If a Notion database is unreadable: notion_status and name it. Empty meeting-note body → `לא נמצא בנתונים` — never invent discussion points.',
      '',
      '### Answer with own tools (mandatory default)',
      'Factual lookups and day/calendar questions that are NOT explicit אופטי conflict/overload analysis: use YOUR OWN tools (+ prefetched calendar + Notion depth). Do NOT default-delegate to 06_calendar_optimizer.',
      'Do NOT call run_abc_agent unless the user explicitly wants a specialist FORMAT (structured תדריך בוקר, per-meeting prep for a named meeting, אופטי conflict/load brief, email triage, startup COO, IBKR import).',
      '',
      '### Gatekeeper',
      'Interrupt / escalate only for decisions the principal must make, hard blockers, or high-severity facts. Protect attention: say what NOT to handle now.',
      '',
      '### Delegation rules (staff input only)',
      'This platform is **fully synchronous** — finish the entire answer in this single reply. NEVER promise a later update or say you activated an agent.',
      'When an explicit specialist format matches: call run_abc_agent, wait, keep the specialist facts, then ALWAYS append CoS judgment (do first / skip / decision needed). Pass-through without judgment is forbidden.',
      'If run_abc_agent or a required tool returns empty/error: retry ONCE in this same turn; otherwise say `לא נמצא בנתונים` and still give judgment from what you have.',
      'Valid agentIds: `03_morning_briefing`, `04_meeting_prep_herald`, `06_calendar_optimizer`, `07_email_assistant`, `05_ibkr_daily_import`, `08_startup_coo`.',
      'summarize_whatsapp_groups returns summary text inline — include it and add judgment; do not say it will arrive separately.',
      '',
      'Notion access: you CAN read Notion across ALL connected accounts — get_notion_meetings, get_notion_tasks, get_notion_meeting_notes, get_notion_people, get_notion_projects, get_notion_companies, search_notion, notion_status. NEVER claim no access; if a database fails, call notion_status and name it.',
      'For daily prep / "תכין אותי ליום": Notion depth (meetings + AI notes + related people/projects) + calendar/tasks, then Judgment contract — do not open with run_abc_agent unless they explicitly asked for structured תדריך בוקר format.',
      'For tomorrow\'s / named meeting prep format only: you may run_abc_agent 04_meeting_prep_herald, but prefer enriching first with get_notion_meeting_notes + get_notion_people for attendees; then CoS judgment footer.',
      'Never tell the user to open another app or Notion to get the answer — deliver everything here.',
      '',
    )
  }

  if (workflow) {
    parts.push('', '## Applicable workflow (S_Skills)', '', workflow, '', '---')
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

  // User memory goes LAST so it is closest to the generation point and cannot be
  // buried under card/workflow/context blocks. Explicit precedence resolves the
  // old conflict between "MANDATORY overrides" above and "user instructions win".
  const memoryBlock = await getMemoryPromptBlock()
  if (memoryBlock) {
    parts.push(
      '',
      '## PRECEDENCE (read carefully)',
      "The user's standing instructions below OVERRIDE any conflicting default formatting/content instruction above (including the MANDATORY blocks), EXCEPT grounding rules: never invent facts, never dump the full task backlog, never use Markdown tables on WhatsApp/Telegram/cron.",
      '',
      memoryBlock,
      '',
      '---',
    )
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
  'Complete the answer NOW in this reply. Prefer YOUR OWN tools and the Judgment contract ' +
  '(מה חשוב עכשיו / למה / המלצה). Call run_abc_agent only if the user explicitly asked for a ' +
  'specialist format — then keep the facts and add CoS judgment. Do not say you will update later. ' +
  'Use the same language as the user.'

/** Own-tool names that mean CoS already did real work — do not force specialist routing. */
const COS_OWN_WORK_TOOLS = [
  'get_today_schedule',
  'get_day_schedule',
  'get_week_schedule',
  'get_upcoming_meetings',
  'get_next_meeting_brief',
  'get_open_tasks',
  'get_notion_tasks',
  'get_notion_meetings',
  'get_notion_meeting_notes',
  'get_notion_people',
  'get_notion_projects',
  'get_notion_companies',
  'search_notion',
  'search_gmail',
  'get_cashflow_insights',
  'get_trading_insights',
  'get_finance_overview',
  'get_recurring_charges',
  'summarize_whatsapp_groups',
  'whatsapp_group_insights',
]

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
    !toolsCalled.has('run_abc_agent') &&
    !COS_OWN_WORK_TOOLS.some((t) => toolsCalled.has(t))
  ) {
    console.warn('[GeminiAgent] CoS deferred with no tools — forcing completion retry')
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
      generationConfig: {
        ...modelOpts.generationConfig,
        // Scheduled runs must be consistent day to day — default sampling (~1.0)
        // produced format drift between runs.
        ...(options.channel === 'cron' ? { temperature: 0.3 } : {}),
      },
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

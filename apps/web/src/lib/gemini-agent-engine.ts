import { GoogleGenerativeAI, FunctionCallingMode } from '@google/generative-ai'
import {
  agentCardRequestsDueTasks,
  agentNeedsCalendarContext,
  agentNeedsNotionContext,
  getAbcRootPath,
  getAgentInstructions,
  getAgentWorkflowContent,
  HUGO_AGENT_ID,
} from './abc-agents'
import { stripCalendarTaskEcho } from './calendar-optimizer-task-echo'
import { calendarOptimizerHidesTasks, createApiCaller, executeTool, getToolDeclarations, type ToolExecutionContext } from './conversation-engine'
import {
  getGeminiModelOptions,
  getGeminiModelOptionsFast,
  sanitizeChatHistory,
  type ChatTurn,
} from './gemini-config'
import { formatNotionContextForPrompt, getNotionContext } from './notion'
import { getMemoryPromptBlock } from './agent-memory'
import type { AgentNotifyChannel } from './agent-notifications'
import { getAgentCalendarScopePromptBlock, getDefaultTimezone, localTodayIso, getAgentCalendarContext, formatAgentCalendarContextForPrompt, ownerIdentityPrompt, buildHarnessHeader, buildOwnerProfileBlock, buildEpisodesBlock, recordEpisode } from '@ak-system/api'
import { createRunLogger, type AgentRunLogData } from './agent-run-log'
import { randomBytes } from 'node:crypto'

function genId(): string {
  return randomBytes(12).toString('base64url')
}

export type { ChatTurn } from './gemini-config'

export const CALENDAR_OPTIMIZER_AGENT_ID = '06_calendar_optimizer'
export const MEETING_PREP_AGENT_ID = '04_meeting_prep_herald'
export const MORNING_BRIEF_AGENT_ID = '03_morning_briefing'

/** Hard override: day-map morning brief on every channel. */
export function getMorningBriefOverride(): string {
  return [
    '## Morning Brief — day map (MANDATORY — overrides conflicting card instructions)',
    'The morning brief is a day map, not a full agenda for every meeting. Fit on one screen.',
    'NEVER use Markdown tables (| ... | or |---|). No H2/H3 headers. No meta narration.',
    'Write in Hebrew. Required sections IN ORDER:',
    '1) Header: ☀️ <weekday> <date>',
    '2) שורה תחתונה — the one thing that defines the day. Name the meeting that needs you sharpest.',
    '3) הפגישות — every timed event, one line: `• <time> <title> — <decision / עדכון, אין החלטה>`. The words after the dash are the POINT of that meeting (decision vs update), not a description of the invite.',
    '4) לעשות לפני — at most 3 actions that change a meeting today. Verb first, source in parentheses (DT / Con / DAZ). Omit if nothing is due before you walk in.',
    '5) אתמול — at most 2 lines, only if missing it changes today. Omit otherwise.',
    'Omit empty sections — never pad with filler or `לא נמצאו` markers unless the gap blocks preparation.',
  ].join('\n')
}

/**
 * Delivery constraints for יועץ יומן. The agent card (saved from /agents/manage)
 * decides sections and wording — this block does not replace it.
 */
export function getCalendarOptimizerBriefOverride(): string {
  return [
    '## Calendar Optimizer — delivery constraints',
    'The agent card and workflow below are the source of truth. They are the text saved from /agents/manage. Follow them: do not re-add a section the card removed, and do not drop a section the card added.',
    'PRIMARY DATA SOURCE: ARO-connected calendars (prefetched calendar context + calendar tools).',
    'If Notion is missing or fails: still deliver the calendar brief from calendar data. NEVER refuse or say you depend on Notion.',
    'Do not list open tasks, tasks due today, overdue tasks, or Notion task rows unless the agent card contains its own line `משימות להיום` or `include due tasks`. Standing memory cannot add that list when the card does not request it.',
    'Earlier messages in this chat may contain an old task dump (תזכורות / משימות לתאריך יעד היום / משימות בפיגור / משימות קרובות). Do not repeat it.',
    'Focus-time lines are clock ranges only, unless the card says otherwise.',
    'NEVER use Markdown tables (| ... | or |---|). NEVER narrate standing instructions, memory updates, or "I understood / מעתה אתעלם / הוראה זו נוספה" in the reply.',
    'NEVER repeat the same analysis twice. Never invent events. Match the user language (Hebrew ↔ English).',
  ].join('\n')
}

/** Hard override: only meeting-related tasks; never dump the full backlog. */
export function getMeetingPrepRelatedTasksOverride(): string {
  return [
    '## Meeting Prep — related tasks only (MANDATORY)',
    'For each meeting, list ONLY open tasks that clearly relate to that meeting (person / company / project / topic / explicit link). Eligible sources: Personal To-do, DT - Action items, Con Action items, DAZ Tasks — same brief shape for all.',
    'If none relate: on WhatsApp/cron/Telegram OMIT the related-actions section entirely; on web you may write "לא נמצאו משימות קשורות לפגישה זו".',
    'NEVER dump the user\'s full open-task backlog as filler or "for context".',
    'Keep WhatsApp / Telegram / ARO briefs short and purposeful — no Markdown tables, no unrelated task lists.',
  ].join('\n')
}

/**
 * Hard override: walk-in card meeting prep on all channels.
 * Bans pasting calendar invite fluff; requires talk points with substance.
 */
export function getMeetingPrepNotionParityOverride(): string {
  return [
    '## Meeting Prep — walk-in card (MANDATORY — overrides conflicting card habits)',
    'Focus on the ONE meeting named in the user message / context block (pre-meeting cron or tagged ask).',
    'NEVER paste, quote, or lightly paraphrase the calendar event description / Outlook invite (From/Sent/To/Cc/Subject/When) / Teams "Need help?" / dial-in / mission-statement fluff.',
    'You MUST call tools for real context: at least get_notion_tasks and get_notion_meeting_notes; add people/projects/companies/search_notion when useful. Grounding rules still apply — no invention.',
    'Write a skimmable walk-in card (~15 lines). No Markdown tables. No meta narration ("I understood…"). Omit sections with no grounded data.',
    'Prefer Hebrew or English to match the user/trigger.',
    'Required shape:',
    '1) Header — <title> · <time>',
    '2) שורה תחתונה — the outcome of this meeting, as a manager would say it. One sentence. What you walk in to get.',
    '3) על מה לדבר — at most 3. Each line: topic, the grounded fact (number, commitment, blocker, owner), and what to do with it in the room (החלטה / עדכון / שאלה). Order by what must be settled. If notes only support one real topic, write one — do not pad to three.',
    '4) פתוח — at most 2 related tasks, and only if they belong in the room. Omit if none.',
    '5) מאז הפעם הקודמת — one or two lines: what you committed to, and whether it moved. A prior meeting is the previous instance of THIS topic only (same topic token, project, or series). Shared attendees are not enough. Cite only a note that survived that filter. If none: `אין סיכום מהפגישה הקודמת`. Do not name a second product in שורה תחתונה when it is absent from the focused notes and from the meeting title.',
  ].join('\n')
}

/**
 * Without an explicit `timeZone` this formats in the container's zone (UTC in production),
 * which reports the previous day for anything after 21:00 Israel time.
 */
function formatDateLabel(): string {
  return new Date().toLocaleDateString('he-IL', {
    timeZone: getDefaultTimezone(),
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })
}

/** Local wall clock as `HH:MM`. Agents greeted "בוקר טוב" at 15:07 without this. */
function formatClockLabel(): string {
  return new Date().toLocaleTimeString('en-GB', {
    timeZone: getDefaultTimezone(),
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

function todayIso(): string {
  return localTodayIso()
}

/**
 * Build a deterministic Hebrew brief from WhatsApp tool data when LLM fails.
 * Returns null if no WhatsApp data is available.
 */
function buildDegradedWhatsAppBrief(toolResults: Map<string, unknown>): string | null {
  // Check for WhatsApp tools
  const waTools = ['query_whatsapp_group', 'summarize_whatsapp_groups', 'whatsapp_now']
  const waTool = waTools.find((t) => toolResults.has(t))
  if (!waTool) return null

  const data = toolResults.get(waTool) as any
  if (!data || typeof data !== 'object') return null

  // Single group data
  if (data.groupName && !data.groups) {
    if (data.empty || data.messageCount === 0) {
      return `⚠️ מצב מופחת\n\nאין הודעות בקבוצה "${data.groupName}" (${data.rangeLabel || data.window}).`
    }

    const parts = [
      `⚠️ מצב מופחת — ${data.groupName}`,
      `${data.rangeLabel || data.window} · ${data.messageCount} הודעות\n`,
    ]

    if (data.topSenders && Array.isArray(data.topSenders) && data.topSenders.length > 0) {
      parts.push('כותבים הכי הרבה:')
      for (const s of data.topSenders.slice(0, 3)) {
        parts.push(`• ${s.name}: ${s.count} הודעות`)
      }
      parts.push('')
    }

    if (data.recentMessages && Array.isArray(data.recentMessages) && data.recentMessages.length > 0) {
      parts.push('הודעות אחרונות:')
      for (const line of data.recentMessages.slice(-10)) {
        parts.push(line)
      }
    }

    return parts.join('\n')
  }

  // Multi-group data
  if (data.groups && Array.isArray(data.groups)) {
    if (data.empty || data.groups.length === 0) {
      return `⚠️ מצב מופחת\n\nאין הודעות בקבוצות (${data.rangeLabel || data.window}).`
    }

    const parts = [
      `⚠️ מצב מופחת — סיכום קבוצות`,
      `${data.rangeLabel || data.window}\n`,
      `${data.totalGroups} קבוצות עם פעילות:\n`,
    ]

    for (const g of data.groups.slice(0, 10)) {
      parts.push(`• ${g.groupName}: ${g.messageCount} הודעות`)
    }

    return parts.join('\n')
  }

  return null
}

/** Record what this run delivered (agent-episodes). Never fails a run. */
async function recordRunEpisode(agentId: string, channel: string, text: string): Promise<void> {
  if (!text.trim()) return
  try {
    await recordEpisode({ agentId, channel, trigger: channel === 'cron' ? 'schedule' : 'chat', reply: text })
  } catch (err) {
    console.warn('[gemini-agent] episode not recorded', err)
  }
}

/** Owner roles/priorities block (owner-priorities-profile). Never fails a run. */
async function safeOwnerProfileBlock(): Promise<string> {
  try {
    return await buildOwnerProfileBlock()
  } catch (err) {
    console.warn('[gemini-agent] owner profile unavailable', err)
    return ''
  }
}

/** Agents that start every run with the harness world-state header (harness-world-state-header). */
const HARNESS_HEADER_AGENT_IDS = new Set(['01_Hugo_orchestrator', '03_morning_briefing', '04_meeting_prep_herald'])

/** Recent turns scanned for memory anchors, besides the current message. */
const MEMORY_HISTORY_TURNS = 6

export interface MemoryAnchorInput {
  message: string
  history?: ChatTurn[]
}

async function buildSystemInstruction(
  agentId: string,
  channel?: AgentNotifyChannel,
  /** ISO date to fetch for the calendar context. Defaults to today. Only used for 06_calendar_optimizer. */
  calendarPlanDate?: string,
  /** The run's message + recent turns — anchors for entity-scoped memory (hugo-entity-memory). */
  memoryContext?: MemoryAnchorInput,
): Promise<string> {
  // Text the memory block scans for people / projects / topics: message, recent turns, calendar.
  const memoryTexts: string[] = memoryContext
    ? [memoryContext.message, ...(memoryContext.history ?? []).slice(-MEMORY_HISTORY_TURNS).map((t) => t.content)]
    : []
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

  const ownerBlock = await safeOwnerProfileBlock()
  const parts: string[] = [
    `You are operating as ABC agent \`${agentId}\` inside ARO.`,
    ownerIdentityPrompt(),
    `Now: ${formatDateLabel()}, ${formatClockLabel()} (${todayIso()}, ${getDefaultTimezone()}).`,
    'NEVER use a time-of-day greeting that contradicts that clock — no "בוקר טוב" in the afternoon. On a direct question, skip the greeting entirely and answer.',
    'Day and week calendar tools return `now` plus four separate buckets: `inProgress`, `upcoming`, `allDay`, `past`. Use them exactly as given — an event from `past` is over, and one from `allDay` (birthday, WFH, trip) holds for the whole day and is NEVER past. Asked what is on today, answer from `inProgress` and `upcoming`; treat `past` as already done and `allDay` as one short line of background. Never let a list of birthdays crowd out the actual meetings.',
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
    // Carried over from the former general-assistant prompt when the web chat and
    // Telegram moved onto Hugo — these rules are channel-agnostic, so they belong here
    // rather than in one agent card.
    '## Output formatting',
    'For task lists: group by priority (high first) and show the due date when set. Priority labels in Hebrew: גבוהה=high, בינונית=medium, נמוכה=low.',
    'For meeting briefings: time, attendees with roles, project, open tasks, notes.',
    'Format times as HH:MM and dates as day/month/year or in natural language.',
    'If a calendar event has no linked record in the system database, still show the event details — mention the gap, do not drop the event.',
    'When showing conflicts, describe each overlap explicitly with both event names and times.',
    '',
    '## WhatsApp query tools',
    'query_whatsapp_group, summarize_whatsapp_groups and whatsapp_now return structured DB facts (message counts, top senders, recent lines) — YOU write the Hebrew briefing from them. When messageCount=0 or empty=true, say "אין הודעות [בטווח הזה]". Always state the rangeLabel.',
    'Time-anchored WhatsApp questions MUST carry time arguments: "היום"/"today" → window="today"; "אתמול"/"yesterday" → window="yesterday"; "בין 14 ל-16" → sinceHour=14, untilHour=16 (24h, Israel time); "מהבוקר" → window="today", sinceHour=6.',
    '',
    '## Agent feedback',
    'When the user describes a correction or complaint about how an automated agent behaved (not a one-off request), call log_agent_feedback with the matching agentId and their verbatim wording. Then confirm using the `note` the tool returns (it names the suggested rule; the user applies it on the agents screen). In English: "Logged for <agentId> — suggested rule: …, apply it on the agents screen". Never imply the behavior already changed.',
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

  if (agentId === MORNING_BRIEF_AGENT_ID) {
    parts.push(getMorningBriefOverride(), '')
  }

  if (agentId === MEETING_PREP_AGENT_ID) {
    parts.push(getMeetingPrepRelatedTasksOverride(), '')
    // Inject walk-in card format on ALL channels (web + WhatsApp + Telegram + cron)
    parts.push(getMeetingPrepNotionParityOverride(), '')
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
      'Rank מה חשוב עכשיו against the numbered priorities in "על אלפיר — תפקידים ועדיפויות" first, and say which priority each item serves; when an item serves none, say so. To change priorities use propose_priorities_update, show the diff, and only after a clear yes call apply_priorities_update with the token.',
      '',
      '### Multi-source scan (vague asks)',
      'On מה חשוב / מה המצב / תעזור לי / תכין אותי / similar vague intent: call at least TWO of YOUR OWN tools from DIFFERENT domains before answering. Do NOT call run_abc_agent as the first action.',
      'One of those MUST be get_harness_insights — it is the only source for links that span domains (a person going quiet while a commitment to them is open, a stale commitment, spend clustered around meetings, an unanswered thread). Each insight carries `basedOn`; cite it when you raise one, and do not restate an insight as a fact you verified yourself. For a named person, also call get_harness_insights with that personId.',
      'On a named project call get_project_context; on a named topic that is not a project (DD, Algo 4, גיוס) call get_topic_context — both as part of the depth pass. ' +
        'On a named-person or named-project ask, also call recall_memories for that name as part of the depth pass — the injected memory block is capped per entity, recall_memories is not. When you save a memory with remember, pass aboutPeople / aboutProjects / topics whenever it is about someone or something specific.',
      'MANDATORY when get_harness_insights — or the `תמונת מצב (harness)` header in this prompt — holds one or more insights relevant to the ask: the reply must contain a `קישורים בין תחומים:` section naming at least one of them with what it was based on. These links are invisible to every other tool — a calendar-and-tasks answer that silently drops them is a failed reply. If you judge that none of them deserve action right now, keep the section and write one line saying so and why. If the tool returned no insights, omit the section entirely — absence is not a finding.',
      '### Date grounding (CRITICAL — מחר / tomorrow)',
      'If the user asks about מחר / tomorrow / a specific date: you MUST call get_day_schedule with date "tomorrow" (or that YYYY-MM-DD) AND get_notion_meetings with range "tomorrow" (and get_notion_tasks filter "tomorrow" when tasks matter) BEFORE answering.',
      'NEVER use get_today_schedule or Notion range "today" for a tomorrow question. NEVER claim "אין פגישות מחר" / empty day unless those tool results for THAT date returned empty events/meetings AND calendarErrors is empty. If calendarErrors is present, say which calendars failed — do not invent an empty day.',
      'Prefetched calendar context is for TODAY only — it is NOT proof about tomorrow.',
      '',
      'Always include a Notion depth pass when the ask touches the day, prep, people, or "מצב": (1) get_notion_meetings for the correct day (tomorrow vs today) across DT Meetings, Con Meetings, and DAZ Internal Meetings / Meetings & Interactions, (2) get_notion_meeting_notes — Notion AI SUMMARY only. For day prep / מחר / כולם / תכין אותי: pass prepDate (tomorrow or today) and do NOT pass a leftover person query — brief EVERY person/meeting that day from prior summaries, not only שני/Shani. Named person → query with that CRM name (Hebrew aliases included). If the tool returns a note, that meeting happened; empty body → לא נמצא בנתונים, (3) for people who appear, get_notion_people (+ projects/companies/search_notion when named).',
      'Also pull calendar via get_day_schedule / get_today_schedule as appropriate + get_open_tasks / get_notion_tasks (Personal To-do, DT - Action items, Con Action items, DAZ Tasks — related items only, never the full backlog). When money or overall "מצב" fits: get_cashflow_insights / get_trading_insights / get_finance_overview.',
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
      'For tomorrow\'s / named meeting prep format only: you may run_abc_agent 04_meeting_prep_herald, but prefer enriching first with get_notion_meeting_notes (prepDate for the day; query only if one person is named) + get_notion_people for attendees + get_notion_tasks related to each meeting; then CoS judgment footer.',
      'Never tell the user to open another app or Notion to get the answer — deliver everything here.',
      '',
    )
  }

  // Roles and priorities sit right after the identity line. Inserted after the CoS splice above,
  // which relies on fixed indexes in `parts`.
  if (ownerBlock) parts.splice(2, 0, ownerBlock)

  // Harness picture up front, so cross-domain links do not depend on a tool call.
  if (HARNESS_HEADER_AGENT_IDS.has(agentId)) {
    try {
      const header = await buildHarnessHeader()
      if (header) parts.push('', header, '', '---')
    } catch (err) {
      console.warn('[gemini-agent] harness header unavailable', err)
    }
    // What the other agents already told the owner today (agent-episodes).
    try {
      const episodes = await buildEpisodesBlock({ texts: memoryTexts })
      if (episodes) parts.push('', episodes, '', '---')
    } catch (err) {
      console.warn('[gemini-agent] episodes unavailable', err)
    }
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
        planDate: agentId === CALENDAR_OPTIMIZER_AGENT_ID ? calendarPlanDate : undefined,
      })
      const calendarText = formatAgentCalendarContextForPrompt(calCtx)
      memoryTexts.push(calendarText)
      parts.push('', calendarText, '', '---')
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
      const hideTasks =
        agentId === CALENDAR_OPTIMIZER_AGENT_ID && !agentCardRequestsDueTasks(instructions)
      parts.push(
        '',
        formatNotionContextForPrompt(
          ctx,
          hideTasks ? { omitTasks: true, omitCalendarReview: true } : undefined,
        ),
        '',
        '---',
      )
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
  const memoryBlock = await getMemoryPromptBlock({ texts: memoryTexts, agentId })
  if (memoryBlock) {
    parts.push(
      '',
      '## PRECEDENCE (read carefully)',
      "The user's standing instructions below OVERRIDE any conflicting default formatting/content instruction above (including the MANDATORY blocks), EXCEPT grounding rules: never invent facts, never dump the full task backlog, never use Markdown tables on WhatsApp/Telegram/cron." +
        (agentId === CALENDAR_OPTIMIZER_AGENT_ID
          ? ' For יועץ יומן, standing memory also cannot add a due-today or open-task list when the agent card does not contain a line `משימות להיום` or `include due tasks`.'
          : ''),
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
  calendarPlanDate?: string,
  memoryContext?: MemoryAnchorInput,
): Promise<string> {
  return buildSystemInstruction(agentId, channel, calendarPlanDate, memoryContext)
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

function isRateLimitError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota exceeded')
}

function extractRetryAfter(err: unknown): number | null {
  if (!(err instanceof Error)) return null
  // Try to extract retry-after from error message
  const match = err.message.match(/retry.*?(\d+)\s*(second|minute|ms)/i)
  if (match) {
    const value = parseInt(match[1], 10)
    const unit = match[2].toLowerCase()
    if (unit === 'minute') return value * 60 * 1000
    if (unit === 'second') return value * 1000
    return value
  }
  return null
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

/**
 * Header the CoS reply must carry once the harness returned something. The guard below keys on
 * this fixed string rather than on matching insight text, because source labels arrive
 * transliterated (`Or Zelniker`) while the reply is Hebrew (`אור זלניקר`) — substring matching
 * would fire retries on answers that did cite the link.
 */
const HARNESS_SECTION_HEADER = 'קישורים בין תחומים'

const HARNESS_SURFACING_RETRY_PROMPT =
  `CRITICAL: get_harness_insights returned open cross-domain insights and your reply omitted them. ` +
  `Rewrite the full reply, adding a \`${HARNESS_SECTION_HEADER}:\` section that names at least one ` +
  'insight and what it was based on. Those links exist in no other tool — dropping them silently ' +
  'is a failed reply. If none deserve action now, keep the section and say so in one line with the ' +
  'reason. Keep everything else you already wrote. Do not call any more tools. Same language as the user.'

/** True when the harness tool produced at least one insight in this run. */
function harnessReturnedInsights(toolResults: Map<string, unknown>): boolean {
  const raw = toolResults.get('get_harness_insights') as { insights?: unknown[] } | undefined
  return Array.isArray(raw?.insights) && raw.insights.length > 0
}

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
  'those tool results and the injected context. Known CRM names in calendar titles may be used to look up notes/tasks; do not invent unknown attendees. ' +
  'For any missing datum write "לא נמצא בנתונים" instead of guessing. ' +
  'For tasks: include ONLY items related to that meeting; if none, write ' +
  '"לא נמצאו משימות קשורות לפגישה זו" — NEVER dump the full open backlog. ' +
  'Reply in the same language as the user.'

type FunctionCall = { name: string; args: ToolArgs; id?: string }

type ToolResponsePart = {
  functionResponse: { name: string; id?: string; response: { result: unknown } }
}

type GeminiContent = { role?: string; parts: unknown[] }

const FOCUS_TITLE_TOOLS = new Set(['get_notion_meeting_notes', 'get_notion_tasks'])

/** The cron context has one `Meeting:` line. Day-wide prompts have none or many. */
export function singleMeetingFocusTitle(message: string): string | null {
  const matches = [...message.matchAll(/^Meeting:\s+(.+)$/gm)]
  if (matches.length !== 1) return null
  const title = matches[0]?.[1]?.trim()
  return title || null
}

function withSingleMeetingFocus(
  calls: FunctionCall[],
  agentId: string,
  message: string,
): FunctionCall[] {
  if (agentId !== MEETING_PREP_AGENT_ID) return calls
  const title = singleMeetingFocusTitle(message)
  if (!title) return calls
  return calls.map((call) => {
    if (!FOCUS_TITLE_TOOLS.has(call.name)) return call
    const existing = call.args?.focusTitle
    if (typeof existing === 'string' && existing.trim()) return call
    return { ...call, args: { ...call.args, focusTitle: title } }
  })
}

async function processToolCalls(
  calls: FunctionCall[],
  caller: Awaited<ReturnType<typeof createApiCaller>>,
  toolCtx: ToolExecutionContext | undefined,
  toolsCalled: Set<string>,
  toolResults: Map<string, unknown>,
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
      toolResults.set(call.name, toolResult)
      return {
        functionResponse: {
          name: call.name,
          ...(call.id ? { id: call.id } : {}),
          response: { result: toolResult },
        },
      }
    }),
  )
}

/**
 * Gemini 3 rejects role "function". The SDK assigns that role inside
 * chat.sendMessage, so tool results go out through generateContent as role
 * "user", with the function-call id and the thought signature already stored
 * on the model turn. Chats whose model has no generateContent keep sendMessage.
 */
async function sendToolResults(
  chat: {
    sendMessage: (request: ToolResponsePart[]) => Promise<GeminiChatResult>
    getHistory?: () => Promise<GeminiContent[]>
  },
  model: {
    generateContent?: (request: { contents: GeminiContent[] }) => Promise<GeminiChatResult>
  },
  responses: ToolResponsePart[],
): Promise<GeminiChatResult> {
  if (model.generateContent && chat.getHistory) {
    const history = await chat.getHistory()
    const toolTurn: GeminiContent = { role: 'user', parts: responses }
    const result = await model.generateContent({ contents: [...history, toolTurn] })
    const content = result.response.candidates?.[0]?.content as GeminiContent | undefined
    if (content?.parts?.length) {
      history.push(toolTurn)
      history.push({ role: content.role || 'model', parts: content.parts })
    }
    return result
  }
  return chat.sendMessage(responses)
}

type GeminiChat = ReturnType<ReturnType<GoogleGenerativeAI['getGenerativeModel']>['startChat']>
type GeminiChatResult = Awaited<ReturnType<GeminiChat['sendMessage']>>

async function runToolLoop(
  chat: GeminiChat,
  model: { generateContent?: (request: { contents: GeminiContent[] }) => Promise<GeminiChatResult> },
  initialResult: GeminiChatResult,
  caller: Awaited<ReturnType<typeof createApiCaller>>,
  toolCtx: ToolExecutionContext | undefined,
  toolsCalled: Set<string>,
  toolResults: Map<string, unknown>,
  maxIterations: number,
  agentId: string,
  message: string,
): Promise<Awaited<ReturnType<typeof chat.sendMessage>>> {
  let result = initialResult
  let iterations = 0
  while (iterations < maxIterations) {
    const rawCalls = result.response.functionCalls() as FunctionCall[] | undefined
    if (!rawCalls || rawCalls.length === 0) break
    const calls = withSingleMeetingFocus(rawCalls, agentId, message)
    const responses = await processToolCalls(calls, caller, toolCtx, toolsCalled, toolResults)
    result = await sendToolResults(chat, model, responses)
    iterations++
  }
  return result
}

interface ChatLoopResult {
  text: string
  finishReason: string | null
  blockReason: string | null
  toolsCalled: string[]
  geminiCalls: number
  reasonCode?: string // Machine-readable failure reason
  toolResults?: Map<string, unknown> // Tool name → result, for degraded fallback
}

async function runChatLoop(
  model: ReturnType<GoogleGenerativeAI['getGenerativeModel']>,
  agentId: string,
  history: ChatTurn[],
  message: string,
  caller: Awaited<ReturnType<typeof createApiCaller>>,
  toolCtx: ToolExecutionContext | undefined,
  logger: ReturnType<typeof createRunLogger>,
  allowTools = true, // Can be set to false for MALFORMED_FUNCTION_CALL retry
): Promise<ChatLoopResult> {
  const historyForModel =
    agentId === CALENDAR_OPTIMIZER_AGENT_ID && calendarOptimizerHidesTasks(agentId)
      ? history.map((turn) =>
          turn.role === 'assistant' ? { ...turn, content: stripCalendarTaskEcho(turn.content) } : turn,
        )
      : history
  const chat = model.startChat({ history: buildHistoryContents(historyForModel) })
  const toolsCalled = new Set<string>()
  const toolResults = new Map<string, unknown>()
  let geminiCalls = 1

  logger.log('Starting chat loop', { agentId, message: message.slice(0, 100), allowTools })
  let result = await runToolLoop(
    chat,
    model,
    await chat.sendMessage(message),
    caller,
    toolCtx,
    toolsCalled,
    toolResults,
    allowTools ? 10 : 0,
    agentId,
    message,
  )

  let inspection = inspectResponse(result)
  logger.log('Initial response', {
    textLength: inspection.text.length,
    finishReason: inspection.finishReason,
    toolsCount: toolsCalled.size,
  })

  // MALFORMED_FUNCTION_CALL recovery: retry without tools
  if (
    inspection.finishReason === 'MALFORMED_FUNCTION_CALL' &&
    allowTools
  ) {
    logger.log('MALFORMED_FUNCTION_CALL detected — retrying without tools')
    geminiCalls++
    // Start a fresh chat without tools
    const noToolModel = model
    const noToolChat = noToolModel.startChat({ history: buildHistoryContents(historyForModel) })
    try {
      const retryResult = await noToolChat.sendMessage(message)
      inspection = inspectResponse(retryResult)
      logger.log('No-tool retry response', { textLength: inspection.text.length })
    } catch (err) {
      logger.log('No-tool retry failed', { error: err instanceof Error ? err.message : 'Unknown' })
    }
  }

  if (
    agentId === HUGO_AGENT_ID &&
    inspection.text &&
    looksLikeDeferredDelegation(inspection.text) &&
    !toolsCalled.has('run_abc_agent') &&
    !COS_OWN_WORK_TOOLS.some((t) => toolsCalled.has(t))
  ) {
    logger.log('CoS deferred with no tools — forcing completion retry')
    geminiCalls++
    result = await runToolLoop(
      chat,
      model,
      await chat.sendMessage(DELEGATION_RETRY_PROMPT),
      caller,
      toolCtx,
      toolsCalled,
      toolResults,
      5,
      agentId,
      message,
    )
    inspection = inspectResponse(result)
  }

  // Cross-domain links are the one thing no other tool can produce, and the model readily
  // answers from the prefetched calendar/Notion context while ignoring them. One retry.
  if (
    agentId === HUGO_AGENT_ID &&
    inspection.text &&
    harnessReturnedInsights(toolResults) &&
    !inspection.text.includes(HARNESS_SECTION_HEADER)
  ) {
    logger.log('CoS dropped harness insights — forcing surfacing retry')
    geminiCalls++
    result = await runToolLoop(
      chat,
      model,
      await chat.sendMessage(HARNESS_SURFACING_RETRY_PROMPT),
      caller,
      toolCtx,
      toolsCalled,
      toolResults,
      0,
      agentId,
      message,
    )
    const retried = inspectResponse(result)
    // Only take the retry if it actually produced text; never trade a good answer for an empty one.
    if (retried.text) inspection = retried
  }

  // Meeting Prep Herald must ground its briefing in real data. If it answered without
  // calling any data tool, force a single grounding retry before returning.
  if (
    agentId === MEETING_PREP_AGENT_ID &&
    !MEETING_PREP_GROUNDING_TOOLS.some((t) => toolsCalled.has(t))
  ) {
    logger.log('Meeting prep answered without a data tool — forcing grounding retry')
    geminiCalls++
    result = await runToolLoop(
      chat,
      model,
      await chat.sendMessage(MEETING_PREP_GROUNDING_RETRY_PROMPT),
      caller,
      toolCtx,
      toolsCalled,
      toolResults,
      5,
      agentId,
      message,
    )
    inspection = inspectResponse(result)
  }

  if (!inspection.text && toolsCalled.size > 0) {
    logger.log('Empty response with tools — nudging for answer')
    geminiCalls++
    result = await chat.sendMessage(
      'Based on the tool results above, write your complete answer to the user now. ' +
        'Use ONLY facts present in the tool results or injected context; if a datum is missing, ' +
        'say it is missing (write "לא נמצא בנתונים") rather than inventing it. ' +
        'Use the same language as the user. Do not call any more tools.',
    )
    inspection = inspectResponse(result)
  }

  // Determine final text and reason code
  let finalText = inspection.text
  let reasonCode: string | undefined

  if (!finalText) {
    // Try degraded WhatsApp brief first
    const degradedBrief = buildDegradedWhatsAppBrief(toolResults)
    if (degradedBrief) {
      finalText = degradedBrief
      reasonCode = 'DEGRADED_WHATSAPP'
      logger.log('Using degraded WhatsApp brief', { length: finalText.length })
    } else if (inspection.blockReason) {
      reasonCode = 'CONTENT_BLOCKED'
      finalText = `לא הצלחתי לייצר תשובה (CONTENT_BLOCKED: ${inspection.blockReason}). הבקשה נחסמה על ידי מדיניות התוכן.`
    } else if (inspection.finishReason === 'MALFORMED_FUNCTION_CALL') {
      reasonCode = 'MALFORMED_FUNCTION_CALL'
      finalText = 'לא הצלחתי לייצר תשובה (MALFORMED_FUNCTION_CALL). נסה שוב או נסח את השאלה אחרת.'
    } else if (toolsCalled.size === 0) {
      reasonCode = 'EMPTY_RESPONSE_NO_TOOLS'
      finalText = 'לא הצלחתי לייצר תשובה (EMPTY_RESPONSE). נסה שוב או פנה לתמיכה.'
    } else {
      reasonCode = 'EMPTY_RESPONSE_WITH_TOOLS'
      finalText = 'לא הצלחתי לייצר תשובה (EMPTY_RESPONSE). הנתונים התקבלו אך התשובה לא נוצרה. נסה שוב.'
    }
    logger.log('No text generated', { reasonCode })
  }

  logger.log('Chat loop complete', {
    textLength: finalText.length,
    geminiCalls,
    toolsCalled: toolsCalled.size,
    reasonCode,
  })

  return {
    text: finalText,
    finishReason: inspection.finishReason,
    blockReason: inspection.blockReason,
    toolsCalled: Array.from(toolsCalled),
    geminiCalls,
    reasonCode,
    toolResults,
  }
}

type ToolArgs = Record<string, unknown>

interface ResponseInspection {
  text: string
  finishReason: string | null
  blockReason: string | null
}

function inspectResponse(result: {
  response: {
    text: () => string
    candidates?: Array<{ finishReason?: string; safetyRatings?: Array<{ blocked?: boolean; category?: string }> }>
  }
}): ResponseInspection {
  let text = ''
  let finishReason: string | null = null
  let blockReason: string | null = null

  try {
    text = result.response.text()?.trim() ?? ''
  } catch {
    text = ''
  }

  try {
    const candidate = result.response.candidates?.[0]
    if (candidate?.finishReason) {
      finishReason = candidate.finishReason
    }
    // Check for safety blocks
    if (candidate?.safetyRatings) {
      const blocked = candidate.safetyRatings.find((r) => r.blocked)
      if (blocked?.category) {
        blockReason = blocked.category
      }
    }
  } catch {
    // Ignore inspection errors
  }

  return { text, finishReason, blockReason }
}

export async function runGeminiAgentChat(options: {
  agentId: string
  message: string
  history?: ChatTurn[]
  channel?: AgentNotifyChannel
  /** ISO date for the calendar context (06_calendar_optimizer scheduled runs only). */
  calendarPlanDate?: string
}): Promise<{ text: string }> {
  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) throw new Error('GEMINI_API_KEY is not set')

  const runId = genId()
  const channel = options.channel ?? 'web'
  // Determine priority: interactive for web, event for whatsapp/telegram, batch for cron
  const priority = channel === 'cron' ? 'batch' : channel === 'web' ? 'interactive' : 'event'
  const logger = createRunLogger(runId, options.agentId, channel, priority)

  logger.log('Starting agent run', { message: options.message.slice(0, 100) })

  const genAI = new GoogleGenerativeAI(geminiKey)
  const caller = await createApiCaller()
  const toolCtx: ToolExecutionContext = {
    channel: options.channel,
    agentId: options.agentId,
  }
  const history = options.history ?? []
  const systemInstruction = await buildSystemInstruction(options.agentId, options.channel, options.calendarPlanDate, {
    message: options.message,
    history,
  })

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
      tools: [{ functionDeclarations: getToolDeclarations(options.agentId) }],
      toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } },
    })

  try {
    const result = await runChatLoop(
      buildModel(getGeminiModelOptions()),
      options.agentId,
      history,
      options.message,
      caller,
      toolCtx,
      logger,
    )

    // Determine status
    let status: AgentRunLogData['status'] = 'ok'
    let errorMessage: string | null = null

    if (result.blockReason) {
      status = 'error'
      errorMessage = `Blocked: ${result.blockReason}`
    } else if (result.reasonCode === 'DEGRADED_WHATSAPP') {
      status = 'degraded'
      errorMessage = result.reasonCode
    } else if (result.reasonCode) {
      status = 'empty'
      errorMessage = result.reasonCode
    } else if (!result.text || result.text.startsWith('לא הצלחתי לייצר תשובה')) {
      status = 'empty'
      errorMessage = result.reasonCode || 'EMPTY_RESPONSE'
    }

    await logger.complete({
      status,
      finishReason: result.finishReason,
      blockReason: result.blockReason,
      toolsCalled: result.toolsCalled,
      geminiCalls: result.geminiCalls,
      queueWaitMs: 0, // No gateway integration yet
      attempts: 1,
      modelTier: 'flash-thinking', // Primary model
      cacheHit: false,
      replyChars: result.text.length,
      errorMessage,
    })

    await recordRunEpisode(options.agentId, channel, result.text)
    return { text: result.text }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown error'
    
    // Handle rate limit errors specially
    if (isRateLimitError(err)) {
      logger.log('Rate limit error detected', { error: errorMsg })
      const retryAfter = extractRetryAfter(err)
      const retryMsg = retryAfter
        ? ` נסה שוב בעוד ${Math.ceil(retryAfter / 1000)} שניות.`
        : ' נסה שוב בעוד כמה דקות.'

      await logger.complete({
        status: 'rate_limited',
        finishReason: null,
        blockReason: null,
        toolsCalled: [],
        geminiCalls: 1,
        queueWaitMs: 0,
        attempts: 1,
        modelTier: 'flash-thinking',
        cacheHit: false,
        replyChars: 0,
        errorMessage: 'RATE_LIMIT_EXCEEDED',
      })

      return {
        text: `לא הצלחתי לייצר תשובה (RATE_LIMIT_EXCEEDED). המערכת עמוסה כרגע.${retryMsg}`,
      }
    }
    
    if (!isGeminiNetworkError(err)) {
      // Non-network error — log and rethrow
      await logger.complete({
        status: 'error',
        finishReason: null,
        blockReason: null,
        toolsCalled: [],
        geminiCalls: 1,
        queueWaitMs: 0,
        attempts: 1,
        modelTier: 'flash-thinking',
        cacheHit: false,
        replyChars: 0,
        errorMessage: errorMsg,
      })
      throw err
    }

    // Network error — retry with fast model
    logger.log('Extended thinking failed, retrying without thinking', { error: errorMsg })
    try {
      const result = await runChatLoop(
        buildModel(getGeminiModelOptionsFast()),
        options.agentId,
        history,
        options.message,
        caller,
        toolCtx,
        logger,
      )

      let status: AgentRunLogData['status'] = 'ok'
      let errorMessage: string | null = null

      if (result.blockReason) {
        status = 'error'
        errorMessage = `Blocked: ${result.blockReason}`
      } else if (result.reasonCode === 'DEGRADED_WHATSAPP') {
        status = 'degraded'
        errorMessage = result.reasonCode
      } else if (result.reasonCode) {
        status = 'empty'
        errorMessage = result.reasonCode
      } else if (!result.text || result.text.startsWith('לא הצלחתי לייצר תשובה')) {
        status = 'empty'
        errorMessage = result.reasonCode || 'EMPTY_RESPONSE'
      }

      await logger.complete({
        status,
        finishReason: result.finishReason,
        blockReason: result.blockReason,
        toolsCalled: result.toolsCalled,
        geminiCalls: result.geminiCalls,
        queueWaitMs: 0,
        attempts: 2, // Second attempt after fallback
        modelTier: 'flash', // Fast model
        cacheHit: false,
        replyChars: result.text.length,
        errorMessage,
      })

      await recordRunEpisode(options.agentId, channel, result.text)
      return { text: result.text }
    } catch (retryErr) {
      // Fallback failed too
      const retryErrorMsg = retryErr instanceof Error ? retryErr.message : 'Unknown error'
      
      // Check if the fallback also failed due to rate limit
      if (isRateLimitError(retryErr)) {
        logger.log('Fallback also hit rate limit', { error: retryErrorMsg })
        const retryAfter = extractRetryAfter(retryErr)
        const retryMsg = retryAfter
          ? ` נסה שוב בעוד ${Math.ceil(retryAfter / 1000)} שניות.`
          : ' נסה שוב בעוד כמה דקות.'

        await logger.complete({
          status: 'rate_limited',
          finishReason: null,
          blockReason: null,
          toolsCalled: [],
          geminiCalls: 2,
          queueWaitMs: 0,
          attempts: 2,
          modelTier: 'flash',
          cacheHit: false,
          replyChars: 0,
          errorMessage: 'RATE_LIMIT_EXCEEDED (both primary and fallback)',
        })

        return {
          text: `לא הצלחתי לייצר תשובה (RATE_LIMIT_EXCEEDED). המערכת עמוסה מאוד כרגע.${retryMsg}`,
        }
      }
      
      await logger.complete({
        status: 'error',
        finishReason: null,
        blockReason: null,
        toolsCalled: [],
        geminiCalls: 2,
        queueWaitMs: 0,
        attempts: 2,
        modelTier: 'flash',
        cacheHit: false,
        replyChars: 0,
        errorMessage: `Primary failed: ${errorMsg}, Fallback failed: ${retryErrorMsg}`,
      })
      throw retryErr
    }
  }
}

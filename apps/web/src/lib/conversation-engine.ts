import { GoogleGenerativeAI, FunctionCallingMode, SchemaType } from '@google/generative-ai'
import type { FunctionDeclaration } from '@google/generative-ai'
import { chatMessages, getDb } from '@ak-system/database'
import { getRunnableAgentIds } from './abc-agents'
import { appendAgentFeedback } from './agent-feedback-log'
import type { AgentNotifyChannel } from './agent-notifications'
import { createServiceCaller } from './api-caller'
import { getGeminiModelOptions } from './gemini-config'
import { getNotionEntries, getNotionMeetings, getNotionStatus, getNotionTasks, searchNotion } from './notion'
import { filterEventsByCalendarScope, getAgentCalendarIds, localTodayIso, localTomorrowIso, resolveLocalDayArg } from '@ak-system/api'

// ─── tRPC caller ─────────────────────────────────────────────────────────────

export async function createApiCaller() {
  return createServiceCaller()
}

type Caller = Awaited<ReturnType<typeof createApiCaller>>

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayIso(): string {
  return localTodayIso()
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

// ─── WhatsApp time-window arguments ───────────────────────────────────────────
// Mirrors WHATSAPP_WINDOWS in packages/api/src/lib/whatsapp-time-window.ts, which
// is the Zod-validated source of truth on the server.

const WA_WINDOWS = ['6h', '24h', '7d', '30d', 'today', 'yesterday'] as const
type WaWindow = (typeof WA_WINDOWS)[number]

const WA_WINDOW_PARAM_DESC =
  "Time range: '6h' | '24h' | '7d' | '30d' (rolling), or 'today' / 'yesterday' (calendar day, Israel time). Use 'today' for היום, 'yesterday' for אתמול."
const WA_SINCE_HOUR_DESC =
  'Optional start hour 0-23 in Israel local time, inside the chosen day. For "בין 14 ל-16" pass 14.'
const WA_UNTIL_HOUR_DESC =
  'Optional end hour 1-24 (exclusive) in Israel local time. For "בין 14 ל-16" pass 16; for "אחרי 20:00" leave empty.'

function parseWaWindow(raw: unknown, fallback: WaWindow): WaWindow {
  const value = typeof raw === 'string' ? raw.trim() : ''
  return (WA_WINDOWS as readonly string[]).includes(value) ? (value as WaWindow) : fallback
}

function parseWaHour(raw: unknown, min: number, max: number): number | undefined {
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN
  if (!Number.isFinite(n)) return undefined
  const rounded = Math.round(n)
  if (rounded < min || rounded > max) return undefined
  return rounded
}

/** Window + optional hour range, as accepted by whatsapp.insights.* */
function waTimeArgs(args: Record<string, unknown>, fallbackWindow: WaWindow) {
  const sinceHour = parseWaHour(args.sinceHour, 0, 23)
  const untilHour = parseWaHour(args.untilHour, 1, 24)
  const hasHours = sinceHour !== undefined || untilHour !== undefined
  return {
    window: parseWaWindow(args.window, hasHours ? 'today' : fallbackWindow),
    ...(sinceHour !== undefined ? { sinceHour } : {}),
    ...(untilHour !== undefined ? { untilHour } : {}),
  }
}

// ─── Tool declarations ────────────────────────────────────────────────────────

export type ToolExecutionContext = {
  channel?: AgentNotifyChannel
}

const baseToolDeclarations: FunctionDeclaration[] = [
  {
    name: 'get_today_schedule',
    description:
      "Get TODAY's calendar events and tasks due today (Israel time). Use for 'היום' / today only. For מחר / tomorrow use get_day_schedule with date 'tomorrow'.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: 'get_day_schedule',
    description:
      "Get calendar events and AK tasks due on a specific local day (Asia/Jerusalem). REQUIRED for מחר / tomorrow / a named date. Pass date 'tomorrow' or 'today' or YYYY-MM-DD. Never invent an empty day — if calendarErrors is non-empty, say calendars failed; do not claim zero meetings.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        date: {
          type: SchemaType.STRING,
          description: "'today' | 'tomorrow' | YYYY-MM-DD (Israel local). Required for מחר.",
        },
      },
      required: ['date'],
    },
  },
  {
    name: 'get_week_schedule',
    description:
      "Get this week's calendar events and tasks due this week. Use for: 'מה יש לי השבוע', 'this week'. For a single day (מחר) prefer get_day_schedule.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: 'get_upcoming_meetings',
    description: 'Get the next upcoming calendar events.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        limit: { type: SchemaType.NUMBER, description: 'Max events to return (default 5)' },
      },
    },
  },
  {
    name: 'get_next_meeting_brief',
    description:
      "Get a full preparation briefing for the next upcoming meeting: time, location, attendees with roles, linked project, open tasks, and notes. Use for: 'תכין אותי לפגישה הבאה', 'prepare me for next meeting', 'מה יש בפגישה הבאה', 'מי בפגישה הבאה', 'מה צריך לפני הפגישה'.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: 'get_open_tasks',
    description:
      "Get all open (not done) tasks, optionally filtered by priority. Use for: 'מה המשימות שלי', 'open tasks', 'משימות פתוחות'.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        priority: {
          type: SchemaType.STRING,
          format: 'enum',
          description: "Filter by priority: 'high', 'medium', or 'low' (optional)",
          enum: ['high', 'medium', 'low'],
        },
      },
    },
  },
  {
    name: 'get_overdue_tasks',
    description:
      "Get tasks with a past due date that are not done. Use for: 'מה לא עשיתי', 'overdue', 'פיגורים', 'מה עבר הזמן'.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: 'get_calendar_conflicts',
    description:
      "Check for overlapping calendar events in the upcoming days. Use for: 'יש לי קונפליקטים', 'התנגשויות בלוח', 'conflicts'.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        days: {
          type: SchemaType.NUMBER,
          description: 'Days ahead to check (default 7)',
        },
      },
    },
  },
  {
    name: 'get_projects',
    description:
      "Get all projects with their open task counts. Use for: 'מה הפרויקטים', 'projects', 'סטטוס פרויקטים'.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: 'get_people',
    description:
      "Get all contacts/people in the system. Use for: 'מי יש לי', 'אנשי קשר', 'contacts', or 'מי זה [name]'.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: 'search_person',
    description:
      "Search contacts/people by name, role, or email. Use for: 'מי זה X', 'find person Y', 'חיפוש איש קשר'.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: { type: SchemaType.STRING, description: 'Search term (name, role, or email)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'save_fact',
    description:
      "Save a fact or note to memory for later. Use for: 'שמור ש...', 'remember that', 'תזכור'.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        content: { type: SchemaType.STRING, description: 'The fact or note to save' },
      },
      required: ['content'],
    },
  },
  {
    name: 'get_reports',
    description:
      "Get recent saved facts/reports from memory. Use for: 'מה שמרתי', 'reports', 'עובדות'.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        limit: { type: SchemaType.NUMBER, description: 'Max items (default 20)' },
      },
    },
  },
  {
    name: 'remember',
    description:
      "Persist a durable memory or piece of knowledge the user wants recalled in FUTURE conversations (survives across sessions). Use when the user says 'תזכור ש...', 'remember that', 'תלמד', 'מעכשיו', or states a stable preference/fact about themselves, people, or projects. Prefer this over save_fact for personal preferences and standing knowledge.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        content: { type: SchemaType.STRING, description: 'The memory/knowledge to store (concise, self-contained)' },
        kind: {
          type: SchemaType.STRING,
          format: 'enum',
          description: "'memory' for short preferences/facts, 'knowledge' for longer pasted content (default: memory)",
          enum: ['memory', 'knowledge'],
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'update_instruction',
    description:
      "Add or change the user's STANDING custom instructions that are injected into every future run (how the assistant should behave). Use only when the user explicitly asks to change how you work going forward, e.g. 'מעכשיו תמיד...', 'always do X', 'stop doing Y'. Use mode 'append' to add a rule, 'replace' to rewrite all standing instructions.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        content: { type: SchemaType.STRING, description: 'The instruction text' },
        mode: {
          type: SchemaType.STRING,
          format: 'enum',
          description: "'append' to add to existing instructions, 'replace' to overwrite (default: append)",
          enum: ['append', 'replace'],
        },
      },
      required: ['content'],
    },
  },
  {
    name: 'get_notion_tasks',
    description:
      "Read the user's tasks from Notion across ALL connected accounts and task databases: Personal To-do, DT - Action items, Con Action items, and DAZ Tasks. Use for daily/meeting prep. Include ONLY tasks related to the meeting's people/project/topic — never dump the full backlog. For מחר use filter 'tomorrow'.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        filter: {
          type: SchemaType.STRING,
          format: 'enum',
          description:
            "Which tasks to return: 'overdue', 'today', 'tomorrow', 'soon' (next 3 days), or 'all' (default: all)",
          enum: ['overdue', 'today', 'tomorrow', 'soon', 'all'],
        },
      },
    },
  },
  {
    name: 'get_notion_meetings',
    description:
      "Read the user's meetings from Notion across ALL connected accounts: DT - Meetings, Con Meetings, DAZ Internal Meetings, DAZ Meetings & Interactions. For מחר / tomorrow MUST use range 'tomorrow'. Also: 'today', 'upcoming' (next 7 days). Default today — do not use default when the user asked about tomorrow.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        range: {
          type: SchemaType.STRING,
          format: 'enum',
          description: "'today' | 'tomorrow' | 'upcoming' (next 7 days). Use tomorrow for מחר.",
          enum: ['today', 'tomorrow', 'upcoming'],
        },
      },
    },
  },
  {
    name: 'get_notion_people',
    description:
      "Read the user's People/contacts database from Notion (all accounts). Each person includes resolved relations (e.g. company, projects, manager/reports-to) so you can connect participants to context. Use to identify meeting participants, look up who someone is, or connect a person to meetings/projects. Part of meeting prep.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: 'get_notion_projects',
    description:
      "Read the user's Projects database from Notion (all accounts). Use to connect a meeting or topic to an active project, or list current projects. Part of meeting prep.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: 'get_notion_companies',
    description:
      "Read the user's Companies database from Notion (all accounts). Use to connect a meeting or person to a company/account. Part of meeting prep.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: 'get_notion_meeting_notes',
    description:
      "Read Notion AI meeting SUMMARY only (decisions, action items, perspectives) — never the raw transcript. For day prep (מחר / תכין אותי / כולם) pass prepDate ('today'|'tomorrow'|YYYY-MM-DD) WITHOUT a leftover person query so every meeting that day gets prior notes. For a named person pass query (any CRM name; שני↔Shani). Optional date, meetingId, notionUrl. Empty body → לא נמצא בנתונים. Never invent. Never claim no meeting if a matching note was returned.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        date: {
          type: SchemaType.STRING,
          description: "'today' or YYYY-MM-DD to filter notes by meeting/note date (notes from that day). Prefer prepDate for tomorrow/day briefing.",
        },
        prepDate: {
          type: SchemaType.STRING,
          description:
            "Day to prepare for: 'today' | 'tomorrow' | 'היום' | 'מחר' | YYYY-MM-DD. Returns last-60-days summaries matching that day's calendar people/titles. Do not also pass query unless the user named one person.",
        },
        meetingId: {
          type: SchemaType.STRING,
          description: 'Local meeting id to return notes linked to that meeting',
        },
        notionUrl: {
          type: SchemaType.STRING,
          description: 'Notion meeting page URL (app.notion.com or notion.so). Fetches in-page AI notes if not yet synced.',
        },
        notionPageId: {
          type: SchemaType.STRING,
          description: 'Notion meeting page id (32-char hex or dashed UUID)',
        },
        query: {
          type: SchemaType.STRING,
          description:
            'Person or meeting name (any CRM person, not only שני/Shani). Use with date when asking about one named conversation. Omit for day-wide prep.',
        },
      },
    },
  },
  {
    name: 'search_notion',
    description:
      "Search the user's Notion databases by keyword (all accounts): tasks, meetings, people, projects, companies, and meeting notes. Use for: 'תחפש בנושן ...', 'find X in Notion', locating a specific meeting, task, person, project, or note by name.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: { type: SchemaType.STRING, description: 'Keyword to match against titles across all Notion databases' },
      },
      required: ['query'],
    },
  },
  {
    name: 'notion_status',
    description:
      "Check Notion connectivity per account and database. Use when Notion data seems missing, when the user asks 'יש לך גישה לנושן', or to diagnose why a database is not readable (e.g. not shared with the integration).",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: 'get_weather',
    description: 'Get weather forecast for a city. Use for: weather, מזג אוויר, תחזית.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        city: { type: SchemaType.STRING, description: 'City name (e.g. Tel Aviv, London)' },
      },
      required: ['city'],
    },
  },
  {
    name: 'search_flights',
    description: 'Search for flights (origin, destination, date). Use for: טיסות, flights, חיפוש טיסות.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        origin: { type: SchemaType.STRING, description: 'Origin airport or city' },
        destination: { type: SchemaType.STRING, description: 'Destination airport or city' },
        date: { type: SchemaType.STRING, description: 'Date YYYY-MM-DD (optional)' },
      },
      required: ['origin', 'destination'],
    },
  },
  {
    name: 'create_task',
    description:
      "Create a new task. Use for: 'תייצר משימה', 'הוסף משימה', 'create task', 'add task'.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        title: { type: SchemaType.STRING, description: 'Task title (required)' },
        dueDate: { type: SchemaType.STRING, description: 'Due date in YYYY-MM-DD format (optional)' },
        priority: {
          type: SchemaType.STRING,
          format: 'enum',
          description: "Priority: 'high', 'medium', or 'low' (default: medium)",
          enum: ['high', 'medium', 'low'],
        },
        projectId: { type: SchemaType.STRING, description: 'Project ID to link (optional)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'find_and_toggle_task',
    description:
      "Find a task by searching its title and toggle its done status. Use for: 'סמן X כבוצעת', 'mark X as done', 'בטל סימון'.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: { type: SchemaType.STRING, description: 'Keyword to find the task by title' },
      },
      required: ['query'],
    },
  },
  {
    name: 'add_meeting_notes',
    description:
      "Add or update notes for a meeting. Use 'next' as meetingTitle to target the next upcoming meeting. Use for: 'תוסיף הערות', 'add notes to meeting'.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        meetingTitle: {
          type: SchemaType.STRING,
          description: "Meeting title keyword to search for, or 'next' for the next upcoming meeting",
        },
        notes: { type: SchemaType.STRING, description: 'Notes to set on the meeting' },
      },
      required: ['meetingTitle', 'notes'],
    },
  },
  {
    name: 'sync_calendar',
    description:
      "Sync meetings from Google/Apple Calendar for today and the next 7 days. Use for: 'תסנק פגישות', 'sync calendar', 'עדכן פגישות'.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: 'search_gmail',
    description:
      "Search Gmail inbox. Use for: email, מייל, gmail, unread messages, from:sender, subject queries.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        query: {
          type: SchemaType.STRING,
          description: 'Gmail search query (e.g. is:unread, from:boss, subject:invoice)',
        },
        max: { type: SchemaType.NUMBER, description: 'Max messages to return (default 10)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'sync_ibkr_trades',
    description:
      'Import Interactive Brokers trade-confirmation emails from Gmail into the trading database (deduplicated). Use for: IBKR import, ייבוא עסקאות, סנכרון מסחר, IBKR daily import.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        maxEmails: { type: SchemaType.NUMBER, description: 'Max emails to scan (default 100)' },
      },
    },
  },
  {
    name: 'get_cashflow_insights',
    description:
      'Deterministic personal cash-flow insights for a month: overspend per category, new or pricier recurring charges, anomalies, year-over-year shifts, savings rate and next-month forecast. Use for: מה קרה לי החודש כספית, תובנות תזרים, על מה בזבזתי יותר, תחזית הוצאות, איך נראה החודש.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        month: { type: SchemaType.STRING, description: 'Month as YYYY-MM. Defaults to the current month.' },
      },
    },
  },
  {
    name: 'get_trading_insights',
    description:
      'Deterministic trading-journal metrics and insights: win rate, profit factor, expectancy, drawdown, symbol concentration, revenge-trading and over-trading patterns, plus what the data cannot show. Use for: איך אני סוחר, תובנות מסחר, win rate, האם אני רווחי, יומן מסחר.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        period: {
          type: SchemaType.STRING,
          description: "'week' | 'month' | 'quarter' | 'all' (default 'month')",
        },
      },
    },
  },
  {
    name: 'get_finance_overview',
    description:
      'The whole financial picture: bank balance, portfolio at cost, months of runway, savings rate including investments, broker deposits trend and currency exposure. Use for: כמה כסף יש לי, תמונה כוללת, מסלול, הון, חשיפה מטבעית.',
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: 'get_recurring_charges',
    description:
      'Recurring charges detected in the bank/card history with their cadence, average amount and annualized cost. Use for: חיובים קבועים, מנויים, כמה עולים לי המנויים, הוראות קבע.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        lookbackMonths: { type: SchemaType.NUMBER, description: 'Months of history to scan (default 12)' },
      },
    },
  },
  {
    name: 'get_whatsapp_status',
    description:
      'Get WhatsApp bridge connection status (connected, QR available, self JID). Use for: whatsapp status, וואטסאפ מחובר.',
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: 'list_whatsapp_groups',
    description:
      'List watched WhatsApp groups and their alert/summary rules. Use for: whatsapp groups, קבוצות וואטסאפ.',
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: 'summarize_whatsapp_groups',
    description:
      'Summarize WhatsApp group conversations from stored history and return the summary text inline in your reply (does NOT depend on the live bridge). Use for: whatsapp summary, סיכום וואטסאפ, סיכום קבוצות, daily whatsapp digest, תריץ סיכום.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        groupJid: {
          type: SchemaType.STRING,
          description: 'Optional: summarize one group by JID. Omit to summarize all watched/enabled groups.',
        },
        window: { type: SchemaType.STRING, description: WA_WINDOW_PARAM_DESC },
        sinceHour: { type: SchemaType.NUMBER, description: WA_SINCE_HOUR_DESC },
        untilHour: { type: SchemaType.NUMBER, description: WA_UNTIL_HOUR_DESC },
      },
    },
  },
  {
    name: 'whatsapp_now',
    description:
      'Prioritized briefing across ALL watched WhatsApp groups from stored history — answers "what is happening now in my groups", and also "what happened today/yesterday" or in a specific hour range when window/hours are given. Use for: מה קורה לי עכשיו בקבוצות, מה חדש בוואטסאפ, מה היה היום בקבוצות, מה היה אתמול, catch me up on whatsapp.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        window: { type: SchemaType.STRING, description: WA_WINDOW_PARAM_DESC },
        sinceHour: { type: SchemaType.NUMBER, description: WA_SINCE_HOUR_DESC },
        untilHour: { type: SchemaType.NUMBER, description: WA_UNTIL_HOUR_DESC },
      },
    },
  },
  {
    name: 'query_whatsapp_group',
    description:
      'Answer what a SPECIFIC WhatsApp group is discussing, from stored history, optionally limited to today / yesterday / an hour range. Use for: על מה מדברים בקבוצה X, מה קורה בקבוצה, מה היה היום בקבוצה X, מה נכתב בין 14 ל-16, what are they talking about in <group>, סכם לי את קבוצה X.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        groupName: {
          type: SchemaType.STRING,
          description: 'Group name to look up (fuzzy match against watched groups). Provide this or groupJid.',
        },
        groupJid: { type: SchemaType.STRING, description: 'Exact group JID (optional if groupName given).' },
        window: { type: SchemaType.STRING, description: WA_WINDOW_PARAM_DESC },
        sinceHour: { type: SchemaType.NUMBER, description: WA_SINCE_HOUR_DESC },
        untilHour: { type: SchemaType.NUMBER, description: WA_UNTIL_HOUR_DESC },
        mode: {
          type: SchemaType.STRING,
          description: "'summary' (default), or 'topics' for a breakdown of what is being discussed.",
        },
      },
    },
  },
  {
    name: 'whatsapp_group_insights',
    description:
      'Learned-style original insights about a specific WhatsApp group — recurring themes, tone, who drives conversation, plus Hugo\'s own observations. Use for: תובנות על הקבוצה, מה הסגנון בקבוצה, נתח לי את הקבוצה, insights on <group>.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        groupName: { type: SchemaType.STRING, description: 'Group name to look up (fuzzy match). Provide this or groupJid.' },
        groupJid: { type: SchemaType.STRING, description: 'Exact group JID (optional if groupName given).' },
        window: { type: SchemaType.STRING, description: WA_WINDOW_PARAM_DESC },
        sinceHour: { type: SchemaType.NUMBER, description: WA_SINCE_HOUR_DESC },
        untilHour: { type: SchemaType.NUMBER, description: WA_UNTIL_HOUR_DESC },
      },
    },
  },
]

const FALLBACK_AGENT_IDS = [
  '01_Hugo_orchestrator',
  '02_agent_trainer',
  '03_morning_briefing',
  '04_meeting_prep_herald',
  '05_ibkr_daily_import',
  '06_calendar_optimizer',
  '07_email_assistant',
  '08_startup_coo',
]

/** Registered agent ids, falling back to the known set if `A_Agents/` is unreadable. */
function agentIdEnum(): string[] {
  const ids = getRunnableAgentIds()
  return ids.length > 0 ? ids : FALLBACK_AGENT_IDS
}

function buildRunAbcAgentTool(): FunctionDeclaration {
  const agentIds = getRunnableAgentIds()
  const fallback = FALLBACK_AGENT_IDS
  return {
    name: 'run_abc_agent',
    description:
      'Invoke any registered ABC specialist agent. Use for: calendar/יומן, morning brief/בוקר, meeting prep/פגישה, email/מייל, IBKR/מסחר, startup COO, Hugo orchestration, agent training.',
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        agentId: {
          type: SchemaType.STRING,
          format: 'enum',
          description: 'Agent to invoke',
          enum: agentIds.length > 0 ? agentIds : fallback,
        },
        message: {
          type: SchemaType.STRING,
          description: 'The task or question for the specialist agent',
        },
      },
      required: ['agentId', 'message'],
    },
  }
}

function buildLogAgentFeedbackTool(): FunctionDeclaration {
  return {
    name: 'log_agent_feedback',
    description:
      "Record a correction the user describes about how one of the automated agents behaved, routing it to that agent for human review. Use when the user complains about or corrects an automated flow — e.g. 'הסיכום בוקר תמיד מפספס את...', 'אופטי טועה ב...', 'תגיד לסוכן היומן ש...', 'the email assistant should stop...'. Pick the agentId whose area matches the complaint; use 01_Hugo_orchestrator when unclear. Pass the user's wording verbatim as feedback. This queues the fix for review — it does NOT change the agent's behavior immediately.",
    parameters: {
      type: SchemaType.OBJECT,
      properties: {
        agentId: {
          type: SchemaType.STRING,
          format: 'enum',
          description: 'The agent the correction applies to',
          enum: agentIdEnum(),
        },
        feedback: {
          type: SchemaType.STRING,
          description: "The correction, in the user's own words (verbatim, not summarized)",
        },
      },
      required: ['agentId', 'feedback'],
    },
  }
}

export function getToolDeclarations(): FunctionDeclaration[] {
  return [...baseToolDeclarations, buildRunAbcAgentTool(), buildLogAgentFeedbackTool()]
}

/** @deprecated prefer getToolDeclarations() */
export const toolDeclarations = getToolDeclarations()

// ─── Tool executor ────────────────────────────────────────────────────────────

type ToolArgs = Record<string, unknown>

export async function executeTool(
  name: string,
  args: ToolArgs,
  caller: Caller,
  ctx?: ToolExecutionContext,
): Promise<unknown> {
  const today = new Date()
  const todayStr = todayIso()

  switch (name) {
    case 'get_today_schedule':
    case 'get_day_schedule': {
      const scopeIds = await getAgentCalendarIds()
      const rawDate =
        name === 'get_day_schedule' ? String(args.date ?? '').trim() : 'today'
      const dayStr = resolveLocalDayArg(rawDate)
      const [calResult, allTasks] = await Promise.all([
        caller.calendar.events({ startDate: dayStr, endDate: dayStr }),
        caller.tasks.list(),
      ])
      const scopedEvents = filterEventsByCalendarScope(calResult.events, scopeIds)
      const dueTasks = allTasks.filter((t) => !t.done && t.dueDate === dayStr)
      return {
        date: dayStr,
        requested: rawDate || 'today',
        events: scopedEvents,
        dueTasks,
        calendarErrors: calResult.googleErrors,
        calendarWarning:
          calResult.googleErrors.length > 0
            ? 'Google Calendar fetch had errors — data may be incomplete (some calendars did not load). Do NOT report zero/low load as fact; tell the user which calendars failed and that meetings may be missing.'
            : undefined,
      }
    }

    case 'get_week_schedule': {
      const scopeIds = await getAgentCalendarIds()
      const weekEnd = addDays(today, 7).toISOString().split('T')[0]
      const [calResult, allTasks] = await Promise.all([
        caller.calendar.events({ startDate: todayStr, endDate: weekEnd }),
        caller.tasks.list(),
      ])
      const scopedEvents = filterEventsByCalendarScope(calResult.events, scopeIds)
      const dueTasks = allTasks.filter(
        (t) => !t.done && t.dueDate && t.dueDate >= todayStr && t.dueDate <= weekEnd,
      )
      return {
        startDate: todayStr,
        endDate: weekEnd,
        events: scopedEvents,
        dueTasks,
        calendarErrors: calResult.googleErrors,
        calendarWarning:
          calResult.googleErrors.length > 0
            ? 'Google Calendar fetch had errors — data may be incomplete (some calendars did not load). Do NOT report zero/low load as fact; tell the user which calendars failed and that meetings may be missing.'
            : undefined,
      }
    }

    case 'get_upcoming_meetings': {
      const scopeIds = await getAgentCalendarIds()
      const limit = (args.limit as number | undefined) ?? 5
      const upcoming = await caller.calendar.upcoming({ limit: 50 })
      const scoped = filterEventsByCalendarScope(upcoming.events, scopeIds).slice(0, limit)
      return {
        events: scoped,
        calendarErrors: upcoming.googleErrors,
        calendarWarning:
          upcoming.googleErrors.length > 0
            ? 'Google Calendar fetch had errors — data may be incomplete (some calendars did not load). Do NOT claim there are no upcoming meetings; tell the user which calendars failed.'
            : undefined,
      }
    }

    case 'get_next_meeting_brief': {
      const scopeIds = await getAgentCalendarIds()
      const [upcomingResult, allMeetings, allPeople, allTasks] = await Promise.all([
        caller.calendar.upcoming({ limit: 50 }),
        caller.meetings.list(),
        caller.people.list(),
        caller.tasks.list(),
      ])

      const scopedUpcoming = filterEventsByCalendarScope(upcomingResult.events, scopeIds)
      const calEvent = scopedUpcoming[0] ?? null
      if (!calEvent) return { calEvent: null, message: 'No upcoming events found in calendar.' }

      const linkedMeeting =
        allMeetings.find(
          (m) =>
            m.calendarEventId === calEvent.id ||
            (m.title === calEvent.title && m.date === calEvent.start.split('T')[0]),
        ) ?? null

      let attendees: typeof allPeople = []
      let openTasks: typeof allTasks = []
      let project: Awaited<ReturnType<typeof caller.projects.getById>> | null = null

      if (linkedMeeting) {
        attendees = allPeople.filter((p) => linkedMeeting.peopleIds.includes(p.id))
        openTasks = allTasks.filter((t) => t.meetingId === linkedMeeting.id && !t.done)
        if (linkedMeeting.projectId) {
          project = await caller.projects.getById({ id: linkedMeeting.projectId })
        }
      }

      return { calEvent, meeting: linkedMeeting, attendees, openTasks, project }
    }

    case 'get_open_tasks': {
      const priority = args.priority as string | undefined
      let all = await caller.tasks.list()
      all = all.filter((t) => !t.done)
      if (priority) all = all.filter((t) => t.priority === priority)
      const order: Record<string, number> = { high: 0, medium: 1, low: 2 }
      all.sort((a, b) => (order[a.priority] ?? 1) - (order[b.priority] ?? 1))
      return { tasks: all, count: all.length }
    }

    case 'get_overdue_tasks': {
      const all = await caller.tasks.list()
      const overdue = all.filter((t) => !t.done && t.dueDate && t.dueDate < todayStr)
      overdue.sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''))
      return { tasks: overdue, count: overdue.length }
    }

    case 'get_calendar_conflicts': {
      const scopeIds = await getAgentCalendarIds()
      const days = (args.days as number | undefined) ?? 7
      const endDate = addDays(today, days).toISOString().split('T')[0]
      const conflicts = await caller.calendar.conflicts({
        startDate: todayStr,
        endDate,
        calendarIds: scopeIds ?? undefined,
      })
      return { conflicts, count: conflicts.length }
    }

    case 'get_projects': {
      const [projects, allTasks] = await Promise.all([
        caller.projects.list(),
        caller.tasks.list(),
      ])
      const open = allTasks.filter((t) => !t.done)
      return {
        projects: projects.map((p) => ({
          ...p,
          openTaskCount: open.filter((t) => t.projectId === p.id).length,
        })),
      }
    }

    case 'get_people': {
      const peopleList = await caller.people.list()
      return { people: peopleList }
    }

    case 'search_person': {
      const query = (args.query as string)?.trim() || ''
      if (!query) return { people: [] }
      const results = await caller.people.search({ query })
      return { people: results, count: results.length }
    }

    case 'save_fact': {
      const content = (args.content as string)?.trim()
      if (!content) return { error: 'content is required' }
      const fact = await caller.facts.create({ content, source: 'conversation' })
      return { fact, saved: true }
    }

    case 'get_reports': {
      const limit = (args.limit as number | undefined) ?? 20
      const items = await caller.facts.list({ limit })
      return { reports: items, count: items.length }
    }

    case 'remember': {
      const content = (args.content as string)?.trim()
      if (!content) return { error: 'content is required' }
      const kind = (args.kind as 'memory' | 'knowledge' | undefined) ?? 'memory'
      const memory = await caller.memory.memories.create({ content, kind, source: 'chat' })
      return { memory, saved: true, note: 'Stored to persistent memory — will be recalled in future conversations.' }
    }

    case 'log_agent_feedback': {
      const agentId = (args.agentId as string)?.trim()
      const feedback = (args.feedback as string)?.trim()
      if (!agentId) return { error: 'agentId is required' }
      if (!feedback) return { error: 'feedback is required' }
      try {
        const result = appendAgentFeedback({ agentId, feedback, channel: ctx?.channel })
        return {
          ...result,
          note: `Correction queued for ${agentId} in M_Memory for human review. Tell the user it was recorded and will be reviewed manually — do NOT claim the behavior already changed.`,
        }
      } catch (err) {
        return { error: err instanceof Error ? err.message : 'Failed to log feedback' }
      }
    }

    case 'update_instruction': {
      const content = (args.content as string)?.trim()
      if (!content) return { error: 'content is required' }
      const mode = (args.mode as 'append' | 'replace' | undefined) ?? 'append'
      const current = await caller.memory.instructions.get()
      const next =
        mode === 'replace' || !current.content.trim()
          ? content
          : `${current.content.trim()}\n${content}`
      await caller.memory.instructions.set({ content: next, enabled: true })
      return { updated: true, mode, note: 'Standing instructions updated — applied to all future runs.' }
    }

    case 'get_notion_tasks': {
      const filter =
        (args.filter as 'overdue' | 'today' | 'tomorrow' | 'soon' | 'all' | undefined) ?? 'all'
      const t = await getNotionTasks()
      if (filter === 'tomorrow') {
        const tomorrow = localTomorrowIso()
        const pooled = [...t.today, ...t.soon, ...t.highPriority]
        const seen = new Set<string>()
        const tasks = pooled.filter((task) => {
          if (task.due !== tomorrow) return false
          const key = `${task.account}:${task.db}:${task.title}`
          if (seen.has(key)) return false
          seen.add(key)
          return true
        })
        return { filter, date: tomorrow, tasks, errors: t.errors }
      }
      const base =
        filter === 'overdue'
          ? { overdue: t.overdue }
          : filter === 'today'
            ? { today: t.today }
            : filter === 'soon'
              ? { soon: t.soon }
              : { overdue: t.overdue, today: t.today, soon: t.soon, highPriority: t.highPriority }
      return { filter, ...base, errors: t.errors }
    }

    case 'get_notion_meetings': {
      const range = (args.range as 'today' | 'tomorrow' | 'upcoming' | undefined) ?? 'today'
      const m = await getNotionMeetings()
      if (range === 'tomorrow') {
        const tomorrow = localTomorrowIso()
        const meetings = [...m.today, ...m.upcoming].filter((x) => x.date === tomorrow)
        return { range, date: tomorrow, meetings, errors: m.errors }
      }
      return {
        range,
        meetings: range === 'upcoming' ? m.upcoming : m.today,
        errors: m.errors,
      }
    }

    case 'get_notion_people': {
      const { entries, errors } = await getNotionEntries('people', { resolveRelations: true })
      return { people: entries, count: entries.length, errors }
    }

    case 'get_notion_projects': {
      const { entries, errors } = await getNotionEntries('projects', { resolveRelations: true })
      return { projects: entries, count: entries.length, errors }
    }

    case 'get_notion_companies': {
      const { entries, errors } = await getNotionEntries('companies', { resolveRelations: true })
      return { companies: entries, count: entries.length, errors }
    }

    case 'get_notion_meeting_notes': {
      const date = (args.date as string | undefined)?.trim()
      const prepDate = (args.prepDate as string | undefined)?.trim()
      const meetingId = (args.meetingId as string | undefined)?.trim()
      const notionUrl = (args.notionUrl as string | undefined)?.trim()
      const notionPageId = (args.notionPageId as string | undefined)?.trim()
      const query = (args.query as string | undefined)?.trim()
      const result = await caller.insights.meetingNotes({
        ...(date ? { date } : {}),
        ...(prepDate ? { prepDate } : {}),
        ...(meetingId ? { meetingId } : {}),
        ...(notionUrl ? { notionUrl } : {}),
        ...(notionPageId ? { notionPageId } : {}),
        ...(query ? { query } : {}),
      })
      return {
        meetingNotes: result.notes.map((n) => ({
          id: n.id,
          title: n.title,
          date: n.date,
          bodyText: n.bodyText,
          snippet: n.snippet,
          meetingId: n.meetingId,
          meetingTitle: n.meetingTitle,
          notionUrl: n.notionUrl,
          sourceKind: 'sourceKind' in n ? n.sourceKind : null,
        })),
        count: result.count,
        source: 'local_db',
        ...('prepFor' in result && result.prepFor ? { prepFor: result.prepFor } : {}),
      }
    }

    case 'search_notion': {
      const query = (args.query as string)?.trim() || ''
      if (!query) return { hits: [], count: 0 }
      const { hits, errors } = await searchNotion(query)
      return { query, hits, count: hits.length, errors }
    }

    case 'notion_status': {
      return await getNotionStatus()
    }

    case 'get_weather': {
      const city = (args.city as string)?.trim() || 'Tel Aviv'
      try {
        const res = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=32.0853&longitude=34.7818&current=temperature_2m,relative_humidity_2m,weather_code&timezone=Asia/Jerusalem`
        )
        if (!res.ok) return { error: 'Weather API unavailable' }
        const data = (await res.json()) as { current?: { temperature_2m?: number; relative_humidity_2m?: number; weather_code?: number } }
        const cur = data.current
        if (!cur) return { error: 'No weather data' }
        return {
          city: city || 'Tel Aviv',
          temperature: cur.temperature_2m,
          humidity: cur.relative_humidity_2m,
          weatherCode: cur.weather_code,
        }
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Weather fetch failed' }
      }
    }

    case 'search_flights': {
      const origin = (args.origin as string)?.trim() || ''
      const destination = (args.destination as string)?.trim() || ''
      const date = (args.date as string)?.trim() || ''
      if (!origin || !destination) return { error: 'origin and destination required' }
      const key = process.env.SERPAPI_KEY
      if (!key) {
        return { message: 'Flight search requires SERPAPI_KEY. Set it in env to enable.', origin, destination, date }
      }
      try {
        const params = new URLSearchParams({
          engine: 'google_flights',
          departure_id: origin,
          arrival_id: destination,
          api_key: key,
        })
        if (date) params.set('outbound_date', date)
        const res = await fetch(`https://serpapi.com/search?${params.toString()}`)
        if (!res.ok) return { error: 'Flight search API error' }
        const data = (await res.json()) as { best_flights?: unknown[]; other_flights?: unknown[] }
        return {
          origin,
          destination,
          date: date || 'any',
          best_flights: data.best_flights ?? [],
          other_flights: (data.other_flights ?? []).slice(0, 5),
        }
      } catch (e) {
        return { error: e instanceof Error ? e.message : 'Flight search failed' }
      }
    }

    case 'create_task': {
      const task = await caller.tasks.create({
        title: args.title as string,
        dueDate: (args.dueDate as string | undefined) ?? null,
        priority: (args.priority as 'high' | 'medium' | 'low' | undefined) ?? 'medium',
        projectId: (args.projectId as string | undefined) ?? null,
      })
      return { task, created: true }
    }

    case 'find_and_toggle_task': {
      const q = (args.query as string).toLowerCase()
      const all = await caller.tasks.list()
      const match = all.find((t) => t.title.toLowerCase().includes(q))
      if (!match) return { found: false, query: args.query }
      const updated = await caller.tasks.toggleDone({ id: match.id })
      return { found: true, task: updated }
    }

    case 'add_meeting_notes': {
      const meetingTitle = args.meetingTitle as string
      const notes = args.notes as string
      const allMeetings = await caller.meetings.list()

      let target: (typeof allMeetings)[number] | null = null

      if (meetingTitle.toLowerCase() === 'next') {
        const upcomingResult = await caller.calendar.upcoming({ limit: 5 })
        const upcoming = upcomingResult.events
        if (upcoming.length > 0) {
          target =
            allMeetings.find(
              (m) =>
                m.calendarEventId === upcoming[0].id ||
                (m.title === upcoming[0].title && m.date === upcoming[0].start.split('T')[0]),
            ) ?? null
        }
        if (!target) {
          const future = allMeetings
            .filter((m) => m.date >= todayStr)
            .sort((a, b) => a.date.localeCompare(b.date))
          target = future[0] ?? null
        }
      } else {
        target =
          allMeetings.find((m) =>
            m.title.toLowerCase().includes(meetingTitle.toLowerCase()),
          ) ?? null
      }

      if (!target) return { found: false, query: meetingTitle }

      await caller.meetings.update({
        id: target.id,
        title: target.title,
        date: target.date,
        time: target.time ?? '09:00',
        notes,
        recurring: target.recurring ?? null,
        recurrenceDay: target.recurrenceDay ?? null,
        projectId: target.projectId ?? null,
        peopleIds: target.peopleIds,
      })
      return { found: true, meetingTitle: target.title }
    }

    case 'sync_calendar': {
      const endDate = addDays(today, 60).toISOString().split('T')[0]
      const result = await caller.meetings.syncFromCalendar({
        startDate: todayStr,
        endDate,
      })
      return { created: result.created, updated: result.updated, deleted: result.deleted }
    }

    case 'search_gmail': {
      const query = (args.query as string)?.trim()
      const max = Math.min((args.max as number | undefined) ?? 10, 20)
      if (!query) return { error: 'query is required' }
      const msgs = await caller.finance.gmailDebug({ query })
      return {
        messages: msgs.slice(0, max).map((m) => ({
          from: m.from,
          subject: m.subject,
          date: m.date,
          snippet: m.bodySnippet,
        })),
        count: msgs.length,
      }
    }

    case 'sync_ibkr_trades': {
      const maxEmails = Math.min((args.maxEmails as number | undefined) ?? 100, 500)
      const result = await caller.finance.syncIBKREmails({ maxEmails })
      return {
        inserted: result.inserted,
        skipped: result.skipped,
        total: result.total,
        subjects: result.subjects.slice(0, 15),
      }
    }

    case 'get_cashflow_insights': {
      const month = (args.month as string | undefined)?.trim() || todayStr.slice(0, 7)
      const { insights, forecast } = await caller.finance.analytics.insights({ month })
      return {
        month,
        forecast,
        insights: insights.map((i) => ({
          kind: i.kind,
          severity: i.severity,
          title: i.title,
          body: i.body,
          amount: i.amount,
          category: i.category,
        })),
      }
    }

    case 'get_trading_insights': {
      const raw = (args.period as string | undefined)?.trim()
      const period = (['week', 'month', 'quarter', 'all'] as const).includes(raw as never)
        ? (raw as 'week' | 'month' | 'quarter' | 'all')
        : 'month'
      const result = await caller.finance.analytics.tradingInsights({ period })
      return {
        period,
        metrics: result.metrics,
        dataQuality: result.dataQuality,
        insights: result.insights.map((i) => ({
          kind: i.kind,
          severity: i.severity,
          title: i.title,
          body: i.body,
        })),
      }
    }

    case 'get_finance_overview': {
      return await caller.finance.analytics.overview()
    }

    case 'get_recurring_charges': {
      const lookbackMonths = Math.min(Math.max((args.lookbackMonths as number | undefined) ?? 12, 3), 24)
      const { items, monthlyFixedTotal } = await caller.finance.analytics.recurring({ lookbackMonths })
      return {
        monthlyFixedTotal,
        items: items.slice(0, 25).map((i) => ({
          label: i.label,
          category: i.category,
          cadence: i.cadence,
          avgAmount: i.avgAmount,
          annualizedCost: i.annualizedCost,
          lastDate: i.lastDate,
          increasedPct: i.increasedPct,
        })),
      }
    }

    case 'get_whatsapp_status': {
      return await caller.whatsapp.connection.status()
    }

    case 'list_whatsapp_groups': {
      const groups = await caller.whatsapp.groups.list()
      return {
        groups: groups.map((g) => ({
          name: g.name,
          jid: g.jid,
          enabled: g.enabled,
          fomoEnabled: g.fomoEnabled,
          labelName: g.labelName,
        })),
        count: groups.length,
      }
    }

    case 'summarize_whatsapp_groups': {
      const groupJid = (args.groupJid as string | undefined)?.trim()
      // Use the DB-backed insights path so a real summary is produced inline, independent
      // of the live WhatsApp bridge / its in-memory buffer.
      if (groupJid) {
        const result = await caller.whatsapp.insights.forGroup({
          groupJid,
          ...waTimeArgs(args, '7d'),
          mode: 'summary',
        })
        return {
          text: result.text,
          messageCount: result.messageCount,
          window: result.window,
          rangeLabel: result.rangeLabel,
        }
      }
      const result = await caller.whatsapp.insights.digest(waTimeArgs(args, '24h'))
      return {
        text: result.text,
        items: result.items,
        window: result.window,
        rangeLabel: result.rangeLabel,
      }
    }

    case 'whatsapp_now': {
      const result = await caller.whatsapp.insights.digest(waTimeArgs(args, '24h'))
      return {
        text: result.text,
        items: result.items,
        window: result.window,
        rangeLabel: result.rangeLabel,
      }
    }

    case 'query_whatsapp_group':
    case 'whatsapp_group_insights': {
      let groupJid = (args.groupJid as string | undefined)?.trim()
      const groupName = (args.groupName as string | undefined)?.trim()
      if (!groupJid && groupName) {
        const groups = await caller.whatsapp.groups.list()
        const q = groupName.toLowerCase()
        const match =
          groups.find((g) => g.name.toLowerCase() === q) ??
          groups.find((g) => g.name.toLowerCase().includes(q)) ??
          groups.find((g) => q.includes(g.name.toLowerCase()))
        groupJid = match?.jid
      }
      if (!groupJid) {
        return { error: 'לא מצאתי קבוצה תואמת. ציין שם קבוצה מדויק יותר.' }
      }
      const mode =
        name === 'whatsapp_group_insights'
          ? 'style'
          : (args.mode as string | undefined) === 'topics'
            ? 'topics'
            : 'summary'
      const result = await caller.whatsapp.insights.forGroup({
        groupJid,
        ...waTimeArgs(args, '7d'),
        mode,
      })
      return {
        text: result.text,
        messageCount: result.messageCount,
        mode: result.mode,
        window: result.window,
        rangeLabel: result.rangeLabel,
      }
    }

    case 'run_abc_agent': {
      const agentId = (args.agentId as string)?.trim()
      const message = (args.message as string)?.trim()
      if (!agentId || !message) return { error: 'agentId and message are required' }
      const { runGeminiAgentChat } = await import('./gemini-agent-engine')
      const { notifyAgentRunComplete } = await import('./agent-notifications')
      const channel = ctx?.channel ?? 'web'
      const result = await runGeminiAgentChat({ agentId, message, channel })
      notifyAgentRunComplete({ agentId, summary: result.text, channel }).catch((err) => {
        console.warn('[run_abc_agent] notify failed:', err)
      })
      return { agentId, response: result.text }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// ─── Gemini intent resolver ───────────────────────────────────────────────────

export async function resolveIntent(
  userMessage: string,
  options?: { channel?: AgentNotifyChannel },
): Promise<string> {
  const geminiKey = process.env.GEMINI_API_KEY
  if (!geminiKey) throw new Error('GEMINI_API_KEY is not set')

  const genAI = new GoogleGenerativeAI(geminiKey)
  const caller = await createApiCaller()
  const toolCtx: ToolExecutionContext | undefined = options?.channel
    ? { channel: options.channel }
    : undefined

  const today = new Date()
  const dateLabel = today.toLocaleDateString('he-IL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const systemInstruction = [
    'You are a personal assistant integrated into ARO — a personal workspace for managing meetings, tasks, projects, and contacts.',
    `Today is ${dateLabel} (${todayIso()}).`,
    'Respond in the same language the user writes in: Hebrew for Hebrew messages, English for English messages.',
    'Be concise. Use line breaks to separate items in lists.',
    'For task lists: group by priority (high first), show due date if set.',
    'For meeting briefings: show time, attendees with roles, project, open tasks, and notes.',
    'Format times as HH:MM. Format dates as day/month/year or in natural language.',
    "Priority labels in Hebrew: גבוהה=high, בינונית=medium, נמוכה=low.",
    'If a calendar event has no linked record in the system database, mention it but still show the event details.',
    'When showing conflicts, describe each overlap clearly with event names and times.',
    'For specialist tasks (calendar/יומן, morning brief/בוקר, meeting prep/פגישה, email/מייל, IBKR, startup COO, Hugo, agent training), use run_abc_agent — the specialist response is delivered in this chat.',
    'This platform is fully synchronous: NEVER promise a later update ("אעדכן אותך", "I\'ll get back to you"). Call run_abc_agent, wait for the result, and include the full answer in this reply.',
    'For WhatsApp group summaries (סיכום וואטסאפ / סיכום קבוצות), call summarize_whatsapp_groups and include the returned summary text directly in this reply.',
    'For time-anchored WhatsApp questions, always pass the time arguments instead of accepting the default rolling window: "היום"/"today" → window="today"; "אתמול"/"yesterday" → window="yesterday"; "בין 14 ל-16"/"מ-9 עד 12" → sinceHour/untilHour (24h clock, Israel time); "מהבוקר" → window="today" with sinceHour=6. Every WhatsApp tool result includes rangeLabel — state that covered range in your reply and never imply a wider range than it.',
    'Notion (all connected accounts) IS accessible to you: use get_notion_meetings, get_notion_tasks (Personal To-do, DT - Action items, Con Action items, DAZ Tasks), get_notion_meeting_notes. For daily/tomorrow prep ("תכין אותי ליום"/"מחר"/"כולם") call get_notion_meeting_notes with prepDate (tomorrow/today) and do NOT pass a leftover person query — brief EVERY meeting that day from prior AI summaries. Named person → query. NEVER say you have no access to Notion — if a database fails, call notion_status and report which database is not shared.',
    'Never redirect the user to Notion as the only place to see agent results.',
    'When the user describes a correction or complaint about how an automated agent behaved (not a one-off request), call log_agent_feedback with the matching agentId and their verbatim wording. Then confirm in exactly this shape: "נרשם לטיפול ב-<agentId>, ייבדק ידנית" (Hebrew) or "Logged for <agentId>, pending manual review" (English). Never imply the behavior already changed.',
  ].join('\n')

  const model = genAI.getGenerativeModel({
    ...getGeminiModelOptions(),
    systemInstruction,
    tools: [{ functionDeclarations: getToolDeclarations() }],
    toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } },
  })

  const chat = model.startChat()
  let result = await chat.sendMessage(userMessage)

  let iterations = 0
  while (iterations < 10) {
    const calls = result.response.functionCalls()
    if (!calls || calls.length === 0) break

    const responses = await Promise.all(
      calls.map(async (call) => {
        let toolResult: unknown
        try {
          toolResult = await executeTool(call.name, call.args as ToolArgs, caller, toolCtx)
        } catch (err) {
          toolResult = { error: err instanceof Error ? err.message : 'Tool execution failed' }
        }
        return { functionResponse: { name: call.name, response: { result: toolResult } } }
      }),
    )

    result = await chat.sendMessage(responses)
    iterations++
  }

  return result.response.text()
}

// ─── Chat message persistence ─────────────────────────────────────────────────

/** Returns the new message id so callers can build a `/chat?message=<id>` deep link. */
export async function saveChatMessage(
  role: 'user' | 'assistant' | 'system',
  content: string,
  source: 'web' | 'telegram' | 'whatsapp' | 'cron',
): Promise<string> {
  const db = getDb()
  const id = 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7)
  const now = new Date().toISOString()
  await db.insert(chatMessages).values({ id, role, content, source, createdAt: now })
  return id
}

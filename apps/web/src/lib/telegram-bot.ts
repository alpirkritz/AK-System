import { GoogleGenerativeAI, FunctionCallingMode, SchemaType } from '@google/generative-ai'
import type { FunctionDeclaration } from '@google/generative-ai'
import { appRouter, createContext } from '@ak-system/api'
import { getDb } from '@ak-system/database'

// ─── Telegram types ───────────────────────────────────────────────────────────

export interface TelegramUpdate {
  update_id: number
  message?: TelegramMessage
}

interface TelegramMessage {
  message_id: number
  from?: { id: number; first_name: string; username?: string }
  chat: { id: number; type: string }
  date: number
  text?: string
}

// ─── Config ───────────────────────────────────────────────────────────────────

function getConfig() {
  const token = process.env.TELEGRAM_BOT_TOKEN
  const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID
  const geminiKey = process.env.GEMINI_API_KEY
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set')
  if (!allowedChatId) throw new Error('TELEGRAM_ALLOWED_CHAT_ID is not set')
  if (!geminiKey) throw new Error('GEMINI_API_KEY is not set')
  return { token, allowedChatId: Number(allowedChatId), geminiKey }
}

// ─── Telegram API ─────────────────────────────────────────────────────────────

export async function sendTelegramMessage(chatId: number, text: string): Promise<void> {
  const { token } = getConfig()
  const url = `https://api.telegram.org/bot${token}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error('[TelegramBot] sendMessage failed:', body)
  }
}

// ─── tRPC caller ─────────────────────────────────────────────────────────────

async function createApiCaller() {
  const db = getDb()
  const ctx = await createContext({ db })
  return appRouter.createCaller(ctx)
}

type Caller = Awaited<ReturnType<typeof createApiCaller>>

// ─── Date helpers ─────────────────────────────────────────────────────────────

function todayIso(): string {
  return new Date().toISOString().split('T')[0]
}

function addDays(d: Date, n: number): Date {
  const r = new Date(d)
  r.setDate(r.getDate() + n)
  return r
}

// ─── Tool declarations ────────────────────────────────────────────────────────

const toolDeclarations: FunctionDeclaration[] = [
  {
    name: 'get_today_schedule',
    description:
      "Get today's calendar events and tasks due today. Use for: 'מה יש לי היום', 'what do I have today', 'דשבורד', 'סיכום'.",
    parameters: { type: SchemaType.OBJECT, properties: {} },
  },
  {
    name: 'get_week_schedule',
    description:
      "Get this week's calendar events and tasks due this week. Use for: 'מה יש לי השבוע', 'this week'.",
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
]

// ─── Tool executor ────────────────────────────────────────────────────────────

type ToolArgs = Record<string, unknown>

async function executeTool(name: string, args: ToolArgs, caller: Caller): Promise<unknown> {
  const today = new Date()
  const todayStr = todayIso()

  switch (name) {
    case 'get_today_schedule': {
      const [events, allTasks] = await Promise.all([
        caller.calendar.events({ startDate: todayStr, endDate: todayStr }),
        caller.tasks.list(),
      ])
      const dueTasks = allTasks.filter((t) => !t.done && t.dueDate === todayStr)
      return { date: todayStr, events, dueTasks }
    }

    case 'get_week_schedule': {
      const weekEnd = addDays(today, 7).toISOString().split('T')[0]
      const [events, allTasks] = await Promise.all([
        caller.calendar.events({ startDate: todayStr, endDate: weekEnd }),
        caller.tasks.list(),
      ])
      const dueTasks = allTasks.filter(
        (t) => !t.done && t.dueDate && t.dueDate >= todayStr && t.dueDate <= weekEnd,
      )
      return { startDate: todayStr, endDate: weekEnd, events, dueTasks }
    }

    case 'get_upcoming_meetings': {
      const limit = (args.limit as number | undefined) ?? 5
      const events = await caller.calendar.upcoming({ limit })
      return { events }
    }

    case 'get_next_meeting_brief': {
      const [upcoming, allMeetings, allPeople, allTasks] = await Promise.all([
        caller.calendar.upcoming({ limit: 10 }),
        caller.meetings.list(),
        caller.people.list(),
        caller.tasks.list(),
      ])

      const calEvent = upcoming[0] ?? null
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
      const days = (args.days as number | undefined) ?? 7
      const endDate = addDays(today, days).toISOString().split('T')[0]
      const conflicts = await caller.calendar.conflicts({ startDate: todayStr, endDate })
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
      const people = await caller.people.list()
      return { people }
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
        const upcoming = await caller.calendar.upcoming({ limit: 5 })
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
      const endDate = addDays(today, 7).toISOString().split('T')[0]
      const result = await caller.meetings.syncFromCalendar({
        startDate: todayStr,
        endDate,
      })
      return { created: result.created, updated: result.updated, deleted: result.deleted }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}

// ─── Gemini intent resolver ───────────────────────────────────────────────────

async function resolveIntent(userMessage: string): Promise<string> {
  const { geminiKey } = getConfig()
  const genAI = new GoogleGenerativeAI(geminiKey)
  const caller = await createApiCaller()

  const today = new Date()
  const dateLabel = today.toLocaleDateString('he-IL', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  const systemInstruction = [
    'You are a personal assistant integrated into AK System — a personal workspace for managing meetings, tasks, projects, and contacts.',
    `Today is ${dateLabel} (${todayIso()}).`,
    'Respond in the same language the user writes in: Hebrew for Hebrew messages, English for English messages.',
    'Be concise. Use line breaks to separate items in lists.',
    'For task lists: group by priority (high first), show due date if set.',
    'For meeting briefings: show time, attendees with roles, project, open tasks, and notes.',
    'Format times as HH:MM. Format dates as day/month/year or in natural language.',
    "Priority labels in Hebrew: גבוהה=high, בינונית=medium, נמוכה=low.",
    'If a calendar event has no linked record in the system database, mention it but still show the event details.',
    'When showing conflicts, describe each overlap clearly with event names and times.',
  ].join('\n')

  const model = genAI.getGenerativeModel({
    model: 'gemini-2.0-flash',
    systemInstruction,
    tools: [{ functionDeclarations: toolDeclarations }],
    toolConfig: { functionCallingConfig: { mode: FunctionCallingMode.AUTO } },
  })

  const chat = model.startChat()
  let result = await chat.sendMessage(userMessage)

  // Agentic loop: keep handling function calls until Gemini returns final text
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

  return result.response.text()
}

// ─── Main update handler ──────────────────────────────────────────────────────

export async function handleTelegramUpdate(update: TelegramUpdate): Promise<void> {
  const { allowedChatId } = getConfig()
  const message = update.message
  if (!message?.text) return

  const chatId = message.chat.id
  if (chatId !== allowedChatId) {
    console.warn(`[TelegramBot] Rejected message from unauthorized chat ID: ${chatId}`)
    return
  }

  const userText = message.text.trim()
  console.log(`[TelegramBot] Received: "${userText}"`)

  try {
    const response = await resolveIntent(userText)
    await sendTelegramMessage(chatId, response || 'לא הצלחתי לקבל תשובה.')
  } catch (err) {
    console.error('[TelegramBot] Error:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    await sendTelegramMessage(chatId, `שגיאה: ${msg}`)
  }
}

/**
 * Notion REST client — multi-account.
 *
 * Reads tasks + meetings across every configured Notion account (see
 * `notion-config.ts`), exposes on-demand queries for the agent tools, and
 * pre-fetches live context for agent prompts. Every account/database fetch is
 * fault-tolerant: one failing database never blanks the whole result.
 */

import {
  getAssistantTarget,
  getDatabasesByType,
  getNotionAccounts,
  isNotionConfigured,
  type NotionDbType,
} from './notion-config'

const NOTION_VERSION = '2022-06-28'

const DONE_STATUSES = new Set([
  'done', 'complete', 'completed', 'closed', 'cancelled', 'canceled', 'archived', 'resolved',
])

export interface NotionTask {
  account: string
  db: string
  title: string
  due: string
  status: string
  priority: string
  assignee: string
}

export interface NotionMeeting {
  account: string
  db: string
  title: string
  date: string
  time: string
  attendees: string
  status: string
}

export interface NotionSearchHit {
  account: string
  db: string
  type: NotionDbType
  title: string
  date: string
  status: string
}

export interface NotionFetchError {
  account: string
  db: string
  message: string
}

export interface NotionContext {
  today: string
  tasks: {
    overdue: NotionTask[]
    today: NotionTask[]
    soon: NotionTask[]
    highPriority: NotionTask[]
  }
  meetings: {
    today: NotionMeeting[]
    upcoming: NotionMeeting[]
  }
  calendarReview: string
  errors: NotionFetchError[]
}

export interface NotionStatus {
  configured: boolean
  accounts: Array<{
    label: string
    databases: Array<{ name: string; type: NotionDbType; ok: boolean; error?: string }>
  }>
}

function getUserName(): string {
  return process.env.NOTION_USER_NAME ?? 'Alpir Kritzler'
}

function todayIso(): string {
  return new Date().toISOString().split('T')[0]!
}

function soonIso(): string {
  const d = new Date()
  d.setDate(d.getDate() + 3)
  return d.toISOString().split('T')[0]!
}

function weekAheadIso(): string {
  const d = new Date()
  d.setDate(d.getDate() + 7)
  return d.toISOString().split('T')[0]!
}

async function notionRequest<T>(token: string, method: string, apiPath: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.notion.com/v1${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Notion API ${res.status}: ${err.slice(0, 200)}`)
  }
  return res.json() as Promise<T>
}

type NotionProp = Record<string, unknown>

function plain(prop: NotionProp | undefined): string {
  if (!prop || typeof prop !== 'object') return ''
  const t = prop.type as string
  if (t === 'title') {
    return ((prop.title as Array<{ plain_text?: string }>) ?? [])
      .map((x) => x.plain_text ?? '').join('')
  }
  if (t === 'rich_text') {
    return ((prop.rich_text as Array<{ plain_text?: string }>) ?? [])
      .map((x) => x.plain_text ?? '').join('')
  }
  if (t === 'select' && prop.select) return (prop.select as { name?: string }).name ?? ''
  if (t === 'status' && prop.status) return (prop.status as { name?: string }).name ?? ''
  if (t === 'date' && prop.date) {
    const start = (prop.date as { start?: string }).start ?? ''
    return start.split('T')[0] ?? ''
  }
  if (t === 'people') {
    return ((prop.people as Array<{ name?: string }>) ?? [])
      .map((p) => p.name ?? '').filter(Boolean).join(', ')
  }
  return ''
}

function getTitle(props: Record<string, NotionProp>): string {
  for (const v of Object.values(props)) {
    if (v?.type === 'title') return plain(v)
  }
  return ''
}

function isDone(props: Record<string, NotionProp>): boolean {
  for (const [pn, pv] of Object.entries(props)) {
    if (pv?.type === 'checkbox' && pn.toLowerCase().includes('done') && pv.checkbox) return true
    if (pv?.type === 'status' || pv?.type === 'select') {
      if (DONE_STATUSES.has(plain(pv).toLowerCase())) return true
    }
  }
  return false
}

function getDue(props: Record<string, NotionProp>): string {
  for (const pv of Object.values(props)) {
    if (pv?.type === 'date') {
      const v = plain(pv)
      if (v) return v.slice(0, 10)
    }
  }
  return ''
}

/** Full ISO start (with time when present) of the first date property. */
function getDateStart(props: Record<string, NotionProp>): string {
  for (const pv of Object.values(props)) {
    if (pv?.type === 'date' && pv.date) {
      const start = (pv.date as { start?: string }).start ?? ''
      if (start) return start
    }
  }
  return ''
}

function getTimeLabel(props: Record<string, NotionProp>): string {
  const start = getDateStart(props)
  if (start.includes('T')) {
    const t = start.split('T')[1] ?? ''
    return t.slice(0, 5)
  }
  return ''
}

function getStatus(props: Record<string, NotionProp>): string {
  const statusProp = Object.values(props).find((p) => p?.type === 'status')
  return statusProp ? plain(statusProp) : ''
}

function getPriority(props: Record<string, NotionProp>): string {
  for (const [pn, pv] of Object.entries(props)) {
    if (pn.toLowerCase().includes('priority') && (pv?.type === 'select' || pv?.type === 'status')) {
      return plain(pv)
    }
  }
  return ''
}

function getAssignee(props: Record<string, NotionProp>): string {
  for (const [pn, pv] of Object.entries(props)) {
    if (pv?.type === 'people' && /assign|owner|person|who|attend|participant/i.test(pn)) return plain(pv)
  }
  for (const pv of Object.values(props)) {
    if (pv?.type === 'people') return plain(pv)
  }
  return ''
}

async function queryDatabase(
  token: string,
  dbId: string,
): Promise<Array<{ id?: string; properties: Record<string, NotionProp> }>> {
  const pages: Array<{ id?: string; properties: Record<string, NotionProp> }> = []
  let cursor: string | undefined
  do {
    const body: Record<string, unknown> = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
    const data = await notionRequest<{
      results: Array<{ id?: string; properties: Record<string, NotionProp> }>
      has_more: boolean
      next_cursor: string | null
    }>(token, 'POST', `/databases/${dbId}/query`, body)
    pages.push(...data.results)
    cursor = data.has_more ? data.next_cursor ?? undefined : undefined
  } while (cursor)
  return pages
}

function triage(task: NotionTask, today: string, soon: string): 'overdue' | 'today' | 'soon' | 'high' | 'skip' {
  const due = task.due
  const pri = task.priority.toLowerCase()
  if (due && due < today) return 'overdue'
  if (due === today) return 'today'
  if (pri === 'high' || pri === 'urgent' || pri === 'critical') return 'high'
  if (due && due <= soon) return 'soon'
  return 'skip'
}

// ─── Tasks ─────────────────────────────────────────────────────────────────

export interface NotionTasksResult {
  overdue: NotionTask[]
  today: NotionTask[]
  soon: NotionTask[]
  highPriority: NotionTask[]
  errors: NotionFetchError[]
}

export async function getNotionTasks(): Promise<NotionTasksResult> {
  const user = getUserName()
  const today = todayIso()
  const soon = soonIso()
  const buckets: NotionTasksResult = {
    overdue: [],
    today: [],
    soon: [],
    highPriority: [],
    errors: [],
  }
  const seen = new Set<string>()

  for (const { accountLabel, token, database } of getDatabasesByType('tasks')) {
    let pages: Array<{ properties: Record<string, NotionProp> }>
    try {
      pages = await queryDatabase(token, database.id)
    } catch (err) {
      buckets.errors.push({
        account: accountLabel,
        db: database.name,
        message: err instanceof Error ? err.message : 'query failed',
      })
      continue
    }
    for (const page of pages) {
      const props = page.properties
      if (isDone(props)) continue
      const title = getTitle(props).trim()
      if (!title) continue
      const assignee = getAssignee(props)
      const isPersonal = /personal/i.test(database.name)
      if (assignee && !assignee.includes(user) && !isPersonal) continue
      if (!assignee && !isPersonal) continue

      const task: NotionTask = {
        account: accountLabel,
        db: database.name,
        title,
        due: getDue(props),
        status: getStatus(props),
        priority: getPriority(props),
        assignee,
      }
      const key = `${task.account}:${task.db}:${task.title}`
      if (seen.has(key)) continue
      seen.add(key)

      const level = triage(task, today, soon)
      if (level === 'overdue') buckets.overdue.push(task)
      else if (level === 'today') buckets.today.push(task)
      else if (level === 'soon') buckets.soon.push(task)
      else if (level === 'high') buckets.highPriority.push(task)
    }
  }

  const sort = (a: NotionTask, b: NotionTask) => (a.due || '9999').localeCompare(b.due || '9999')
  buckets.overdue.sort(sort)
  buckets.today.sort(sort)
  buckets.soon.sort(sort)
  return buckets
}

// ─── Meetings ────────────────────────────────────────────────────────────────

export interface NotionMeetingsResult {
  today: NotionMeeting[]
  upcoming: NotionMeeting[]
  errors: NotionFetchError[]
}

export async function getNotionMeetings(): Promise<NotionMeetingsResult> {
  const today = todayIso()
  const weekAhead = weekAheadIso()
  const result: NotionMeetingsResult = { today: [], upcoming: [], errors: [] }
  const seen = new Set<string>()

  for (const { accountLabel, token, database } of getDatabasesByType('meetings')) {
    let pages: Array<{ properties: Record<string, NotionProp> }>
    try {
      pages = await queryDatabase(token, database.id)
    } catch (err) {
      result.errors.push({
        account: accountLabel,
        db: database.name,
        message: err instanceof Error ? err.message : 'query failed',
      })
      continue
    }
    for (const page of pages) {
      const props = page.properties
      const title = getTitle(props).trim()
      if (!title) continue
      const date = getDue(props)
      const meeting: NotionMeeting = {
        account: accountLabel,
        db: database.name,
        title,
        date,
        time: getTimeLabel(props),
        attendees: getAssignee(props),
        status: getStatus(props),
      }
      const key = `${meeting.account}:${meeting.db}:${meeting.title}:${meeting.date}`
      if (seen.has(key)) continue
      seen.add(key)

      if (date === today) result.today.push(meeting)
      else if (date > today && date <= weekAhead) result.upcoming.push(meeting)
    }
  }

  const sort = (a: NotionMeeting, b: NotionMeeting) =>
    `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`)
  result.today.sort(sort)
  result.upcoming.sort(sort)
  return result
}

// ─── Search ────────────────────────────────────────────────────────────────

export async function searchNotion(
  query: string,
  limit = 25,
): Promise<{ hits: NotionSearchHit[]; errors: NotionFetchError[] }> {
  const q = query.trim().toLowerCase()
  const hits: NotionSearchHit[] = []
  const errors: NotionFetchError[] = []
  if (!q) return { hits, errors }

  const targets = [...getDatabasesByType('tasks'), ...getDatabasesByType('meetings')]
  for (const { accountLabel, token, database } of targets) {
    let pages: Array<{ properties: Record<string, NotionProp> }>
    try {
      pages = await queryDatabase(token, database.id)
    } catch (err) {
      errors.push({
        account: accountLabel,
        db: database.name,
        message: err instanceof Error ? err.message : 'query failed',
      })
      continue
    }
    for (const page of pages) {
      const props = page.properties
      const title = getTitle(props).trim()
      if (!title || !title.toLowerCase().includes(q)) continue
      hits.push({
        account: accountLabel,
        db: database.name,
        type: database.type,
        title,
        date: getDue(props),
        status: getStatus(props),
      })
      if (hits.length >= limit) return { hits, errors }
    }
  }
  return { hits, errors }
}

// ─── Connection status ───────────────────────────────────────────────────────

export async function getNotionStatus(): Promise<NotionStatus> {
  const accounts = getNotionAccounts()
  const status: NotionStatus = { configured: isNotionConfigured(), accounts: [] }

  for (const account of accounts) {
    const databases: NotionStatus['accounts'][number]['databases'] = []
    for (const database of account.databases) {
      try {
        await notionRequest(account.token, 'POST', `/databases/${database.id}/query`, { page_size: 1 })
        databases.push({ name: database.name, type: database.type, ok: true })
      } catch (err) {
        databases.push({
          name: database.name,
          type: database.type,
          ok: false,
          error: err instanceof Error ? err.message : 'query failed',
        })
      }
    }
    status.accounts.push({ label: account.label, databases })
  }
  return status
}

// ─── Calendar Review page (assistant DB) ─────────────────────────────────────

async function fetchBlockText(token: string, pageId: string, depth = 0): Promise<string[]> {
  if (depth > 3) return []
  const lines: string[] = []
  const data = await notionRequest<{ results: Array<Record<string, unknown>> }>(
    token,
    'GET',
    `/blocks/${pageId}/children?page_size=100`,
  )
  for (const block of data.results) {
    const type = block.type as string
    if (type === 'table' && block.has_children) {
      const rows = await notionRequest<{ results: Array<Record<string, unknown>> }>(
        token,
        'GET',
        `/blocks/${block.id as string}/children?page_size=100`,
      )
      for (const row of rows.results) {
        if (row.type === 'table_row') {
          const cells = (row.table_row as { cells: Array<Array<{ plain_text?: string }>> }).cells
          lines.push('| ' + cells.map((c) => c.map((x) => x.plain_text ?? '').join('')).join(' | ') + ' |')
        }
      }
    } else if (type && block[type]) {
      const rt = (block[type] as { rich_text?: Array<{ plain_text?: string }> }).rich_text ?? []
      const txt = rt.map((x) => x.plain_text ?? '').join('')
      if (txt.trim()) lines.push(txt)
    }
    if (block.has_children && type !== 'table') {
      lines.push(...await fetchBlockText(token, block.id as string, depth + 1))
    }
  }
  return lines
}

async function fetchTodayCalendarReview(): Promise<string> {
  const target = getAssistantTarget()
  if (!target) return ''
  const today = todayIso()
  let pages: Array<{ id?: string; properties: Record<string, NotionProp> }>
  try {
    pages = await queryDatabase(target.token, target.databaseId)
  } catch {
    return ''
  }

  for (const page of pages) {
    const title = getTitle(page.properties)
    if (/Calendar Review/i.test(title) && title.includes(today)) {
      if (page.id) return (await fetchBlockText(target.token, page.id)).join('\n')
    }
  }
  return ''
}

// ─── Aggregated context for prompt injection ─────────────────────────────────

export async function getNotionContext(): Promise<NotionContext> {
  if (!isNotionConfigured()) {
    throw new Error('Notion is not configured (set NOTION_ACCOUNTS or NOTION_API_KEY)')
  }
  const [tasks, meetings, calendarReview] = await Promise.all([
    getNotionTasks(),
    getNotionMeetings(),
    fetchTodayCalendarReview(),
  ])
  return {
    today: todayIso(),
    tasks: {
      overdue: tasks.overdue,
      today: tasks.today,
      soon: tasks.soon,
      highPriority: tasks.highPriority,
    },
    meetings: { today: meetings.today, upcoming: meetings.upcoming },
    calendarReview,
    errors: [...tasks.errors, ...meetings.errors],
  }
}

function meetingLine(m: NotionMeeting): string {
  const when = [m.date, m.time].filter(Boolean).join(' ')
  const who = m.attendees ? ` — ${m.attendees}` : ''
  return `- ${when ? `${when} ` : ''}${m.title} (${m.account})${who}`
}

export function formatNotionContextForPrompt(ctx: NotionContext): string {
  const lines: string[] = [
    `## Live Notion Context (${ctx.today}) — all accounts`,
    '',
    '### Meetings — Today',
    ...ctx.meetings.today.map(meetingLine),
    ...(ctx.meetings.today.length === 0 ? ['- None'] : []),
    '',
    '### Meetings — Upcoming (7 days)',
    ...ctx.meetings.upcoming.slice(0, 15).map(meetingLine),
    ...(ctx.meetings.upcoming.length === 0 ? ['- None'] : []),
    '',
    '### Tasks — Due Today',
    ...ctx.tasks.today.map((t) => `- [${t.priority || '?'}] ${t.title} (${t.account}/${t.db}, status: ${t.status || 'open'})`),
    ...(ctx.tasks.today.length === 0 ? ['- None'] : []),
    '',
    '### Tasks — Overdue',
    ...ctx.tasks.overdue.slice(0, 15).map((t) => `- [${t.priority || '?'}] ${t.title} due ${t.due} (${t.account}/${t.db})`),
    ...(ctx.tasks.overdue.length === 0 ? ['- None'] : []),
    '',
    '### Tasks — Soon (3 days)',
    ...ctx.tasks.soon.map((t) => `- ${t.title} due ${t.due} (${t.account}/${t.db})`),
    ...(ctx.tasks.soon.length === 0 ? ['- None'] : []),
    '',
    '### Calendar Review',
    ctx.calendarReview || '_No calendar review page found for today._',
  ]
  if (ctx.errors.length > 0) {
    lines.push(
      '',
      '### Notion access warnings',
      ...ctx.errors.map(
        (e) => `- ⚠️ ${e.account} / ${e.db}: ${e.message} (share this database with the integration in Notion)`,
      ),
    )
  }
  return lines.join('\n')
}

// ─── Notion Inbox write (assistant DB) ────────────────────────────────────────

let cachedTitleProp: string | null = null

async function getAssistantDbTitleProp(token: string, databaseId: string): Promise<string> {
  if (cachedTitleProp) return cachedTitleProp
  const data = await notionRequest<{ properties: Record<string, { type: string }> }>(
    token,
    'GET',
    `/databases/${databaseId}`,
  )
  for (const [name, prop] of Object.entries(data.properties)) {
    if (prop.type === 'title') {
      cachedTitleProp = name
      return name
    }
  }
  cachedTitleProp = 'Name'
  return 'Name'
}

function bodyToBlocks(body: string): Array<Record<string, unknown>> {
  const chunks: string[] = []
  const paragraphs = body.split(/\n{2,}/)
  for (const para of paragraphs) {
    const text = para.trim()
    if (!text) continue
    for (let i = 0; i < text.length; i += 1800) {
      chunks.push(text.slice(i, i + 1800))
    }
  }
  if (chunks.length === 0) chunks.push('(empty)')
  return chunks.map((text) => ({
    object: 'block',
    type: 'paragraph',
    paragraph: { rich_text: [{ type: 'text', text: { content: text } }] },
  }))
}

/** Create an Assistant DB page — used as Notion Inbox notification for agent runs. */
export async function notifyNotionInbox(options: {
  title: string
  body: string
  agentId?: string
}): Promise<string | null> {
  const target = getAssistantTarget()
  if (!target) return null
  const titleProp = await getAssistantDbTitleProp(target.token, target.databaseId)
  const page = await notionRequest<{ id: string }>(target.token, 'POST', '/pages', {
    parent: { database_id: target.databaseId },
    properties: {
      [titleProp]: {
        title: [{ type: 'text', text: { content: options.title.slice(0, 200) } }],
      },
    },
    children: bodyToBlocks(options.body),
  })
  return page.id ?? null
}

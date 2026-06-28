/**
 * Notion REST client — pre-fetches live context for agent prompts.
 */

const NOTION_VERSION = '2022-06-28'

const TASK_DATABASES: Record<string, string> = {
  '181e7d50-cb8e-8101-9d8a-e90aa8f9b3ac': 'Personal To-do',
  'a38dba80-f058-4009-b8d9-bce763f10542': 'DT - Action items',
  '20fe7d50-cb8e-805a-9730-cfb2b6e2bfe6': 'Con Action items',
}

const ASSISTANT_DB = '325e7d50-cb8e-80c1-9046-f71dbdf75f9f'

const DONE_STATUSES = new Set([
  'done', 'complete', 'completed', 'closed', 'cancelled', 'canceled', 'archived', 'resolved',
])

export interface NotionTask {
  db: string
  title: string
  due: string
  status: string
  priority: string
  assignee: string
}

export interface NotionContext {
  today: string
  tasks: {
    overdue: NotionTask[]
    today: NotionTask[]
    soon: NotionTask[]
    highPriority: NotionTask[]
  }
  calendarReview: string
}

function getToken(): string {
  const key = process.env.NOTION_API_KEY
  if (!key) throw new Error('NOTION_API_KEY is not set')
  return key
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

async function notionRequest<T>(method: string, apiPath: string, body?: unknown): Promise<T> {
  const res = await fetch(`https://api.notion.com/v1${apiPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${getToken()}`,
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
    if (pv?.type === 'people' && /assign|owner|person|who/i.test(pn)) return plain(pv)
  }
  for (const pv of Object.values(props)) {
    if (pv?.type === 'people') return plain(pv)
  }
  return ''
}

async function queryDatabase(dbId: string): Promise<Array<{ id?: string; properties: Record<string, NotionProp> }>> {
  const pages: Array<{ id?: string; properties: Record<string, NotionProp> }> = []
  let cursor: string | undefined
  do {
    const body: Record<string, unknown> = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
    const data = await notionRequest<{
      results: Array<{ id?: string; properties: Record<string, NotionProp> }>
      has_more: boolean
      next_cursor: string | null
    }>('POST', `/databases/${dbId}/query`, body)
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

async function fetchMyTasks(): Promise<NotionContext['tasks']> {
  const user = getUserName()
  const today = todayIso()
  const soon = soonIso()
  const buckets = {
    overdue: [] as NotionTask[],
    today: [] as NotionTask[],
    soon: [] as NotionTask[],
    highPriority: [] as NotionTask[],
  }
  const seen = new Set<string>()

  for (const [dbId, dbName] of Object.entries(TASK_DATABASES)) {
    let pages: Array<{ properties: Record<string, NotionProp> }>
    try {
      pages = await queryDatabase(dbId)
    } catch {
      continue
    }
    for (const page of pages) {
      const props = page.properties
      if (isDone(props)) continue
      const title = getTitle(props).trim()
      if (!title) continue
      const assignee = getAssignee(props)
      if (assignee && !assignee.includes(user) && dbName !== 'Personal To-do') continue
      if (!assignee && dbName !== 'Personal To-do') continue

      const statusProp = Object.values(props).find((p) => p?.type === 'status')
      const task: NotionTask = {
        db: dbName,
        title,
        due: getDue(props),
        status: statusProp ? plain(statusProp) : '',
        priority: getPriority(props),
        assignee,
      }
      const key = `${task.db}:${task.title}`
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

async function fetchBlockText(pageId: string, depth = 0): Promise<string[]> {
  if (depth > 3) return []
  const lines: string[] = []
  const data = await notionRequest<{ results: Array<Record<string, unknown>> }>(
    'GET',
    `/blocks/${pageId}/children?page_size=100`,
  )
  for (const block of data.results) {
    const type = block.type as string
    if (type === 'table' && block.has_children) {
      const rows = await notionRequest<{ results: Array<Record<string, unknown>> }>(
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
      lines.push(...await fetchBlockText(block.id as string, depth + 1))
    }
  }
  return lines
}

async function fetchTodayCalendarReview(): Promise<string> {
  const today = todayIso()
  let pages: Array<{ id?: string; properties: Record<string, NotionProp> }>
  try {
    pages = await queryDatabase(ASSISTANT_DB)
  } catch {
    return ''
  }

  for (const page of pages) {
    const title = getTitle(page.properties)
    if (/Calendar Review/i.test(title) && title.includes(today)) {
      if (page.id) return (await fetchBlockText(page.id)).join('\n')
    }
  }
  return ''
}

export async function getNotionContext(): Promise<NotionContext> {
  const [tasks, calendarReview] = await Promise.all([
    fetchMyTasks(),
    fetchTodayCalendarReview(),
  ])
  return { today: todayIso(), tasks, calendarReview }
}

export function formatNotionContextForPrompt(ctx: NotionContext): string {
  const lines: string[] = [
    `## Live Notion Context (${ctx.today})`,
    '',
    '### Tasks — Due Today',
    ...ctx.tasks.today.map((t) => `- [${t.priority || '?'}] ${t.title} (${t.db}, status: ${t.status || 'open'})`),
    ...(ctx.tasks.today.length === 0 ? ['- None'] : []),
    '',
    '### Tasks — Overdue',
    ...ctx.tasks.overdue.slice(0, 15).map((t) => `- [${t.priority || '?'}] ${t.title} due ${t.due} (${t.db})`),
    ...(ctx.tasks.overdue.length === 0 ? ['- None'] : []),
    '',
    '### Tasks — Soon (3 days)',
    ...ctx.tasks.soon.map((t) => `- ${t.title} due ${t.due} (${t.db})`),
    ...(ctx.tasks.soon.length === 0 ? ['- None'] : []),
    '',
    '### Calendar Review',
    ctx.calendarReview || '_No calendar review page found for today._',
  ]
  return lines.join('\n')
}

let cachedTitleProp: string | null = null

async function getAssistantDbTitleProp(): Promise<string> {
  if (cachedTitleProp) return cachedTitleProp
  const data = await notionRequest<{ properties: Record<string, { type: string }> }>(
    'GET',
    `/databases/${ASSISTANT_DB}`,
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
  const titleProp = await getAssistantDbTitleProp()
  const page = await notionRequest<{ id: string }>('POST', '/pages', {
    parent: { database_id: ASSISTANT_DB },
    properties: {
      [titleProp]: {
        title: [{ type: 'text', text: { content: options.title.slice(0, 200) } }],
      },
    },
    children: bodyToBlocks(options.body),
  })
  return page.id ?? null
}

/**
 * Notion release-notes listener — detects NEW records in the Notion
 * "סיכומי שינויי DB בדיפלוי" database and builds a Hebrew release-notes
 * message for the WhatsApp "טכני" group. See
 * docs/specs/notion-release-notes-listener.md.
 *
 * Deterministic (no LLM): every field and the page body are rendered as-is,
 * so nothing can be invented. Dedupe is by Notion page id in
 * `notion_release_seen`; the first run only baselines existing records.
 *
 * All I/O is injected (`ReleaseNotesDeps`) so the flow is unit-testable.
 */

import { getDb, notionReleaseSeen, eq } from '@ak-system/database'
import { findNotionAccountToken } from './notion-tasks-sync'
import { resolveNotificationChannels } from './notification-preferences'
import { isBridgeConfigured, sendBridgeGroupText } from './whatsapp-bridge-client'

export const RELEASE_NOTES_NOTIFICATION_TYPE_ID = 'notion_release_notes'
export const RELEASE_NOTES_NOTION_ACCOUNT_LABEL = 'DAZ'
export const RELEASE_NOTES_DEFAULT_DATABASE_ID = 'da65ad6281c04fac8611638650120899'
export const RELEASE_NOTES_MAX_ATTEMPTS = 5
const BASELINE_MARKER_ID = '__baseline__'
const NOTION_VERSION = '2022-06-28'
const MAX_PAGES = 500
const MAX_MESSAGE_CHARS = 6000

type Db = ReturnType<typeof getDb>
type NotionProp = Record<string, unknown> & { type: string }

export interface ReleasePage {
  id: string
  createdTime: string
  url: string
  properties: Record<string, NotionProp>
}

export interface ReleaseNotesDeps {
  /** All pages of the database (any order). */
  listPages: () => Promise<ReleasePage[]>
  /** Plain-text rendering of the page body (WhatsApp formatting). */
  fetchBody: (pageId: string) => Promise<string>
  send: (text: string) => Promise<{ ok: boolean; error?: string }>
  channels: () => Promise<{ enabled: boolean; whatsapp: boolean }>
  db?: Db
  now?: () => Date
}

export interface ReleaseAnnouncement {
  pageId: string
  title: string
  message: string
  status: 'sent' | 'drafted' | 'pending' | 'failed'
  error?: string
}

export interface ReleaseNotesResult {
  ok: boolean
  /** True when this run only recorded existing records (first run). */
  baselined: number
  announcements: ReleaseAnnouncement[]
  error?: string
}

// ─── Message composition ─────────────────────────────────────────────────

function richText(prop: unknown): string {
  if (!Array.isArray(prop)) return ''
  return prop.map((r) => (r as { plain_text?: string }).plain_text ?? '').join('')
}

/** Human-readable value of a Notion property, or '' when empty/unsupported. */
export function propertyText(prop: NotionProp): string {
  const v = prop[prop.type] as unknown
  switch (prop.type) {
    case 'title':
    case 'rich_text':
      return richText(v).trim()
    case 'url':
    case 'email':
    case 'phone_number':
      return typeof v === 'string' ? v : ''
    case 'number':
      return typeof v === 'number' ? String(v) : ''
    case 'select':
    case 'status':
      return (v as { name?: string } | null)?.name ?? ''
    case 'multi_select':
      return Array.isArray(v) ? v.map((o) => (o as { name?: string }).name ?? '').filter(Boolean).join(', ') : ''
    case 'people':
      return Array.isArray(v) ? v.map((o) => (o as { name?: string }).name ?? '').filter(Boolean).join(', ') : ''
    case 'date': {
      const d = v as { start?: string; end?: string } | null
      if (!d?.start) return ''
      return d.end ? `${d.start} → ${d.end}` : d.start
    }
    default:
      return ''
  }
}

function formatDate(raw: string): string {
  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : raw
}

function findProp(props: Record<string, NotionProp>, name: string): NotionProp | undefined {
  const key = Object.keys(props).find((k) => k.trim().toLowerCase() === name.toLowerCase())
  return key ? props[key] : undefined
}

export function pageTitle(page: ReleasePage): string {
  const titleProp = Object.values(page.properties).find((p) => p.type === 'title')
  return (titleProp ? propertyText(titleProp) : '') || 'ללא כותרת'
}

const KNOWN_PROPS = new Set(['name', 'date', 'services', 'schema changes', 'commit', 'run'])

/**
 * Builds the WhatsApp message. Known fields get fixed labels/order; any other
 * populated property is appended generically so no detail is dropped.
 */
export function composeReleaseMessage(page: ReleasePage, body: string): string {
  const lines: string[] = [`*🚀 Release notes — ${pageTitle(page)}*`]
  const props = page.properties

  const date = findProp(props, 'Date')
  const dateText = date ? propertyText(date) : ''
  lines.push(`📅 ${dateText ? formatDate(dateText) : formatDate(page.createdTime)}`)

  const services = findProp(props, 'Services')
  const servicesText = services ? propertyText(services) : ''
  if (servicesText) lines.push(`🧩 שירותים: ${servicesText}`)

  const schema = findProp(props, 'Schema changes')
  if (schema && schema.type === 'checkbox') {
    lines.push(`🗄️ שינויי סכמה: ${schema.checkbox ? 'כן ⚠️' : 'לא'}`)
  }

  for (const [key, prop] of Object.entries(props)) {
    if (KNOWN_PROPS.has(key.trim().toLowerCase()) || prop.type === 'title') continue
    const text = propertyText(prop)
    if (text) lines.push(`• ${key}: ${text}`)
  }

  const commit = findProp(props, 'Commit')
  const commitUrl = commit ? propertyText(commit) : ''
  if (commitUrl) lines.push(`🔗 Commit: ${commitUrl}`)
  const run = findProp(props, 'Run')
  const runUrl = run ? propertyText(run) : ''
  if (runUrl) lines.push(`🔗 Run: ${runUrl}`)

  const trimmedBody = body.trim()
  if (trimmedBody) lines.push('', trimmedBody)

  let text = lines.join('\n')
  if (text.length > MAX_MESSAGE_CHARS) {
    text = `${text.slice(0, MAX_MESSAGE_CHARS).trimEnd()}…\n(קוצר — ההמשך בדף ב-Notion)`
  }
  return `${text}\n\n📄 ${page.url}`
}

// ─── Block rendering ─────────────────────────────────────────────────────

interface NotionBlock {
  id: string
  type: string
  has_children?: boolean
  [key: string]: unknown
}

/** Renders Notion blocks as WhatsApp-friendly text (single-asterisk bold). */
export function renderBlocks(blocks: Array<{ block: NotionBlock; depth: number }>): string {
  const out: string[] = []
  let numbered = 0
  for (const { block, depth } of blocks) {
    const data = block[block.type] as { rich_text?: unknown; checked?: boolean; language?: string } | undefined
    const text = richText(data?.rich_text).trim()
    const indent = '  '.repeat(depth)
    if (block.type !== 'numbered_list_item') numbered = 0
    switch (block.type) {
      case 'heading_1':
      case 'heading_2':
      case 'heading_3':
        if (text) out.push('', `*${text}*`)
        break
      case 'paragraph':
        out.push(text ? `${indent}${text}` : '')
        break
      case 'bulleted_list_item':
        if (text) out.push(`${indent}• ${text}`)
        break
      case 'numbered_list_item':
        numbered += 1
        if (text) out.push(`${indent}${numbered}. ${text}`)
        break
      case 'to_do':
        if (text) out.push(`${indent}${data?.checked ? '☑' : '☐'} ${text}`)
        break
      case 'quote':
      case 'callout':
        if (text) out.push(`${indent}> ${text}`)
        break
      case 'code':
        if (text) out.push('```' + text + '```')
        break
      case 'divider':
        out.push('---')
        break
      default:
        if (text) out.push(`${indent}${text}`)
    }
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// ─── Notion I/O ──────────────────────────────────────────────────────────

async function notionFetch(token: string, url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Notion-Version': NOTION_VERSION,
      'Content-Type': 'application/json',
    },
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(`Notion ${res.status}: ${(json.message as string) || (json.code as string) || 'request failed'}`)
  }
  return json
}

async function listBlocks(token: string, blockId: string, depth: number): Promise<Array<{ block: NotionBlock; depth: number }>> {
  const out: Array<{ block: NotionBlock; depth: number }> = []
  let cursor: string | undefined
  do {
    const qs = new URLSearchParams({ page_size: '100' })
    if (cursor) qs.set('start_cursor', cursor)
    const json = await notionFetch(token, `https://api.notion.com/v1/blocks/${blockId}/children?${qs}`)
    for (const block of (json.results as NotionBlock[]) ?? []) {
      out.push({ block, depth })
      // One level of nesting is enough for release notes (bullets under bullets).
      if (block.has_children && depth < 2) out.push(...(await listBlocks(token, block.id, depth + 1)))
    }
    cursor = json.has_more ? (json.next_cursor as string) : undefined
  } while (cursor)
  return out
}

export function resolveReleaseNotesDatabaseId(): string {
  return (process.env.RELEASE_NOTES_NOTION_DB_ID?.trim() || RELEASE_NOTES_DEFAULT_DATABASE_ID).replace(/-/g, '')
}

/** Real dependencies: Notion REST + the WhatsApp bridge group send. */
export function createLiveReleaseNotesDeps(): ReleaseNotesDeps {
  const token = findNotionAccountToken(RELEASE_NOTES_NOTION_ACCOUNT_LABEL)
  const databaseId = resolveReleaseNotesDatabaseId()
  const groupJid = process.env.RELEASE_NOTES_WHATSAPP_GROUP_JID?.trim()

  return {
    listPages: async () => {
      if (!token) throw new Error(`חשבון Notion "${RELEASE_NOTES_NOTION_ACCOUNT_LABEL}" לא מוגדר (NOTION_ACCOUNTS)`)
      const pages: ReleasePage[] = []
      let cursor: string | undefined
      do {
        const body: Record<string, unknown> = { page_size: 100 }
        if (cursor) body.start_cursor = cursor
        const json = await notionFetch(token, `https://api.notion.com/v1/databases/${databaseId}/query`, {
          method: 'POST',
          body: JSON.stringify(body),
        })
        for (const r of (json.results as Array<Record<string, unknown>>) ?? []) {
          pages.push({
            id: r.id as string,
            createdTime: r.created_time as string,
            url: r.url as string,
            properties: r.properties as Record<string, NotionProp>,
          })
        }
        cursor = json.has_more && pages.length < MAX_PAGES ? (json.next_cursor as string) : undefined
      } while (cursor)
      return pages
    },
    fetchBody: async (pageId) => {
      if (!token) return ''
      return renderBlocks(await listBlocks(token, pageId, 0))
    },
    send: async (text) => {
      if (!groupJid) return { ok: false, error: 'RELEASE_NOTES_WHATSAPP_GROUP_JID לא מוגדר בסביבת השרת' }
      if (!isBridgeConfigured()) return { ok: false, error: 'WhatsApp bridge not configured' }
      return sendBridgeGroupText(groupJid, text)
    },
    channels: () => resolveNotificationChannels(RELEASE_NOTES_NOTIFICATION_TYPE_ID),
  }
}

// ─── Listener ────────────────────────────────────────────────────────────

/**
 * One polling pass. Safe to run repeatedly and concurrently-ish: a page is
 * only ever announced from `pending`, and `sent`/`drafted`/`seen` rows are
 * never touched again.
 */
export async function runReleaseNotesListener(deps: ReleaseNotesDeps): Promise<ReleaseNotesResult> {
  const db = deps.db ?? getDb()
  const nowIso = (deps.now?.() ?? new Date()).toISOString()

  let pages: ReleasePage[]
  try {
    pages = await deps.listPages()
  } catch (err) {
    return { ok: false, baselined: 0, announcements: [], error: err instanceof Error ? err.message : 'Notion query failed' }
  }

  const rows = await db.select().from(notionReleaseSeen)
  const byId = new Map(rows.map((r) => [r.pageId, r]))

  // First run: record everything that already exists without announcing it.
  if (!byId.has(BASELINE_MARKER_ID)) {
    for (const page of pages) {
      await db
        .insert(notionReleaseSeen)
        .values({ pageId: page.id, status: 'seen', title: pageTitle(page), createdAt: nowIso })
        .onConflictDoNothing()
    }
    await db
      .insert(notionReleaseSeen)
      .values({ pageId: BASELINE_MARKER_ID, status: 'seen', title: 'baseline', createdAt: nowIso })
      .onConflictDoNothing()
    return { ok: true, baselined: pages.length, announcements: [] }
  }

  const todo = pages
    .filter((p) => {
      const row = byId.get(p.id)
      return !row || (row.status === 'pending' && row.attempts < RELEASE_NOTES_MAX_ATTEMPTS)
    })
    .sort((a, b) => a.createdTime.localeCompare(b.createdTime))

  const announcements: ReleaseAnnouncement[] = []
  if (todo.length === 0) return { ok: true, baselined: 0, announcements }

  const channels = await deps.channels()
  if (!channels.enabled) return { ok: true, baselined: 0, announcements }

  for (const page of todo) {
    const title = pageTitle(page)
    const existing = byId.get(page.id)
    let message = existing?.message ?? ''
    if (!message) {
      let body = ''
      try {
        body = await deps.fetchBody(page.id)
      } catch (err) {
        // Don't announce a half-rendered note; retry on the next pass.
        const error = err instanceof Error ? err.message : 'body fetch failed'
        await upsert(db, page.id, { status: 'pending', title, lastError: error, attempts: (existing?.attempts ?? 0) + 1 }, nowIso, !!existing)
        announcements.push({ pageId: page.id, title, message: '', status: 'pending', error })
        continue
      }
      message = composeReleaseMessage(page, body)
    }

    // Draft mode: WhatsApp channel off → in-app only, never retried/re-sent later.
    if (!channels.whatsapp) {
      await upsert(db, page.id, { status: 'drafted', title, message, lastError: null }, nowIso, !!existing)
      announcements.push({ pageId: page.id, title, message, status: 'drafted' })
      continue
    }

    const attempts = (existing?.attempts ?? 0) + 1
    const res = await deps.send(message)
    if (res.ok) {
      await upsert(db, page.id, { status: 'sent', title, message, attempts, lastError: null, sentAt: nowIso }, nowIso, !!existing)
      announcements.push({ pageId: page.id, title, message, status: 'sent' })
    } else {
      const failed = attempts >= RELEASE_NOTES_MAX_ATTEMPTS
      const status = failed ? 'failed' : 'pending'
      await upsert(db, page.id, { status, title, message, attempts, lastError: res.error ?? 'send failed' }, nowIso, !!existing)
      announcements.push({ pageId: page.id, title, message, status, error: res.error })
    }
  }

  return { ok: true, baselined: 0, announcements }
}

async function upsert(
  db: Db,
  pageId: string,
  patch: Partial<typeof notionReleaseSeen.$inferInsert>,
  nowIso: string,
  exists: boolean,
): Promise<void> {
  if (exists) {
    await db.update(notionReleaseSeen).set(patch).where(eq(notionReleaseSeen.pageId, pageId))
  } else {
    await db.insert(notionReleaseSeen).values({ pageId, status: 'pending', title: '', createdAt: nowIso, ...patch })
  }
}

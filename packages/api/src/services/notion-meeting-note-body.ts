/**
 * Flatten + fetch Notion AI Meeting Notes that live as blocks on a meeting page
 * (native Notion AI Meeting Notes widget), not only as a separate notes database.
 */

import {
  getDb,
  meetings,
  meetingPeople,
  meetingNotes,
  meetingNotePeople,
  meetingNoteProjects,
  eq,
  or,
} from '@ak-system/database'
import { resolveDatabases } from './notion-tasks-sync'

const NOTION_VERSION = '2022-06-28'
/** Isolated header for meeting-page block fetch; fall back is the same 2022 version. */
const NOTES_NOTION_VERSION = '2025-09-03'

export const MEETING_NOTE_BODY_CAP = 8000
export const MEETING_NOTE_SUMMARY_CAP = 8000
export const MEETING_NOTE_MAX_DEPTH = 3
export const MEETING_NOTE_MAX_BLOCKS = 200
export const MEETING_PAGE_SUMMARY_KIND = 'meeting_page_summary'

type Db = ReturnType<typeof getDb>

const MEDIA_SKIP = new Set([
  'table',
  'image',
  'video',
  'audio',
  'file',
  'pdf',
  'embed',
  'bookmark',
  'link_preview',
])

export type NotionBlock = Record<string, unknown> & {
  id?: string
  type?: string
  has_children?: boolean
  children?: NotionBlock[]
}

export interface FetchMeetingNoteBodyResult {
  bodyText: string
  sourceBlockId: string | null
  topLevelTypes: string
  blockCount: number
}

/** Whether we should pull Notion blocks (missing sync, or page edited since last sync). */
export function shouldFetchNoteBody(args: {
  bodyText: string | null | undefined
  bodySyncedAt: string | null | undefined
  notionLastEditedAt: string | null | undefined
  pageLastEdited: string | null | undefined
  sourceKind?: string | null
}): boolean {
  if (args.sourceKind === 'meeting_page') return true
  if (!args.bodySyncedAt) return true
  if (!args.pageLastEdited) return !args.bodyText?.trim()
  const pageEdited = Date.parse(args.pageLastEdited)
  const synced = Date.parse(args.bodySyncedAt)
  if (Number.isNaN(pageEdited)) return !args.bodyText?.trim()
  if (Number.isNaN(synced)) return true
  return pageEdited > synced
}

function richTextFromPayload(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const obj = payload as { rich_text?: unknown; title?: unknown }
  const fromRt = Array.isArray(obj.rich_text)
    ? (obj.rich_text as Array<{ plain_text?: string }>).map((x) => x.plain_text ?? '').join('')
    : ''
  if (fromRt.trim()) return fromRt.trim()
  if (typeof obj.title === 'string' && obj.title.trim()) return obj.title.trim()
  if (Array.isArray(obj.title)) {
    return (obj.title as Array<{ plain_text?: string }>).map((x) => x.plain_text ?? '').join('').trim()
  }
  return ''
}

/** Flatten Notion blocks (including attached `children`) into plain text. Skip media. Cap chars. */
export function flattenNotionBlocksToText(
  blocks: Array<Record<string, unknown>>,
  cap = MEETING_NOTE_BODY_CAP,
): string {
  const lines: string[] = []
  let used = 0

  function walk(block: Record<string, unknown>) {
    if (used >= cap) return
    const type = block.type as string | undefined
    if (type && MEDIA_SKIP.has(type)) return

    if (type === 'child_page') {
      const title = (block.child_page as { title?: string } | undefined)?.title?.trim()
      if (title) {
        const room = cap - used
        const chunk = title.length > room ? title.slice(0, room) : title
        lines.push(chunk)
        used += chunk.length + 1
      }
    } else if (type) {
      const txt = richTextFromPayload(block[type])
      if (txt) {
        const room = cap - used
        const chunk = txt.length > room ? txt.slice(0, room) : txt
        lines.push(chunk)
        used += chunk.length + 1
      }
    }

    const children = block.children
    if (Array.isArray(children)) {
      for (const child of children) walk(child as Record<string, unknown>)
    }
  }

  for (const block of blocks) walk(block)
  return lines.join('\n').slice(0, cap)
}

function collectNoteShape(block: Record<string, unknown>): { paragraphs: number; structured: number } {
  let paragraphs = 0
  let structured = 0
  function walk(b: Record<string, unknown>) {
    const t = String(b.type ?? '')
    if (t === 'paragraph') paragraphs++
    if (
      t.startsWith('heading') ||
      t === 'to_do' ||
      t === 'bulleted_list_item' ||
      t === 'numbered_list_item'
    ) {
      structured++
    }
    if (Array.isArray(b.children)) {
      for (const c of b.children) walk(c as Record<string, unknown>)
    }
  }
  walk(block)
  return { paragraphs, structured }
}

/** Dialogue dump: many paragraphs, no headings/bullets/todos. */
export function isTranscriptishBlock(block: Record<string, unknown>): boolean {
  const { paragraphs, structured } = collectNoteShape(block)
  return paragraphs >= 5 && structured === 0
}

function findAiNotesWidget(blocks: Array<Record<string, unknown>>): Record<string, unknown> | null {
  for (const block of blocks) {
    const type = String(block.type ?? '')
    if (type === 'transcription' || type === 'meeting_notes') return block
    if (Array.isArray(block.children)) {
      const inner = findAiNotesWidget(block.children as Array<Record<string, unknown>>)
      if (inner) return inner
    }
  }
  return null
}

/**
 * Notion AI Meeting Notes: keep the structured summary under `transcription`,
 * drop the raw transcript sibling and the rest of the meeting page.
 */
export function extractAiMeetingSummary(
  blocks: Array<Record<string, unknown>>,
  cap = MEETING_NOTE_SUMMARY_CAP,
): string {
  const widget = findAiNotesWidget(blocks)
  if (!widget) return flattenNotionBlocksToText(blocks, cap)

  const parts: string[] = []
  const type = String(widget.type ?? '')
  const title = type ? richTextFromPayload(widget[type]) : ''
  if (title) parts.push(title)

  const children = Array.isArray(widget.children) ? (widget.children as Array<Record<string, unknown>>) : []
  for (const child of children) {
    if (isTranscriptishBlock(child)) continue
    const chunk = flattenNotionBlocksToText([child], cap)
    if (chunk.trim()) parts.push(chunk)
  }

  return parts.join('\n').trim().slice(0, cap)
}

export function listTopLevelBlockTypes(blocks: Array<Record<string, unknown>>): string {
  return blocks
    .map((b) => {
      const type = String(b.type ?? 'unknown')
      return b.has_children ? `${type}+` : type
    })
    .join(',')
}

export function pickSourceBlockId(blocks: NotionBlock[]): string | null {
  const stack: NotionBlock[] = [...blocks]
  while (stack.length) {
    const block = stack.shift()!
    const type = String(block.type ?? '')
    const childTitle = (block.child_page as { title?: string } | undefined)?.title ?? ''
    const payloadText = type ? richTextFromPayload(block[type]) : ''
    const hay = `${type} ${childTitle} ${payloadText}`
    if (
      type === 'meeting_notes' ||
      type === 'transcription' ||
      /ai meeting notes|meeting notes|סיכום/i.test(hay)
    ) {
      return block.id ? String(block.id) : null
    }
    if (Array.isArray(block.children)) stack.push(...block.children)
  }
  return blocks.find((b) => b.id)?.id ? String(blocks.find((b) => b.id)!.id) : null
}

const HEX32 = /[0-9a-fA-F]{32}/

export function dashNotionId(raw: string): string {
  const hex = raw.replace(/-/g, '').toLowerCase()
  if (hex.length !== 32) return raw
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/**
 * Parse a Notion page id and optional block id from a URL or raw id.
 * Supports app.notion.com/p/..., www.notion.so/..., and 32-char hex / dashed UUIDs.
 */
export function parseNotionIdFromInput(raw: string): { pageId: string; blockId: string | null } | null {
  const trimmed = raw.trim()
  if (!trimmed) return null

  let blockId: string | null = null
  let pathPart = trimmed

  try {
    if (/^https?:\/\//i.test(trimmed)) {
      const url = new URL(trimmed)
      const hash = url.hash.replace(/^#/, '')
      const hashMatch = hash.match(HEX32)
      if (hashMatch) blockId = dashNotionId(hashMatch[0])
      pathPart = url.pathname
    }
  } catch {
    pathPart = trimmed
  }

  const hashSplit = pathPart.split('#')
  if (!blockId && hashSplit[1]) {
    const hashMatch = hashSplit[1].match(HEX32)
    if (hashMatch) blockId = dashNotionId(hashMatch[0])
    pathPart = hashSplit[0]!
  }

  const dashed = pathPart.match(
    /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/,
  )
  if (dashed) {
    return { pageId: dashed[0]!.toLowerCase(), blockId }
  }

  const compact = pathPart.match(HEX32)
  if (compact) {
    return { pageId: dashNotionId(compact[0]!), blockId }
  }

  return null
}

async function fetchBlockChildren(
  token: string,
  blockId: string,
  version: string,
): Promise<NotionBlock[]> {
  const blocks: NotionBlock[] = []
  let cursor: string | undefined
  do {
    const qs = new URLSearchParams({ page_size: '100' })
    if (cursor) qs.set('start_cursor', cursor)
    const res = await fetch(`https://api.notion.com/v1/blocks/${blockId}/children?${qs}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': version,
      },
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Notion blocks ${res.status}: ${err.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      results: NotionBlock[]
      has_more: boolean
      next_cursor: string | null
    }
    blocks.push(...data.results)
    cursor = data.has_more ? data.next_cursor ?? undefined : undefined
  } while (cursor)
  return blocks
}

async function fetchBlockChildrenWithFallback(token: string, blockId: string): Promise<NotionBlock[]> {
  try {
    return await fetchBlockChildren(token, blockId, NOTES_NOTION_VERSION)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (/invalid_request_url|invalid.*version|validation_error|400/i.test(msg)) {
      return fetchBlockChildren(token, blockId, NOTION_VERSION)
    }
    throw err
  }
}

function syncedFromId(block: NotionBlock): string | null {
  const payload = block.synced_block as { synced_from?: { block_id?: string } | null } | undefined
  return payload?.synced_from?.block_id ?? null
}

async function expandBlocks(
  token: string,
  parentId: string,
  depth: number,
  budget: { remaining: number },
): Promise<NotionBlock[]> {
  if (depth > MEETING_NOTE_MAX_DEPTH || budget.remaining <= 0) return []
  const children = await fetchBlockChildrenWithFallback(token, parentId)
  const out: NotionBlock[] = []
  for (const block of children) {
    if (budget.remaining <= 0) break
    budget.remaining--
    const copy: NotionBlock = { ...block }
    const type = String(block.type ?? '')
    const expandId =
      type === 'synced_block' && syncedFromId(block)
        ? syncedFromId(block)
        : block.has_children ||
            type === 'child_page' ||
            type === 'unsupported' ||
            type === 'meeting_notes' ||
            type === 'transcription'
          ? String(block.id ?? '')
          : ''
    if (expandId && depth < MEETING_NOTE_MAX_DEPTH && budget.remaining > 0) {
      try {
        copy.children = await expandBlocks(token, expandId, depth + 1, budget)
      } catch {
        copy.children = []
      }
    }
    out.push(copy)
  }
  return out
}

export async function fetchMeetingNoteBody(
  token: string,
  pageId: string,
  _cap = MEETING_NOTE_SUMMARY_CAP,
): Promise<FetchMeetingNoteBodyResult> {
  const budget = { remaining: MEETING_NOTE_MAX_BLOCKS }
  const blocks = await expandBlocks(token, pageId, 0, budget)
  const used = MEETING_NOTE_MAX_BLOCKS - budget.remaining
  return {
    bodyText: extractAiMeetingSummary(blocks, MEETING_NOTE_SUMMARY_CAP),
    sourceBlockId: pickSourceBlockId(blocks),
    topLevelTypes: listTopLevelBlockTypes(blocks),
    blockCount: used,
  }
}

/** Fetch and flatten page body text. Exported for tests and notes-DB sync. */
export async function fetchMeetingNoteBodyText(
  token: string,
  pageId: string,
  cap = MEETING_NOTE_BODY_CAP,
): Promise<string> {
  const result = await fetchMeetingNoteBody(token, pageId, cap)
  return result.bodyText
}

function newId(prefix: string): string {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 7)
}

export interface UpsertInPageMeetingNoteArgs {
  pageId: string
  url: string | null
  lastEdited: string | null
  title: string
  date: string
  meetingId: string
  token: string
  accountLabel: string
  dbName: string
  now: string
  dryRun?: boolean
}

export interface ExistingNoteMeta {
  id: string
  bodyText: string | null
  bodySyncedAt: string | null
  notionLastEditedAt: string | null
  sourceKind?: string | null
}

/**
 * Upsert a meeting_notes row from a Meetings DB page body (in-page AI notes).
 * Links people/projects from the local meeting, not from a notes-DB relation.
 */
export async function upsertInPageMeetingNote(
  db: Db,
  args: UpsertInPageMeetingNoteArgs,
  prev: ExistingNoteMeta | undefined,
): Promise<{
  id: string | null
  notesUpserted: boolean
  error: string | null
  bodyText: string | null
  bodySyncedAt: string | null
}> {
  let bodyText: string | null = prev?.bodyText ?? null
  let bodySyncedAt: string | null = prev?.bodySyncedAt ?? null
  let notionLastEditedAt: string | null = args.lastEdited ?? prev?.notionLastEditedAt ?? null
  let sourceBlockId: string | null = null
  let error: string | null = null

  const needsFetch = shouldFetchNoteBody({
    bodyText: prev?.bodyText,
    bodySyncedAt: prev?.bodySyncedAt,
    notionLastEditedAt: prev?.notionLastEditedAt,
    pageLastEdited: args.lastEdited,
    sourceKind: prev?.sourceKind,
  })

  if (!args.dryRun && needsFetch) {
    try {
      const fetched = await fetchMeetingNoteBody(args.token, args.pageId)
      bodyText = fetched.bodyText.trim() ? fetched.bodyText : null
      bodySyncedAt = args.now
      notionLastEditedAt = args.lastEdited ?? args.now
      sourceBlockId = fetched.sourceBlockId
      if (!fetched.bodyText.trim()) {
        error = `meetings/body/${args.pageId}: empty after fetch (blocks: ${fetched.topLevelTypes || 'none'})`
      }
    } catch (err) {
      error = `meetings/body/${args.pageId}: ${err instanceof Error ? err.message : 'block fetch failed'}`
    }
  }

  const snippet = (bodyText?.trim() ? bodyText.trim().slice(0, 500) : null) ?? null
  let id = prev?.id ?? null

  if (args.dryRun) {
    return { id, notesUpserted: true, error, bodyText, bodySyncedAt }
  }

  if (id) {
    await db
      .update(meetingNotes)
      .set({
        title: args.title,
        date: args.date,
        snippet,
        bodyText,
        bodySyncedAt,
        notionLastEditedAt,
        notionUrl: args.url,
        notionPageId: args.pageId,
        meetingId: args.meetingId,
        notionAccount: args.accountLabel,
        notionDb: args.dbName,
        sourceKind: MEETING_PAGE_SUMMARY_KIND,
        sourceBlockId,
        updatedAt: args.now,
      })
      .where(eq(meetingNotes.id, id))
  } else {
    id = newId('mn_')
    await db.insert(meetingNotes).values({
      id,
      title: args.title,
      date: args.date,
      snippet,
      bodyText,
      bodySyncedAt,
      notionLastEditedAt,
      notionUrl: args.url,
      notionPageId: args.pageId,
      meetingId: args.meetingId,
      notionAccount: args.accountLabel,
      notionDb: args.dbName,
      source: 'notion',
      sourceKind: MEETING_PAGE_SUMMARY_KIND,
      sourceBlockId,
      createdAt: args.now,
      updatedAt: args.now,
    })
  }

  await db.delete(meetingNotePeople).where(eq(meetingNotePeople.meetingNoteId, id))
  await db.delete(meetingNoteProjects).where(eq(meetingNoteProjects.meetingNoteId, id))

  const peopleLinks = await db
    .select({ personId: meetingPeople.personId })
    .from(meetingPeople)
    .where(eq(meetingPeople.meetingId, args.meetingId))
  for (const row of peopleLinks) {
    await db.insert(meetingNotePeople).values({ meetingNoteId: id, personId: row.personId })
  }

  const [meeting] = await db
    .select({ projectId: meetings.projectId })
    .from(meetings)
    .where(eq(meetings.id, args.meetingId))
  if (meeting?.projectId) {
    await db.insert(meetingNoteProjects).values({ meetingNoteId: id, projectId: meeting.projectId })
  }

  return { id, notesUpserted: true, error, bodyText, bodySyncedAt }
}

function uniqueTokens(): string[] {
  const seen = new Set<string>()
  const tokens: string[] = []
  for (const type of ['meetings', 'meeting_notes', 'people', 'projects'] as const) {
    for (const db of resolveDatabases(type)) {
      if (seen.has(db.token)) continue
      seen.add(db.token)
      tokens.push(db.token)
    }
  }
  return tokens
}

/**
 * On-demand: if a meeting page is not yet in local notes (or is stale), fetch once and upsert.
 */
export async function ensureMeetingPageNote(
  db: Db,
  pageId: string,
  sourceBlockIdHint?: string | null,
): Promise<{ error: string | null }> {
  void sourceBlockIdHint
  const dashed = dashNotionId(pageId.replace(/-/g, ''))
  const compact = dashed.replace(/-/g, '')

  const existingRows = await db
    .select({
      id: meetingNotes.id,
      bodyText: meetingNotes.bodyText,
      bodySyncedAt: meetingNotes.bodySyncedAt,
      notionLastEditedAt: meetingNotes.notionLastEditedAt,
      notionPageId: meetingNotes.notionPageId,
      sourceKind: meetingNotes.sourceKind,
    })
    .from(meetingNotes)
    .where(or(eq(meetingNotes.notionPageId, dashed), eq(meetingNotes.notionPageId, compact)))
  const existing = existingRows[0]

  const meetingRows = await db
    .select({
      id: meetings.id,
      title: meetings.title,
      date: meetings.date,
      notionPageId: meetings.notionPageId,
    })
    .from(meetings)
    .where(or(eq(meetings.notionPageId, dashed), eq(meetings.notionPageId, compact)))
  const meeting = meetingRows[0]

  const tokens = uniqueTokens()
  if (tokens.length === 0) {
    return { error: `meetings/body/${dashed}: no Notion token configured` }
  }

  const now = new Date().toISOString()
  let lastError: string | null = null
  for (const token of tokens) {
    try {
      if (meeting) {
        const result = await upsertInPageMeetingNote(
          db,
          {
            pageId: dashed,
            url: `https://www.notion.so/${compact}`,
            lastEdited: now,
            title: meeting.title,
            date: meeting.date,
            meetingId: meeting.id,
            token,
            accountLabel: 'ondemand',
            dbName: 'meetings',
            now,
          },
          existing
            ? {
                id: existing.id,
                bodyText: existing.bodyText,
                bodySyncedAt: existing.bodySyncedAt,
                notionLastEditedAt: existing.notionLastEditedAt,
                sourceKind: existing.sourceKind,
              }
            : undefined,
        )
        return { error: result.error }
      }

      const fetched = await fetchMeetingNoteBody(token, dashed)
      const bodyText = fetched.bodyText.trim() ? fetched.bodyText : null
      const snippet = bodyText ? bodyText.slice(0, 500) : null
      if (existing) {
        await db
          .update(meetingNotes)
          .set({
            snippet,
            bodyText,
            bodySyncedAt: now,
            notionLastEditedAt: now,
            notionPageId: dashed,
            sourceKind: MEETING_PAGE_SUMMARY_KIND,
            sourceBlockId: fetched.sourceBlockId,
            updatedAt: now,
          })
          .where(eq(meetingNotes.id, existing.id))
      } else {
        await db.insert(meetingNotes).values({
          id: newId('mn_'),
          title: 'Notion meeting notes',
          date: now.slice(0, 10),
          snippet,
          bodyText,
          bodySyncedAt: now,
          notionLastEditedAt: now,
          notionUrl: `https://www.notion.so/${compact}`,
          notionPageId: dashed,
          meetingId: null,
          source: 'notion',
          sourceKind: MEETING_PAGE_SUMMARY_KIND,
          sourceBlockId: fetched.sourceBlockId,
          createdAt: now,
          updatedAt: now,
        })
      }
      return {
        error: bodyText
          ? null
          : `meetings/body/${dashed}: empty after fetch (blocks: ${fetched.topLevelTypes || 'none'})`,
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : 'block fetch failed'
    }
  }
  return { error: lastError ? `meetings/body/${dashed}: ${lastError}` : null }
}

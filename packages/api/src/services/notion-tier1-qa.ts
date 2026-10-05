/**
 * Tier 1 QA daily reporter — Notion data collection, classification, gap
 * detection, owner routing, and day-over-day diffing for the Tier 1 QA
 * WhatsApp update agent. See docs/specs/tier1-qa-whatsapp-agent.md.
 *
 * Self-contained REST-over-fetch (mirrors notion-tasks-sync.ts) — no
 * @notionhq/client dependency, consistent with every other Notion service
 * in this repo.
 *
 * IMPORTANT — this module owns every number and classification in the daily
 * update. The agent's LLM step only narrates the payload this module
 * returns; it must never re-derive a count or invent a classification, per
 * the user's own "לא להמציא / לא להסיק" rules in the spec. Keep all
 * counting/classification/gap-detection/diffing logic in this file.
 */

import { getDb, tier1QaSnapshots, desc, eq } from '@ak-system/database'
import { findNotionAccountToken } from './notion-tasks-sync'
import { fetchMeetingNoteBodyText } from './notion-meeting-note-body'
import { resolveNotificationChannels } from './notification-preferences'
import { isBridgeConfigured, sendBridgeGroupText } from './whatsapp-bridge-client'

export const TIER1_QA_NOTIFICATION_TYPE_ID = 'tier1_qa_daily_update'

const NOTION_VERSION = '2022-06-28'
/** Multi-source-database API version — these ids are Notion "data source" ids. */
const DATA_SOURCE_NOTION_VERSION = '2025-09-03'

// Matches the "DAZ" entry in NOTION_ACCOUNTS (same workspace as DAZ Tasks/People/Meetings —
// the Tier 1 tests + engineering-tasks database ids share that workspace's id prefix).
export const TIER1_QA_NOTION_ACCOUNT_LABEL = 'DAZ'
export const TIER1_TESTS_DATA_SOURCE_ID = '3de1f239-0943-804a-b84f-000b5ead53ec'
export const TIER1_ENGINEERING_TASKS_DATA_SOURCE_ID = 'c7b1f239-0943-82d2-bd87-87926ab0a490'
export const TIER1_QA_TIMEZONE = 'Asia/Jerusalem'

type Db = ReturnType<typeof getDb>
type NotionProp = Record<string, unknown>
interface NotionPage {
  id: string
  url?: string
  archived?: boolean
  in_trash?: boolean
  properties: Record<string, NotionProp>
}

function newId(prefix: string): string {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 7)
}

/**
 * Runs `fn` over `items` with at most `limit` in flight at once. The original
 * version awaited each test/task's body+comments fetch fully sequentially,
 * which for a real Tier1 database (dozens of tests, each needing 2 Notion
 * calls, plus every linked engineering task needing 2 more) took long enough
 * to blow past request timeouts on the manual "הרץ עכשיו" trigger (which goes
 * through the public tunnel, unlike the cron path). A small concurrency cap
 * keeps this well under Notion's documented ~3 req/s average rate limit while
 * cutting wall-clock time roughly by `limit`x.
 */
async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i]!)
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}

const NOTION_FETCH_CONCURRENCY = 3

interface FetchedExtras {
  bodyText: string
  comments: NotionComment[]
  missing: string[]
}

/** Body text + comments for one page, run concurrently with each other (not just across pages). */
async function fetchPageExtras(token: string, pageId: string, describeFor: string): Promise<FetchedExtras> {
  const missing: string[] = []
  const [bodyResult, commentsResult] = await Promise.allSettled([
    fetchMeetingNoteBodyText(token, pageId),
    fetchPageComments(token, pageId),
  ])
  const bodyText = bodyResult.status === 'fulfilled' ? bodyResult.value : ''
  if (bodyResult.status === 'rejected') {
    missing.push(`תוכן עמוד ${describeFor}: ${errMsg(bodyResult.reason)}`)
  }
  const comments = commentsResult.status === 'fulfilled' ? commentsResult.value : []
  if (commentsResult.status === 'rejected') {
    missing.push(`תגובות על ${describeFor}: ${errMsg(commentsResult.reason)}`)
  }
  return { bodyText, comments, missing }
}

/** Strips a `collection://<uuid>` wrapper down to the raw id Notion's REST API expects. */
export function stripNotionSourceUri(raw: string): string {
  return raw.replace(/^collection:\/\//i, '').trim()
}

/** Asia/Jerusalem calendar day (YYYY-MM-DD) for a given instant (defaults to now). */
export function jerusalemDateKey(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIER1_QA_TIMEZONE }).format(at)
}

/** Asia/Jerusalem date + time for the message header, e.g. "30.09.2026 07:00". */
export function jerusalemDateTimeLabel(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('he-IL', {
    timeZone: TIER1_QA_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('day')}.${get('month')}.${get('year')} ${get('hour')}:${get('minute')}`
}

// ─── Notion REST ─────────────────────────────────────────────────────────

/**
 * Query a data source's rows, no view filter, no page-count cap. Tries the
 * newer multi-source `/v1/data_sources/{id}/query` endpoint first (these ids
 * are data-source ids); falls back to the classic `/v1/databases/{id}/query`
 * endpoint/version on a 400 — same fallback shape already used for block
 * fetches in notion-meeting-note-body.ts.
 */
async function queryDataSource(token: string, dataSourceId: string): Promise<NotionPage[]> {
  const id = stripNotionSourceUri(dataSourceId)
  try {
    return await queryPaged(token, `https://api.notion.com/v1/data_sources/${id}/query`, DATA_SOURCE_NOTION_VERSION)
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (/invalid_request_url|invalid.*version|validation_error|object_not_found|400|404/i.test(msg)) {
      return queryPaged(token, `https://api.notion.com/v1/databases/${id}/query`, NOTION_VERSION)
    }
    throw err
  }
}

async function queryPaged(token: string, url: string, version: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = []
  let cursor: string | undefined
  do {
    const body: Record<string, unknown> = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': version,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Notion query ${res.status}: ${err.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      results: NotionPage[]
      has_more: boolean
      next_cursor: string | null
    }
    pages.push(...data.results)
    cursor = data.has_more ? data.next_cursor ?? undefined : undefined
  } while (cursor)
  return pages
}

/** Fetch a single page by id directly (used for linked engineering tasks). */
async function fetchPage(token: string, pageId: string): Promise<NotionPage | { notFound: true }> {
  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    headers: { Authorization: `Bearer ${token}`, 'Notion-Version': DATA_SOURCE_NOTION_VERSION },
  })
  if (res.status === 404) return { notFound: true }
  if (!res.ok) {
    const err = await res.text()
    throw new Error(`Notion page ${res.status}: ${err.slice(0, 200)}`)
  }
  return (await res.json()) as NotionPage
}

interface NotionComment {
  authorName: string
  createdTime: string
  text: string
}

/**
 * All comments on a page (Notion's Comments API returns whatever the
 * integration's "Read comments" capability exposes — open and resolved,
 * if the integration/API version surfaces both).
 */
async function fetchPageComments(token: string, pageId: string): Promise<NotionComment[]> {
  const out: NotionComment[] = []
  let cursor: string | undefined
  do {
    const qs = new URLSearchParams({ block_id: pageId, page_size: '100' })
    if (cursor) qs.set('start_cursor', cursor)
    const res = await fetch(`https://api.notion.com/v1/comments?${qs}`, {
      headers: { Authorization: `Bearer ${token}`, 'Notion-Version': NOTION_VERSION },
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Notion comments ${res.status}: ${err.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      results: Array<{
        created_time?: string
        created_by?: { id?: string }
        rich_text?: Array<{ plain_text?: string }>
      }>
      has_more: boolean
      next_cursor: string | null
    }
    for (const c of data.results) {
      out.push({
        authorName: c.created_by?.id ?? 'unknown',
        createdTime: c.created_time ?? '',
        text: (c.rich_text ?? []).map((t) => t.plain_text ?? '').join(''),
      })
    }
    cursor = data.has_more ? data.next_cursor ?? undefined : undefined
  } while (cursor)
  return out
}

// ─── Property extraction ────────────────────────────────────────────────────

function richText(prop: NotionProp | undefined): string {
  if (!prop) return ''
  const t = prop.type as string
  if (t === 'title') return ((prop.title as Array<{ plain_text?: string }>) ?? []).map((x) => x.plain_text ?? '').join('')
  if (t === 'rich_text') return ((prop.rich_text as Array<{ plain_text?: string }>) ?? []).map((x) => x.plain_text ?? '').join('')
  if (t === 'select' && prop.select) return (prop.select as { name?: string }).name ?? ''
  if (t === 'status' && prop.status) return (prop.status as { name?: string }).name ?? ''
  if (t === 'url' && typeof prop.url === 'string') return prop.url
  if (t === 'email' && typeof prop.email === 'string') return prop.email
  if (t === 'number' && typeof prop.number === 'number') return String(prop.number)
  return ''
}

function findProp(props: Record<string, NotionProp>, ...nameCandidates: string[]): NotionProp | undefined {
  for (const name of nameCandidates) {
    if (props[name]) return props[name]
  }
  // fuzzy fallback: case-insensitive exact match
  const lower = nameCandidates.map((n) => n.toLowerCase())
  for (const [key, val] of Object.entries(props)) {
    if (lower.includes(key.toLowerCase())) return val
  }
  return undefined
}

function getCheckbox(prop: NotionProp | undefined): boolean {
  return prop?.type === 'checkbox' ? Boolean(prop.checkbox) : false
}

function getPeopleNames(prop: NotionProp | undefined): string[] {
  if (prop?.type !== 'people') return []
  return ((prop.people as Array<{ name?: string }>) ?? []).map((p) => p.name ?? '').filter(Boolean)
}

function getRelationIds(prop: NotionProp | undefined): string[] {
  if (prop?.type !== 'relation') return []
  return ((prop.relation as Array<{ id: string }>) ?? []).map((r) => r.id)
}

function getDateStart(prop: NotionProp | undefined): string | null {
  if (prop?.type !== 'date' || !prop.date) return null
  return (prop.date as { start?: string }).start ?? null
}

function getTitle(props: Record<string, NotionProp>): string {
  for (const v of Object.values(props)) {
    if (v?.type === 'title') return richText(v).trim()
  }
  return ''
}

// ─── Domain types ────────────────────────────────────────────────────────

export type BugClassification = 'open' | 'released' | 'cancelled' | 'archived' | 'deleted'
/**
 * 'לבעלים מהטיקט' = owned by specific people named on the ticket itself
 * (e.g. its QA or Reporter field) rather than a fixed role; the names travel
 * in `people[]` on the gap / owner action.
 */
export type OwnerBucket = 'לאור' | 'לדור' | 'לאלפיר/QA' | 'לבעלים מהטיקט' | 'נדרש לקבוע בעלים'
export type PeopleSource = 'qa' | 'reporter'

export interface Tier1TestRecord {
  testId: string
  pageId: string
  pageUrl: string | null
  street: string
  gush: string
  chelka: string
  statusBdika: string
  resultLink: string | null
  testedBy: string[]
  done: boolean
  linkedBugIds: string[]
  bodyText: string
  comments: NotionComment[]
}

export interface Tier1BugRecord {
  bugId: string
  taskId: string
  pageId: string
  pageUrl: string | null
  taskName: string
  status: string
  classification: BugClassification
  priority: string
  assignee: string[]
  qa: string[]
  reporter: string[]
  type: string
  due: string | null
  linkedTestIds: string[]
  bodyText: string
  comments: NotionComment[]
  purged?: boolean
}

export interface Tier1QaGap {
  type: string
  testId?: string
  bugId?: string
  note: string
  /** Specific people responsible, resolved from the ticket (only for ticket-owned gaps). */
  people?: string[]
  peopleSource?: PeopleSource
}

export interface Tier1QaOwnerAction {
  owner: OwnerBucket
  testId?: string
  bugId?: string
  note: string
  people?: string[]
  peopleSource?: PeopleSource
}

export interface Tier1QaDiffEntry {
  kind: 'test_status_changed' | 'bug_opened' | 'bug_released' | 'new_comment' | 'new_decision'
  note: string
}

export interface Tier1QaStats {
  totalTests: number
  byStatusBdika: Record<string, number>
  doneCount: number
  testedByCount: number
  resultLinkCount: number
  totalLinkedBugs: number
  bugsByClassification: Record<BugClassification, number>
  activeBugsByStatusPriority: Record<string, number>
  openBugsNoAssignee: number
  openBugsNoDue: number
}

export interface Tier1QaScanResult {
  generatedAtIso: string
  jerusalemDateKey: string
  jerusalemDateTimeLabel: string
  incomplete: boolean
  missingParts: string[]
  stats: Tier1QaStats
  tests: Tier1TestRecord[]
  bugs: Tier1BugRecord[]
  gaps: Tier1QaGap[]
  ownerActions: Tier1QaOwnerAction[]
  diff: Tier1QaDiffEntry[] | null
}

// ─── Classification (§6) ────────────────────────────────────────────────────

export function classifyBug(status: string, purged: boolean): BugClassification {
  if (purged) return 'deleted'
  const s = status.trim().toLowerCase()
  if (/deleted/.test(s)) return 'deleted'
  if (/archiv/.test(s)) return 'archived'
  if (/cancel/.test(s) || s.includes('בוטל')) return 'cancelled'
  if (/releas/.test(s) || s.includes('שוחרר')) return 'released'
  // Pending, Not started, Reopen, In Dev, Ready for QA, In QA, and anything
  // else unrecognized — all count as open, per §6.
  return 'open'
}

export function isBugOpen(classification: BugClassification): boolean {
  return classification === 'open'
}

// ─── Owner routing (§8) ──────────────────────────────────────────────────

const PROFESSIONAL_REVIEW_HINT = /בדיקה מקצועית|אימות תוצאות|תכנון|שאלה מקצועית/
const DEV_FIX_HINT = /תיקון|שיוך|עדיפות|סטטוס|תאריך יעד/

export function routeOwner(gap: Tier1QaGap): OwnerBucket {
  switch (gap.type) {
    case 'ready_for_qa':
      // People were already resolved from the ticket (QA, else Reporter) in
      // detectGaps; nobody on either field means there's no basis to assign.
      return gap.people && gap.people.length > 0 ? 'לבעלים מהטיקט' : 'נדרש לקבוע בעלים'
    case 'waiting_on_or_review':
    case 'unanswered_question':
      return 'לאור'
    case 'open_bug_missing_assignee':
    case 'open_bug_missing_due':
    case 'released_bug_test_not_closed_dev_side':
    case 'test_linked_only_to_inactive_bug':
      return 'לדור'
    case 'regression_needed':
    case 'stale_comment_needs_verification':
      return 'לאלפיר/QA'
    default:
      if (PROFESSIONAL_REVIEW_HINT.test(gap.note)) return 'לאור'
      if (DEV_FIX_HINT.test(gap.note)) return 'לדור'
      return 'נדרש לקבוע בעלים'
  }
}

// ─── Notion → domain mapping ─────────────────────────────────────────────

function mapTestPage(page: NotionPage): Omit<Tier1TestRecord, 'bodyText' | 'comments'> {
  const props = page.properties
  return {
    testId: richText(findProp(props, 'ID')) || page.id,
    pageId: page.id,
    pageUrl: page.url ?? null,
    street: richText(findProp(props, 'Street')),
    gush: richText(findProp(props, 'גוש')),
    chelka: richText(findProp(props, 'חלקה')),
    statusBdika: richText(findProp(props, 'סטטוס בדיקה')),
    resultLink: richText(findProp(props, 'לינק לתוצאות הריצה')) || null,
    testedBy: getPeopleNames(findProp(props, 'Tested by')),
    done: getCheckbox(findProp(props, 'Done')),
    linkedBugIds: getRelationIds(findProp(props, 'Engineering tasks')),
  }
}

function mapTaskPage(page: NotionPage, purged: boolean): Omit<Tier1BugRecord, 'bodyText' | 'comments'> {
  const props = page.properties
  const status = richText(findProp(props, 'Status'))
  return {
    bugId: richText(findProp(props, 'Task ID')) || page.id,
    taskId: richText(findProp(props, 'Task ID')) || page.id,
    pageId: page.id,
    pageUrl: page.url ?? null,
    taskName: getTitle(props) || richText(findProp(props, 'Task name')),
    status,
    classification: classifyBug(status, purged),
    priority: richText(findProp(props, 'Priority')),
    assignee: getPeopleNames(findProp(props, 'Assignee')),
    qa: getPeopleNames(findProp(props, 'QA')),
    reporter: getPeopleNames(findProp(props, 'Reporter')),
    type: richText(findProp(props, 'Type')),
    due: getDateStart(findProp(props, 'Due')),
    linkedTestIds: getRelationIds(findProp(props, 'Tests for Tier 1')),
    purged,
  }
}

// ─── Main scan ────────────────────────────────────────────────────────────

export interface Tier1QaScanOptions {
  /** Injected for tests; defaults to the real Notion REST calls. */
  now?: Date
}

export async function runTier1QaScan(db: Db, options: Tier1QaScanOptions = {}): Promise<Tier1QaScanResult> {
  const now = options.now ?? new Date()
  const missingParts: string[] = []

  const token = findNotionAccountToken(TIER1_QA_NOTION_ACCOUNT_LABEL)
  if (!token) {
    return blockedResult(now, [`חשבון Notion "${TIER1_QA_NOTION_ACCOUNT_LABEL}" לא מוגדר (NOTION_ACCOUNTS)`])
  }

  // 1–2. All test rows, no view filter, no cap.
  let rawTests: NotionPage[]
  try {
    rawTests = await queryDataSource(token, TIER1_TESTS_DATA_SOURCE_ID)
  } catch (err) {
    return blockedResult(now, [`טעינת מאגר הבדיקות נכשלה: ${errMsg(err)}`])
  }

  const testResults = await mapWithConcurrency(rawTests, NOTION_FETCH_CONCURRENCY, async (page) => {
    const base = mapTestPage(page)
    const extras = await fetchPageExtras(token, page.id, `בדיקה ${base.testId}`)
    return { record: { ...base, bodyText: extras.bodyText, comments: extras.comments }, missing: extras.missing }
  })
  const tests: Tier1TestRecord[] = testResults.map((r) => r.record)
  for (const r of testResults) missingParts.push(...r.missing)

  // 4. Every linked engineering task, including archived/deleted.
  const linkedTaskIds = Array.from(new Set(tests.flatMap((t) => t.linkedBugIds)))
  const bugResults = await mapWithConcurrency(linkedTaskIds, NOTION_FETCH_CONCURRENCY, async (taskId) => {
    try {
      const fetched = await fetchPage(token, taskId)
      if ('notFound' in fetched) {
        // Permanently purged from Notion, but still linked from a test — this is
        // a legitimate "deleted" state to surface (§4/§7), not a load failure.
        return {
          record: { ...mapTaskPage({ id: taskId, properties: {} }, true), bodyText: '', comments: [] },
          missing: [] as string[],
        }
      }
      const purged = Boolean(fetched.in_trash)
      const base = mapTaskPage(fetched, purged)
      const extras = await fetchPageExtras(token, fetched.id, `משימה ${base.taskId}`)
      return { record: { ...base, bodyText: extras.bodyText, comments: extras.comments }, missing: extras.missing }
    } catch (err) {
      return { record: null, missing: [`משימת הנדסה ${taskId}: ${errMsg(err)}`] }
    }
  })
  const bugs: Tier1BugRecord[] = []
  for (const r of bugResults) {
    if (r.record) bugs.push(r.record)
    missingParts.push(...r.missing)
  }

  if (missingParts.length > 0) {
    // Hard safety rule (spec §11 / user's "כלל בטיחות קריטי"): never send a
    // partial update. Still return what we gathered so the failure message
    // can enumerate exactly what's missing.
    return {
      generatedAtIso: now.toISOString(),
      jerusalemDateKey: jerusalemDateKey(now),
      jerusalemDateTimeLabel: jerusalemDateTimeLabel(now),
      incomplete: true,
      missingParts,
      stats: computeStats(tests, bugs),
      tests,
      bugs,
      gaps: [],
      ownerActions: [],
      diff: null,
    }
  }

  const stats = computeStats(tests, bugs)
  const gaps = detectGaps(tests, bugs)
  const ownerActions = gaps.map((gap) => ({
    owner: routeOwner(gap),
    testId: gap.testId,
    bugId: gap.bugId,
    note: gap.note,
    ...(gap.people ? { people: gap.people, peopleSource: gap.peopleSource } : {}),
  }))

  const prior = await loadLatestSnapshot(db, jerusalemDateKey(now))
  const diff = prior ? computeDiff(tests, bugs, prior) : null

  return {
    generatedAtIso: now.toISOString(),
    jerusalemDateKey: jerusalemDateKey(now),
    jerusalemDateTimeLabel: jerusalemDateTimeLabel(now),
    incomplete: false,
    missingParts: [],
    stats,
    tests,
    bugs,
    gaps,
    ownerActions,
    diff,
  }
}

function blockedResult(now: Date, missingParts: string[]): Tier1QaScanResult {
  return {
    generatedAtIso: now.toISOString(),
    jerusalemDateKey: jerusalemDateKey(now),
    jerusalemDateTimeLabel: jerusalemDateTimeLabel(now),
    incomplete: true,
    missingParts,
    stats: computeStats([], []),
    tests: [],
    bugs: [],
    gaps: [],
    ownerActions: [],
    diff: null,
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** The fixed, verbatim safety-fallback message — never let the LLM paraphrase this. */
export function formatIncompleteMessage(missingParts: string[]): string {
  return `עדכון Tier 1 לא נשלח: הסריקה לא הושלמה. חסרים הנתונים הבאים: ${missingParts.join('; ')}.`
}

// ─── Stats (§5) ──────────────────────────────────────────────────────────

export function computeStats(tests: Tier1TestRecord[], bugs: Tier1BugRecord[]): Tier1QaStats {
  const byStatusBdika: Record<string, number> = {}
  let doneCount = 0
  let testedByCount = 0
  let resultLinkCount = 0
  for (const t of tests) {
    const key = t.statusBdika || '(ללא סטטוס)'
    byStatusBdika[key] = (byStatusBdika[key] ?? 0) + 1
    if (t.done) doneCount++
    if (t.testedBy.length > 0) testedByCount++
    if (t.resultLink) resultLinkCount++
  }

  const bugsByClassification: Record<BugClassification, number> = {
    open: 0,
    released: 0,
    cancelled: 0,
    archived: 0,
    deleted: 0,
  }
  const activeBugsByStatusPriority: Record<string, number> = {}
  let openBugsNoAssignee = 0
  let openBugsNoDue = 0
  for (const b of bugs) {
    bugsByClassification[b.classification]++
    if (b.classification === 'open') {
      const key = `${b.status || '(ללא סטטוס)'} × ${b.priority || '(ללא עדיפות)'}`
      activeBugsByStatusPriority[key] = (activeBugsByStatusPriority[key] ?? 0) + 1
      if (b.assignee.length === 0) openBugsNoAssignee++
      if (!b.due) openBugsNoDue++
    }
  }

  return {
    totalTests: tests.length,
    byStatusBdika,
    doneCount,
    testedByCount,
    resultLinkCount,
    totalLinkedBugs: bugs.length,
    bugsByClassification,
    activeBugsByStatusPriority,
    openBugsNoAssignee,
    openBugsNoDue,
  }
}

// ─── Gap detection (§7) ──────────────────────────────────────────────────

const WAITING_FOR_FIX = /ממתין לתיקון|ממתינה לתיקון/
const WAITING_FOR_OR = /ממתין לבדיקת אור|ממתינה לבדיקת אור|ממתין לאור|ממתינה לאור/
/** Engineering-task Status "Ready for QA" (tolerates case, spacing, hyphens). */
const READY_FOR_QA = /ready[\s_-]*for[\s_-]*qa/i
const CANCELLED_TEST = /בוטל/

export function detectGaps(tests: Tier1TestRecord[], bugs: Tier1BugRecord[]): Tier1QaGap[] {
  const gaps: Tier1QaGap[] = []
  const bugById = new Map(bugs.map((b) => [b.pageId, b]))

  for (const test of tests) {
    const linkedBugs = test.linkedBugIds.map((id) => bugById.get(id)).filter((b): b is Tier1BugRecord => Boolean(b))
    const hasActiveBug = linkedBugs.some((b) => b.classification === 'open')
    const hasOnlyInactiveBug =
      linkedBugs.length > 0 && linkedBugs.every((b) => b.classification !== 'open' && b.classification !== 'released')
    const hasReleasedBug = linkedBugs.some((b) => b.classification === 'released')

    if (WAITING_FOR_FIX.test(test.statusBdika) && !hasActiveBug && linkedBugs.length === 0) {
      gaps.push({ type: 'waiting_for_fix_no_active_bug', testId: test.testId, note: `בדיקה ${test.testId} ממתינה לתיקון אך אין לה באג פעיל מקושר` })
    }
    if (hasReleasedBug && !test.done) {
      gaps.push({ type: 'regression_needed', testId: test.testId, note: `בדיקה ${test.testId}: באג מקושר Released אך הבדיקה טרם Done — נדרשת בדיקת רגרסיה` })
    }
    if (WAITING_FOR_FIX.test(test.statusBdika) && hasOnlyInactiveBug) {
      gaps.push({ type: 'test_linked_only_to_inactive_bug', testId: test.testId, note: `בדיקה ${test.testId} ממתינה לתיקון אך מקושרת רק לבאג לא-פעיל (Cancelled/Archived/Deleted)` })
    }
    if (WAITING_FOR_OR.test(test.statusBdika) && hasReleasedBug) {
      gaps.push({ type: 'waiting_on_or_review_after_release', testId: test.testId, note: `בדיקה ${test.testId} ממתינה לבדיקת אור לאחר שהבאג המקושר כבר Released` })
    } else if (WAITING_FOR_OR.test(test.statusBdika)) {
      gaps.push({ type: 'waiting_on_or_review', testId: test.testId, note: `בדיקה ${test.testId} ממתינה לבדיקת אור` })
    }
    if (CANCELLED_TEST.test(test.statusBdika) && hasActiveBug) {
      gaps.push({ type: 'cancelled_test_linked_to_active_task', testId: test.testId, note: `בדיקה ${test.testId} בוטלה אך עדיין מקושרת למשימה פעילה` })
    }
    if (!test.gush || !test.chelka || (!test.resultLink && test.done)) {
      gaps.push({ type: 'missing_data_relevant_to_progress', testId: test.testId, note: `בדיקה ${test.testId}: חסר גוש/חלקה או לינק לתוצאה` })
    }

    for (const c of test.comments) {
      if (/\?/.test(c.text) && !commentAnswered(c, test.comments)) {
        gaps.push({ type: 'unanswered_question', testId: test.testId, note: `שאלה פתוחה בתגובות על בדיקה ${test.testId} ללא מענה` })
      }
      if (/ממתין לאור|מחכה לאור/.test(c.text)) {
        gaps.push({ type: 'waiting_on_or_review', testId: test.testId, note: `תגובה בבדיקה ${test.testId}: דור מציין שהוא ממתין לאור` })
      }
    }
  }

  for (const bug of bugs) {
    // Once a bug reaches Ready for QA, dev's part of the work is done — a
    // missing Assignee/Due is no longer דור's responsibility to chase (and
    // would otherwise double-count the same bug under both "@דור" and the
    // Ready for QA ownership section). Per Alpir (2026-10-05): ownership for
    // a Ready for QA bug is only ever אור or אלפיר/QA, never דור.
    const isReadyForQa = READY_FOR_QA.test(bug.status)
    if (bug.classification === 'open' && bug.assignee.length === 0 && !isReadyForQa) {
      gaps.push({ type: 'open_bug_missing_assignee', bugId: bug.bugId, note: `באג ${bug.bugId} פתוח ללא Assignee` })
    }
    if (bug.classification === 'open' && !bug.due && !isReadyForQa) {
      gaps.push({ type: 'open_bug_missing_due', bugId: bug.bugId, note: `באג ${bug.bugId} פתוח ללא Due date` })
    }
    if (bug.classification === 'open' && isReadyForQa) {
      // Owner = the ticket's QA; if none, its Reporter; if neither, unassigned
      // (routeOwner turns an empty `people` into "נדרש לקבוע בעלים").
      const peopleSource: PeopleSource | undefined =
        bug.qa.length > 0 ? 'qa' : bug.reporter.length > 0 ? 'reporter' : undefined
      const people = peopleSource === 'qa' ? bug.qa : peopleSource === 'reporter' ? bug.reporter : []
      const who =
        peopleSource === 'qa'
          ? `ממתין ל-QA של הטיקט: ${people.join(', ')}`
          : peopleSource === 'reporter'
            ? `אין QA בטיקט — ממתין ל-Reporter: ${people.join(', ')}`
            : 'אין QA ואין Reporter בטיקט'
      gaps.push({
        type: 'ready_for_qa',
        bugId: bug.bugId,
        note: `באג ${bug.bugId} ב-Ready for QA — ${who}`,
        people,
        ...(peopleSource ? { peopleSource } : {}),
      })
    }
    if (bug.classification === 'deleted' && bug.linkedTestIds.length > 0) {
      gaps.push({ type: 'deleted_task_still_linked', bugId: bug.bugId, note: `משימה ${bug.bugId} נמחקה אך עדיין מקושרת לבדיקה` })
    }
  }

  return gaps
}

/** Naive "answered" heuristic: a later comment by a different author exists. */
function commentAnswered(question: NotionComment, all: NotionComment[]): boolean {
  return all.some((c) => c.createdTime > question.createdTime && c.authorName !== question.authorName)
}

// ─── Diffing (§9) ────────────────────────────────────────────────────────

export interface Tier1QaSnapshotPayload {
  snapshotDate: string
  testsSnapshot: Array<{ testId: string; statusBdika: string; done: boolean; testedBy: string[]; hasResultLink: boolean; linkedBugIds: string[] }>
  bugsSnapshot: Array<{ bugId: string; status: string; priority: string; assignee: string[]; due: string | null; classification: BugClassification }>
  summaryStats: Tier1QaStats
}

export async function loadLatestSnapshot(db: Db, beforeDateKey: string): Promise<Tier1QaSnapshotPayload | null> {
  const rows = await db
    .select()
    .from(tier1QaSnapshots)
    .orderBy(desc(tier1QaSnapshots.snapshotDate))
    .limit(5)
  const prior = rows.find((r) => r.snapshotDate < beforeDateKey)
  if (!prior) return null
  return {
    snapshotDate: prior.snapshotDate,
    testsSnapshot: JSON.parse(prior.testsSnapshot),
    bugsSnapshot: JSON.parse(prior.bugsSnapshot),
    summaryStats: JSON.parse(prior.summaryStats),
  }
}

export async function saveSnapshot(db: Db, result: Tier1QaScanResult): Promise<void> {
  if (result.incomplete) return
  const payload: Tier1QaSnapshotPayload = {
    snapshotDate: result.jerusalemDateKey,
    testsSnapshot: result.tests.map((t) => ({
      testId: t.testId,
      statusBdika: t.statusBdika,
      done: t.done,
      testedBy: t.testedBy,
      hasResultLink: Boolean(t.resultLink),
      linkedBugIds: t.linkedBugIds,
    })),
    bugsSnapshot: result.bugs.map((b) => ({
      bugId: b.bugId,
      status: b.status,
      priority: b.priority,
      assignee: b.assignee,
      due: b.due,
      classification: b.classification,
    })),
    summaryStats: result.stats,
  }
  // Upsert by snapshotDate (unique) — a re-run on the same Jerusalem calendar
  // day (e.g. a manual "הרץ עכשיו" after fixing something, same day as an
  // earlier successful run) must overwrite that day's snapshot with the
  // freshest data, not fail on the unique constraint.
  const existing = await db
    .select({ id: tier1QaSnapshots.id })
    .from(tier1QaSnapshots)
    .where(eq(tier1QaSnapshots.snapshotDate, payload.snapshotDate))
    .limit(1)

  const row = {
    snapshotDate: payload.snapshotDate,
    testsSnapshot: JSON.stringify(payload.testsSnapshot),
    bugsSnapshot: JSON.stringify(payload.bugsSnapshot),
    summaryStats: JSON.stringify(payload.summaryStats),
    createdAt: new Date().toISOString(),
  }

  if (existing[0]) {
    await db.update(tier1QaSnapshots).set(row).where(eq(tier1QaSnapshots.id, existing[0].id))
  } else {
    await db.insert(tier1QaSnapshots).values({ id: newId('t1qa_'), ...row })
  }
}

// ─── Grounding payload for the LLM narration step ───────────────────────────

/**
 * Trims the scan result down to exactly the facts the agent's LLM step is
 * allowed to narrate — no raw page bodies/comment text (those already fed
 * gap detection above), just the structured numbers/classifications. Keeping
 * this surface small is a second, independent guard against invention: the
 * model literally cannot embellish with something that isn't in here.
 */
export function buildGroundingPayload(scan: Tier1QaScanResult) {
  return {
    dateTimeLabel: scan.jerusalemDateTimeLabel,
    stats: scan.stats,
    tests: scan.tests.map((t) => ({
      testId: t.testId,
      pageUrl: t.pageUrl,
      street: t.street,
      gush: t.gush,
      chelka: t.chelka,
      statusBdika: t.statusBdika,
      resultLink: t.resultLink,
      testedBy: t.testedBy,
      done: t.done,
      // Lets the narration step group bugs under the street/test they belong
      // to (e.g. "צירלסון 22 (3 באגים)") instead of listing every bug flat.
      linkedBugIds: t.linkedBugIds,
    })),
    bugs: scan.bugs.map((b) => ({
      bugId: b.bugId,
      pageUrl: b.pageUrl,
      taskName: b.taskName,
      status: b.status,
      classification: b.classification,
      priority: b.priority,
      assignee: b.assignee,
      qa: b.qa,
      reporter: b.reporter,
      due: b.due,
      type: b.type,
      linkedTestIds: b.linkedTestIds,
    })),
    gaps: scan.gaps,
    ownerActions: scan.ownerActions,
    diff: scan.diff,
  }
}

const GROUNDING_INSTRUCTIONS =
  'הנתונים הבאים חושבו וסווגו מראש בקוד דטרמיניסטי — הם המקור היחיד לאמת. ' +
  'נסח מהם את הודעת ה-WhatsApp לפי הפורמט וכללי הכתיבה בהוראות הסוכן. ' +
  'אסור לחשב מספר, לשנות סיווג, או להוסיף עובדה שאינה מופיעה כאן במפורש. ' +
  'הנתונים (JSON):\n\n'

/** The exact message text handed to the agent's LLM step for narration. */
export function formatGroundingMessage(scan: Tier1QaScanResult): string {
  return GROUNDING_INSTRUCTIONS + JSON.stringify(buildGroundingPayload(scan))
}

// ─── Delivery ────────────────────────────────────────────────────────────

/**
 * Sends the already-composed Hebrew message into the configured WhatsApp
 * group — gated by the `tier1_qa_daily_update` notification preference
 * (off by default; see notification-preferences.ts). This is the "flip a
 * switch to go live" mechanism from the spec's rollout plan: while the
 * WhatsApp channel is off, this is a no-op and the message only reaches
 * push/in-app via the caller's own pushAssistantMessage call.
 *
 * Never call this from the incomplete-scan branch — the hard safety rule
 * (never send a partial update) must bypass this function entirely, not
 * rely on it declining.
 */
export async function deliverTier1QaGroupUpdate(
  text: string,
  groupJid: string,
): Promise<{ ok: boolean; error?: string }> {
  const channels = await resolveNotificationChannels(TIER1_QA_NOTIFICATION_TYPE_ID)
  if (!channels.whatsapp) return { ok: false, error: 'whatsapp channel disabled (draft mode)' }
  if (!isBridgeConfigured()) return { ok: false, error: 'WhatsApp bridge not configured' }
  return sendBridgeGroupText(groupJid, text)
}

export function computeDiff(tests: Tier1TestRecord[], bugs: Tier1BugRecord[], prior: Tier1QaSnapshotPayload): Tier1QaDiffEntry[] {
  const diffs: Tier1QaDiffEntry[] = []
  const priorTestByI = new Map(prior.testsSnapshot.map((t) => [t.testId, t]))
  const priorBugById = new Map(prior.bugsSnapshot.map((b) => [b.bugId, b]))

  for (const t of tests) {
    const before = priorTestByI.get(t.testId)
    if (before && before.statusBdika !== t.statusBdika) {
      diffs.push({ kind: 'test_status_changed', note: `בדיקה ${t.testId}: שינתה סטטוס מ"${before.statusBdika}" ל"${t.statusBdika}"` })
    }
  }
  for (const b of bugs) {
    const before = priorBugById.get(b.bugId)
    if (!before && b.classification === 'open') {
      diffs.push({ kind: 'bug_opened', note: `באג חדש נפתח: ${b.bugId}` })
    } else if (before && before.classification !== 'released' && b.classification === 'released') {
      diffs.push({ kind: 'bug_released', note: `באג ${b.bugId} שוחרר (Released)` })
    }
  }

  return diffs.slice(0, 5)
}

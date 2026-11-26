/**
 * A meeting action item and the commitment proposed from it are one thing
 * (docs/specs/commitment-task-linking.md). The item stores its commitment's id
 * (`commitmentId` in `meeting_analyses.action_items_json`), and every write on either side
 * goes through here so the meeting page and התחייבויות always agree.
 */
import { and, desc, eq, inArray } from 'drizzle-orm'
import { commitments, meetingAnalyses, type getDb } from '@ak-system/database'

type Db = ReturnType<typeof getDb>

export interface LinkedActionItem {
  content: string
  owner?: string
  personId?: string
  taskId?: string
  commitmentId?: string
  dismissed?: boolean
  [key: string]: unknown
}

const ANALYSIS_SOURCES = ['meeting_analysis', 'voice'] as const

/** The same normalization `proposeCommitmentsFromAnalysis` stores as commitment content. */
export function actionItemKey(content: unknown): string {
  return typeof content === 'string' ? content.replace(/\s+/g, ' ').trim().slice(0, 140) : ''
}

function parseItems(json: string | null): LinkedActionItem[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json) as unknown
    return Array.isArray(parsed) ? (parsed as LinkedActionItem[]) : []
  } catch {
    return []
  }
}

/** The analysis the meeting page shows: the newest completed one. */
async function latestAnalysis(db: Db, meetingId: string) {
  const [row] = await db
    .select({ id: meetingAnalyses.id, actionItemsJson: meetingAnalyses.actionItemsJson })
    .from(meetingAnalyses)
    .where(and(eq(meetingAnalyses.meetingId, meetingId), eq(meetingAnalyses.status, 'completed')))
    .orderBy(desc(meetingAnalyses.createdAt))
    .limit(1)
  return row ?? null
}

async function writeItems(db: Db, analysisId: string, items: LinkedActionItem[]): Promise<void> {
  await db
    .update(meetingAnalyses)
    .set({ actionItemsJson: JSON.stringify(items), updatedAt: new Date().toISOString() })
    .where(eq(meetingAnalyses.id, analysisId))
}

/** Copies a commitment's state onto its item. Returns true when the item changed. */
function applyCommitmentState(
  item: LinkedActionItem,
  c: { id: string; status: string; taskId: string | null },
): boolean {
  const before = JSON.stringify(item)
  item.commitmentId = c.id
  if (c.taskId) item.taskId = c.taskId
  if (c.status === 'dismissed' && !item.taskId) item.dismissed = true
  else delete item.dismissed
  return JSON.stringify(item) !== before
}

/**
 * Pairs each item of an analysis with its commitment (same meeting) and writes the id on the
 * item, then reconciles state both ways: a task on either side lands on the other, and a
 * dismissed commitment marks its item. Safe to run repeatedly — re-analysis and backfill use it.
 */
export async function linkAnalysisItems(
  db: Db,
  analysisId: string,
): Promise<{ linked: number; actionItemsJson: string | null }> {
  const [analysis] = await db
    .select({ meetingId: meetingAnalyses.meetingId, actionItemsJson: meetingAnalyses.actionItemsJson })
    .from(meetingAnalyses)
    .where(eq(meetingAnalyses.id, analysisId))
  if (!analysis) return { linked: 0, actionItemsJson: null }
  const items = parseItems(analysis.actionItemsJson)
  if (items.length === 0) return { linked: 0, actionItemsJson: analysis.actionItemsJson }

  const rows = await db
    .select({ id: commitments.id, content: commitments.content, status: commitments.status, taskId: commitments.taskId, createdAt: commitments.createdAt })
    .from(commitments)
    .where(and(eq(commitments.sourceId, analysis.meetingId), inArray(commitments.source, [...ANALYSIS_SOURCES])))
    .orderBy(commitments.createdAt)
  const byId = new Map(rows.map((r) => [r.id, r]))
  const taken = new Set(items.map((i) => i.commitmentId).filter((id): id is string => !!id && byId.has(id)))

  let changed = false
  let linked = 0
  const now = new Date().toISOString()
  for (const item of items) {
    let c = item.commitmentId ? byId.get(item.commitmentId) : undefined
    if (!c) {
      // First pairing: the commitment was created from this item's own text.
      const key = actionItemKey(item.content)
      c = key ? rows.find((r) => !taken.has(r.id) && r.content === key) : undefined
      if (!c) {
        if (item.commitmentId) {
          delete item.commitmentId
          changed = true
        }
        continue
      }
      taken.add(c.id)
    }
    linked++
    // A task created on the meeting side closes the proposal.
    if (item.taskId && !c.taskId && c.status !== 'dismissed') {
      await db
        .update(commitments)
        .set({ status: 'accepted', taskId: item.taskId, updatedAt: now })
        .where(eq(commitments.id, c.id))
      c = { ...c, status: 'accepted', taskId: item.taskId }
    }
    if (applyCommitmentState(item, c)) changed = true
  }
  if (!changed) return { linked, actionItemsJson: analysis.actionItemsJson }
  await writeItems(db, analysisId, items)
  return { linked, actionItemsJson: JSON.stringify(items) }
}

/**
 * Commitment side → meeting side. Call after any accept / linkTask / dismiss of a commitment;
 * no-op for commitments that didn't come from a meeting analysis.
 */
export async function syncItemFromCommitment(db: Db, commitmentId: string): Promise<boolean> {
  const [c] = await db
    .select({ id: commitments.id, source: commitments.source, sourceId: commitments.sourceId, content: commitments.content, status: commitments.status, taskId: commitments.taskId })
    .from(commitments)
    .where(eq(commitments.id, commitmentId))
  if (!c?.sourceId || !(ANALYSIS_SOURCES as readonly string[]).includes(c.source)) return false
  const analysis = await latestAnalysis(db, c.sourceId)
  if (!analysis) return false
  const items = parseItems(analysis.actionItemsJson)
  let item = items.find((i) => i.commitmentId === c.id)
  if (!item) {
    // Older analyses never stored the id — pair by the text the commitment was made from.
    item = items.find((i) => !i.commitmentId && actionItemKey(i.content) === c.content)
  }
  if (!item) return false
  if (!applyCommitmentState(item, c)) return false
  await writeItems(db, analysis.id, items)
  return true
}

/**
 * Meeting side → commitment side. Call after a task is created for / linked to an action item.
 * Accepts the item's commitment with that task (any open state, so a proposal answered from
 * the meeting leaves התחייבויות).
 */
export async function acceptCommitmentForItem(
  db: Db,
  meetingId: string,
  item: LinkedActionItem,
  taskId: string,
): Promise<boolean> {
  let commitmentId = item.commitmentId
  if (!commitmentId) {
    const key = actionItemKey(item.content)
    if (!key) return false
    const [row] = await db
      .select({ id: commitments.id })
      .from(commitments)
      .where(
        and(
          eq(commitments.sourceId, meetingId),
          inArray(commitments.source, [...ANALYSIS_SOURCES]),
          eq(commitments.content, key),
        ),
      )
      .limit(1)
    if (!row) return false
    commitmentId = row.id
    item.commitmentId = row.id
  }
  delete item.dismissed
  await db
    .update(commitments)
    .set({ status: 'accepted', taskId, updatedAt: new Date().toISOString() })
    .where(eq(commitments.id, commitmentId))
  return true
}

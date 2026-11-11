/**
 * "Local wins" guard for the Notion → app sync.
 *
 * Notion stays an inbound feed, but a field the user edited in the app must not be
 * overwritten by the next sync. For every synced field we remember the last value
 * imported from Notion (`notion_field_baselines`). If the row's current value differs
 * from that baseline, the change is local and the sync leaves the field alone.
 * No mutation needs to know about this — edits are detected by comparison.
 */

import { getDb, notionFieldBaselines, eq, and } from '@ak-system/database'

type Db = ReturnType<typeof getDb>

export type SyncEntity = 'task' | 'meeting' | 'project' | 'company'

function newId(): string {
  return 'nfb_' + Date.now() + Math.random().toString(36).slice(2, 7)
}

/** Stable string form so `undefined`, `null` and equal values compare reliably. */
function encode(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value)
}

async function loadBaselines(db: Db, entity: SyncEntity, entityId: string) {
  const rows = await db
    .select()
    .from(notionFieldBaselines)
    .where(and(eq(notionFieldBaselines.entity, entity), eq(notionFieldBaselines.entityId, entityId)))
  return new Map(rows.map((r) => [r.field, r]))
}

async function writeBaseline(
  db: Db,
  entity: SyncEntity,
  entityId: string,
  field: string,
  encoded: string,
  existing: { id: string; baselineValue: string } | undefined,
) {
  const now = new Date().toISOString()
  if (existing) {
    if (existing.baselineValue === encoded) return
    await db
      .update(notionFieldBaselines)
      .set({ baselineValue: encoded, updatedAt: now })
      .where(eq(notionFieldBaselines.id, existing.id))
  } else {
    await db
      .insert(notionFieldBaselines)
      .values({ id: newId(), entity, entityId, field, baselineValue: encoded, updatedAt: now })
  }
}

/**
 * Filters Notion's incoming field values down to the ones the sync may write, and
 * advances baselines. `current` is the row as it is stored right now.
 */
export async function resolveNotionPatch(
  db: Db,
  entity: SyncEntity,
  entityId: string,
  current: Record<string, unknown>,
  incoming: Record<string, unknown>,
): Promise<{ patch: Record<string, unknown>; skipped: string[] }> {
  const baselines = await loadBaselines(db, entity, entityId)
  const patch: Record<string, unknown> = {}
  const skipped: string[] = []

  for (const [field, value] of Object.entries(incoming)) {
    const cur = encode(current[field])
    const inc = encode(value)
    const baseline = baselines.get(field)

    if (!baseline || baseline.baselineValue === cur) {
      // Never imported before, or untouched locally: Notion's value applies.
      patch[field] = value
      await writeBaseline(db, entity, entityId, field, inc, baseline)
    } else if (cur === inc) {
      // Local edit that Notion now agrees with (e.g. after write-back): converge.
      await writeBaseline(db, entity, entityId, field, inc, baseline)
    } else {
      skipped.push(field)
    }
  }

  return { patch, skipped }
}

/** Fields of this row that currently differ from what Notion last delivered. */
export async function getLocalOverrides(
  db: Db,
  entity: SyncEntity,
  entityId: string,
  current: Record<string, unknown>,
): Promise<string[]> {
  const baselines = await loadBaselines(db, entity, entityId)
  const out: string[] = []
  for (const [field, row] of baselines) {
    if (field in current && row.baselineValue !== encode(current[field])) out.push(field)
  }
  return out
}

/** Marks the current local value as "in sync", so the next Notion sync applies Notion's value. */
export async function resetNotionField(
  db: Db,
  entity: SyncEntity,
  entityId: string,
  field: string,
  currentValue: unknown,
): Promise<void> {
  const baselines = await loadBaselines(db, entity, entityId)
  await writeBaseline(db, entity, entityId, field, encode(currentValue), baselines.get(field))
}

/**
 * Applies a Notion-derived update to one row, writing only the fields the user has not
 * edited locally. `extra` fields (timestamps, provenance) are always written.
 */
export async function updateFromNotion(
  db: Db,
  // Any drizzle table with an `id` column; sqlite/pg table types don't unify.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any,
  entity: SyncEntity,
  id: string,
  incoming: Record<string, unknown>,
  extra: Record<string, unknown> = {},
): Promise<{ skipped: string[] }> {
  const [row] = await db.select().from(table).where(eq(table.id, id)).limit(1)
  const { patch, skipped } = await resolveNotionPatch(db, entity, id, (row ?? {}) as Record<string, unknown>, incoming)
  const values = { ...patch, ...extra }
  if (Object.keys(values).length > 0) await db.update(table).set(values).where(eq(table.id, id))
  return { skipped }
}

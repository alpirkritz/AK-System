/**
 * Multi-source person identity helpers (Notion page ids across directories,
 * Google Contacts, Slack, calendar email).
 */

import {
  getDb,
  people,
  personExternalIds,
  eq,
  and,
} from '@ak-system/database'

type Db = ReturnType<typeof getDb>

export type ExternalProvider = 'notion' | 'google_contact' | 'slack' | 'email'

function newId(prefix: string): string {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 7)
}

/** Upsert one external identity row; returns the owning person id. */
export async function upsertPersonExternalId(
  db: Db,
  input: {
    personId: string
    provider: ExternalProvider
    accountKey: string
    externalId: string
    displayName?: string | null
    raw?: string | null
  },
): Promise<{ created: boolean }> {
  const now = new Date().toISOString()
  const existing = await db
    .select()
    .from(personExternalIds)
    .where(
      and(
        eq(personExternalIds.provider, input.provider),
        eq(personExternalIds.accountKey, input.accountKey),
        eq(personExternalIds.externalId, input.externalId),
      ),
    )
    .limit(1)

  if (existing[0]) {
    await db
      .update(personExternalIds)
      .set({
        personId: input.personId,
        displayName: input.displayName ?? existing[0].displayName,
        raw: input.raw ?? existing[0].raw,
        updatedAt: now,
      })
      .where(eq(personExternalIds.id, existing[0].id))
    return { created: false }
  }

  await db.insert(personExternalIds).values({
    id: newId('pext_'),
    personId: input.personId,
    provider: input.provider,
    accountKey: input.accountKey,
    externalId: input.externalId,
    displayName: input.displayName ?? null,
    raw: input.raw ?? null,
    createdAt: now,
    updatedAt: now,
  })
  return { created: true }
}

/** Find person id by any Notion page id across all account keys. */
export async function findPersonIdByNotionPageId(
  db: Db,
  notionPageId: string,
): Promise<string | null> {
  const rows = await db
    .select({ personId: personExternalIds.personId })
    .from(personExternalIds)
    .where(
      and(
        eq(personExternalIds.provider, 'notion'),
        eq(personExternalIds.externalId, notionPageId),
      ),
    )
    .limit(1)
  if (rows[0]) return rows[0].personId

  // Legacy fallback: denormalized people.notion_page_id
  const legacy = await db
    .select({ id: people.id })
    .from(people)
    .where(eq(people.notionPageId, notionPageId))
    .limit(1)
  return legacy[0]?.id ?? null
}

/** Move all external identities from one person to another (merge). */
export async function repointPersonExternalIds(
  db: Db,
  fromId: string,
  toId: string,
): Promise<void> {
  if (fromId === toId) return
  const fromRows = await db
    .select()
    .from(personExternalIds)
    .where(eq(personExternalIds.personId, fromId))

  for (const row of fromRows) {
    const clash = await db
      .select()
      .from(personExternalIds)
      .where(
        and(
          eq(personExternalIds.provider, row.provider),
          eq(personExternalIds.accountKey, row.accountKey),
          eq(personExternalIds.externalId, row.externalId),
          eq(personExternalIds.personId, toId),
        ),
      )
      .limit(1)
    if (clash[0]) {
      await db.delete(personExternalIds).where(eq(personExternalIds.id, row.id))
    } else {
      await db
        .update(personExternalIds)
        .set({ personId: toId, updatedAt: new Date().toISOString() })
        .where(eq(personExternalIds.id, row.id))
    }
  }
}

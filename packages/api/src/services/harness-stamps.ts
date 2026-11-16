/** Last-run stamps for the harness (spec: harness-world-state-header). */
import { eq } from 'drizzle-orm'
import { queryRows, runMutation, userSettings, type getDb } from '@ak-system/database'

type Db = ReturnType<typeof getDb>
const SETTINGS_ID = 'default'

export type HarnessStamp = 'harnessIndexedAt' | 'harnessReasonedAt'

export async function writeHarnessStamp(db: Db, field: HarnessStamp, at = new Date().toISOString()): Promise<void> {
  try {
    const rows = await queryRows<{ id: string }>(
      db.select({ id: userSettings.id }).from(userSettings).where(eq(userSettings.id, SETTINGS_ID)).limit(1),
    )
    if (rows.length > 0) {
      await runMutation(db.update(userSettings).set({ [field]: at }).where(eq(userSettings.id, SETTINGS_ID)))
    } else {
      await runMutation(db.insert(userSettings).values({ id: SETTINGS_ID, [field]: at, updatedAt: at }))
    }
  } catch (err) {
    console.warn('[harness-stamps] write failed', err)
  }
}

export async function readHarnessStamps(db: Db): Promise<{ indexedAt: string | null; reasonedAt: string | null }> {
  const rows = await queryRows<{ indexedAt: string | null; reasonedAt: string | null }>(
    db
      .select({ indexedAt: userSettings.harnessIndexedAt, reasonedAt: userSettings.harnessReasonedAt })
      .from(userSettings)
      .where(eq(userSettings.id, SETTINGS_ID))
      .limit(1),
  )
  return { indexedAt: rows[0]?.indexedAt ?? null, reasonedAt: rows[0]?.reasonedAt ?? null }
}

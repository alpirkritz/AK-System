import { eq } from 'drizzle-orm'
import { getDb, queryRows, userSettings } from '@ak-system/database'
import { LAYOUT_SCREENS, type LayoutPrefs, type LayoutScreen, type ScreenLayout } from '@ak-system/types'

const SETTINGS_ID = 'default'
const MAX_IDS = 60
const MAX_ID_LENGTH = 80

/** Keeps only plain, bounded, unique string ids. */
function cleanIds(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const v of value) {
    if (typeof v === 'string' && v.length > 0 && v.length <= MAX_ID_LENGTH && !out.includes(v)) out.push(v)
    if (out.length >= MAX_IDS) break
  }
  return out
}

export function parseLayoutPrefs(raw: string | null | undefined): LayoutPrefs {
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, Partial<ScreenLayout> | undefined>
    const out: LayoutPrefs = {}
    for (const screen of LAYOUT_SCREENS) {
      const entry = parsed?.[screen]
      if (!entry) continue
      out[screen] = {
        order: cleanIds(entry.order),
        hidden: cleanIds(entry.hidden),
        ...(entry.collapsed ? { collapsed: cleanIds(entry.collapsed) } : {}),
      }
    }
    return out
  } catch {
    return {}
  }
}

export async function getLayoutPrefs(): Promise<LayoutPrefs> {
  try {
    const db = getDb()
    const rows = await queryRows<{ layoutPrefs: string | null }>(
      db.select({ layoutPrefs: userSettings.layoutPrefs }).from(userSettings).where(eq(userSettings.id, SETTINGS_ID)).limit(1),
    )
    return parseLayoutPrefs(rows[0]?.layoutPrefs)
  } catch (err) {
    console.warn('[layout-prefs] get failed:', err)
    return {}
  }
}

async function saveLayoutPrefs(prefs: LayoutPrefs): Promise<void> {
  const db = getDb()
  const now = new Date().toISOString()
  const stored = JSON.stringify(prefs)
  const rows = await queryRows<{ id: string }>(
    db.select({ id: userSettings.id }).from(userSettings).where(eq(userSettings.id, SETTINGS_ID)).limit(1),
  )
  if (rows[0]) {
    await db.update(userSettings).set({ layoutPrefs: stored, updatedAt: now }).where(eq(userSettings.id, SETTINGS_ID))
  } else {
    await db.insert(userSettings).values({ id: SETTINGS_ID, layoutPrefs: stored, updatedAt: now })
  }
}

export async function setScreenLayout(screen: LayoutScreen, layout: ScreenLayout): Promise<LayoutPrefs> {
  const current = await getLayoutPrefs()
  const next: LayoutPrefs = {
    ...current,
    [screen]: {
      order: cleanIds(layout.order),
      hidden: cleanIds(layout.hidden),
      ...(layout.collapsed ? { collapsed: cleanIds(layout.collapsed) } : {}),
    },
  }
  await saveLayoutPrefs(next)
  return next
}

export async function resetScreenLayout(screen: LayoutScreen): Promise<LayoutPrefs> {
  const current = await getLayoutPrefs()
  const { [screen]: _dropped, ...rest } = current
  await saveLayoutPrefs(rest)
  return rest
}

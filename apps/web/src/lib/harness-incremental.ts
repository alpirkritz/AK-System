import type { HarnessScope } from '@ak-system/api'
import { createServiceCaller } from '@/lib/api-caller'

/**
 * Re-index only the harness scopes a sync cron just touched (spec: harness-world-state-header).
 * Never throws: a sync that succeeded must not report failure because the index lagged.
 */
export async function reindexHarnessScopes(scopes: HarnessScope[], changed: boolean): Promise<void> {
  if (!changed || scopes.length === 0) return
  try {
    const caller = await createServiceCaller()
    // New or changed meetings get their world before the graph reads it (project-world-scoping).
    if (scopes.includes('meetings')) await caller.worlds.reresolve().catch((err) => console.warn('[harness-incremental] world resolve failed', err))
    await caller.harness.syncToGraph({ scopes })
  } catch (err) {
    console.warn('[harness-incremental] re-index failed for', scopes.join(','), err)
  }
}

/** True when a sync result reports any positive count (created / updated / synced …). */
export function hasPositiveCount(value: unknown, depth = 0): boolean {
  if (typeof value === 'number') return value > 0
  if (!value || typeof value !== 'object' || depth > 3) return false
  if (Array.isArray(value)) return value.length > 0 && value.some((v) => hasPositiveCount(v, depth + 1))
  return Object.values(value as Record<string, unknown>).some((v) => hasPositiveCount(v, depth + 1))
}

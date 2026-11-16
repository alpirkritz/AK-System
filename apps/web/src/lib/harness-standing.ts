import { getDb } from '@ak-system/database'
import { refreshStaleProjectStandings } from '@ak-system/api'

/** Refresh stale project briefs during the 6-hourly harness run; never fails the cron. */
export async function refreshStaleProjectStandingsSafe(): Promise<{ refreshed: number; failed: number }> {
  try {
    const res = await refreshStaleProjectStandings(getDb())
    return { refreshed: res.refreshed.length, failed: res.failed.length }
  } catch (err) {
    console.warn('[harness-standing] refresh skipped', err)
    return { refreshed: 0, failed: 0 }
  }
}

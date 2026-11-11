import { describe, it, expect, beforeEach } from 'vitest'
import { resetDb, getTestDb } from '../test-utils'
import { notifications } from '@ak-system/database'
import { checkBackupFreshness, recordBackupRun, shouldRaiseBackupAlert } from './backup-runs'

describe('backup runs', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('alerts when there is no successful db backup', async () => {
    expect(await checkBackupFreshness(getTestDb())).toContain('לא נמצא')
  })

  it('is healthy after a fresh success and stale after 26h', async () => {
    const db = getTestDb()
    const start = new Date('2026-10-29T01:00:00Z')
    await recordBackupRun(db, { kind: 'db', status: 'ok', startedAt: start.toISOString(), sizeBytes: 10 })
    expect(await checkBackupFreshness(db, start.getTime() + 3_600_000)).toBeNull()
    expect(await checkBackupFreshness(db, start.getTime() + 27 * 3_600_000)).toContain('לפני')
  })

  it('ignores failed runs and non-db kinds when judging freshness', async () => {
    const db = getTestDb()
    const now = new Date().toISOString()
    await recordBackupRun(db, { kind: 'db', status: 'failed', startedAt: now, error: 'boom' })
    await recordBackupRun(db, { kind: 'audio', status: 'ok', startedAt: now })
    expect(await checkBackupFreshness(db)).not.toBeNull()
  })

  it('throttles repeated alerts with the same title to once per 12h', async () => {
    const db = getTestDb()
    const t0 = new Date('2026-11-01T10:00:00Z')
    expect(await shouldRaiseBackupAlert(db, 'T', t0.getTime())).toBe(true)
    await db.insert(notifications).values({
      id: 'n1', title: 'T', body: 'b', url: '/settings', type: 'system', readAt: null, createdAt: t0.toISOString(),
    })
    expect(await shouldRaiseBackupAlert(db, 'T', t0.getTime() + 3_600_000)).toBe(false)
    expect(await shouldRaiseBackupAlert(db, 'T', t0.getTime() + 13 * 3_600_000)).toBe(true)
    expect(await shouldRaiseBackupAlert(db, 'other', t0.getTime() + 3_600_000)).toBe(true)
  })
})

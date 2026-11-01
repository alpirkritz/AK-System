/**
 * Backup run bookkeeping. The host scripts (scripts/backup-*.sh) report each run here so the
 * app can show the last success and raise an alert when backups fail or silently stop.
 */

import { getDb, backupRuns, notifications, desc, eq, and } from '@ak-system/database'

type Db = ReturnType<typeof getDb>

export const BACKUP_KINDS = ['db', 'audio', 'audio_cleanup'] as const
export type BackupKind = (typeof BACKUP_KINDS)[number]

/** A daily job is overdue if its last success is older than this. */
export const BACKUP_STALE_HOURS = 26

export interface BackupReport {
  kind: BackupKind
  status: 'ok' | 'failed'
  startedAt: string
  finishedAt?: string | null
  sizeBytes?: number | null
  sha256?: string | null
  driveFileId?: string | null
  error?: string | null
}

export async function recordBackupRun(db: Db, report: BackupReport): Promise<string> {
  const id = 'bk_' + Date.now() + Math.random().toString(36).slice(2, 7)
  await db.insert(backupRuns).values({
    id,
    kind: report.kind,
    startedAt: report.startedAt,
    finishedAt: report.finishedAt ?? new Date().toISOString(),
    status: report.status,
    sizeBytes: report.sizeBytes ?? null,
    sha256: report.sha256 ?? null,
    driveFileId: report.driveFileId ?? null,
    error: report.error ?? null,
  })
  return id
}

export async function lastBackupRun(db: Db, kind: BackupKind, status?: 'ok' | 'failed') {
  const where = status
    ? and(eq(backupRuns.kind, kind), eq(backupRuns.status, status))
    : eq(backupRuns.kind, kind)
  const [row] = await db.select().from(backupRuns).where(where).orderBy(desc(backupRuns.startedAt)).limit(1)
  return row ?? null
}

/** Dead-man's switch for the daily DB backup: returns a problem description, or null when healthy. */
export async function checkBackupFreshness(db: Db, now = Date.now()): Promise<string | null> {
  const lastOk = await lastBackupRun(db, 'db', 'ok')
  if (!lastOk) return 'לא נמצא גיבוי מוצלח של ה-DB.'
  const ageHours = (now - new Date(lastOk.startedAt).getTime()) / 3_600_000
  if (ageHours > BACKUP_STALE_HOURS) {
    return `הגיבוי המוצלח האחרון היה לפני ${Math.round(ageHours)} שעות (${lastOk.startedAt}).`
  }
  return null
}

/** While a problem persists the hourly dead-man check re-detects it; notify at most this often. */
export const BACKUP_ALERT_THROTTLE_HOURS = 12

export const BACKUP_STALE_ALERT_TITLE = 'הגיבוי היומי לא רץ'

/** True unless a `system` notification with this title was already raised within the throttle window. */
export async function shouldRaiseBackupAlert(db: Db, title: string, now = Date.now()): Promise<boolean> {
  const [last] = await db
    .select({ createdAt: notifications.createdAt })
    .from(notifications)
    .where(and(eq(notifications.type, 'system'), eq(notifications.title, title)))
    .orderBy(desc(notifications.createdAt))
    .limit(1)
  if (!last) return true
  return now - new Date(last.createdAt).getTime() >= BACKUP_ALERT_THROTTLE_HOURS * 3_600_000
}

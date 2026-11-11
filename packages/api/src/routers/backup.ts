import { router, protectedProcedure } from '../trpc'
import { BACKUP_KINDS, BACKUP_STALE_HOURS, lastBackupRun } from '../services/backup-runs'

export const backupRouter = router({
  /** Last run and last success per backup kind, for the Settings card. */
  status: protectedProcedure.query(async ({ ctx }) => {
    const kinds = await Promise.all(
      BACKUP_KINDS.map(async (kind) => ({
        kind,
        last: await lastBackupRun(ctx.db, kind),
        lastOk: await lastBackupRun(ctx.db, kind, 'ok'),
      })),
    )
    const dbOk = kinds.find((k) => k.kind === 'db')?.lastOk ?? null
    const stale = !dbOk || Date.now() - new Date(dbOk.startedAt).getTime() > BACKUP_STALE_HOURS * 3_600_000
    return { kinds, stale }
  }),
})

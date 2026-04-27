/**
 * One-time migration: copy data from local SQLite to Postgres (e.g. Supabase).
 *
 * Usage:
 *   DATABASE_PATH=./apps/web/data/ak_system.sqlite DATABASE_URL="postgresql://..." pnpm tsx scripts/sqlite-to-postgres.ts
 *
 * Prerequisites:
 *   - Postgres schema already created (run from packages/database: DATABASE_URL=... pnpm run push)
 *   - DATABASE_PATH points to existing SQLite file
 *   - DATABASE_URL is the Postgres connection string
 */

import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as path from 'path'
import * as schemaSqlite from '../packages/database/src/schema'
import * as schemaPg from '../packages/database/src/schema.pg'

const DATABASE_PATH =
  process.env.DATABASE_PATH ||
  path.join(process.cwd(), 'apps', 'web', 'data', 'ak_system.sqlite')
const DATABASE_URL = process.env.DATABASE_URL

if (!DATABASE_URL) {
  console.error('DATABASE_URL is required (Postgres connection string)')
  process.exit(1)
}

function getSqliteDb() {
  const db = new Database(DATABASE_PATH, { readonly: true })
  return drizzleSqlite(db, { schema: schemaSqlite })
}

function getPgPool() {
  return new Pool({ connectionString: DATABASE_URL })
}

// SQLite query builder returns { all(): T[] }
function all<T>(q: { all?: () => T[] }): T[] {
  return q?.all?.() ?? []
}

const toBool = (v: unknown) => v === 1 || v === true

async function main() {
  const sqlite = getSqliteDb()
  const pool = getPgPool()
  const pg = drizzlePg(pool, { schema: schemaPg })

  const copy = async <T extends Record<string, unknown>>(
    name: string,
    rows: T[],
    insert: (rows: T[]) => Promise<void>,
  ) => {
    if (rows.length === 0) {
      console.log(`${name}: 0 rows`)
      return
    }
    await insert(rows)
    console.log(`${name}: ${rows.length} rows`)
  }

  await copy('people', all((sqlite as any).select().from(schemaSqlite.people)), (rows) =>
    pg.insert(schemaPg.people).values(rows).onConflictDoNothing(),
  )
  await copy('projects', all((sqlite as any).select().from(schemaSqlite.projects)), (rows) =>
    pg.insert(schemaPg.projects).values(rows).onConflictDoNothing(),
  )
  await copy('meetings', all((sqlite as any).select().from(schemaSqlite.meetings)), (rows) =>
    pg.insert(schemaPg.meetings).values(rows).onConflictDoNothing(),
  )
  await copy('meeting_people', all((sqlite as any).select().from(schemaSqlite.meetingPeople)), (rows) =>
    pg.insert(schemaPg.meetingPeople).values(rows).onConflictDoNothing(),
  )
  await copy('tasks', all((sqlite as any).select().from(schemaSqlite.tasks)), (rows) =>
    pg
      .insert(schemaPg.tasks)
      .values(rows.map((r) => ({ ...r, done: toBool(r.done) })))
      .onConflictDoNothing(),
  )
  await copy('task_people', all((sqlite as any).select().from(schemaSqlite.taskPeople)), (rows) =>
    pg.insert(schemaPg.taskPeople).values(rows).onConflictDoNothing(),
  )
  await copy('feed_sources', all((sqlite as any).select().from(schemaSqlite.feedSources)), (rows) =>
    pg.insert(schemaPg.feedSources).values(rows).onConflictDoNothing(),
  )
  await copy('feed_items', all((sqlite as any).select().from(schemaSqlite.feedItems)), (rows) =>
    pg.insert(schemaPg.feedItems).values(rows).onConflictDoNothing(),
  )
  await copy('facts', all((sqlite as any).select().from(schemaSqlite.facts)), (rows) =>
    pg.insert(schemaPg.facts).values(rows).onConflictDoNothing(),
  )
  await copy('chat_messages', all((sqlite as any).select().from(schemaSqlite.chatMessages)), (rows) =>
    pg.insert(schemaPg.chatMessages).values(rows).onConflictDoNothing(),
  )
  await copy('health_metrics', all((sqlite as any).select().from(schemaSqlite.healthMetrics)), (rows) =>
    pg.insert(schemaPg.healthMetrics).values(rows).onConflictDoNothing(),
  )
  await copy('push_subscriptions', all((sqlite as any).select().from(schemaSqlite.pushSubscriptions)), (rows) =>
    pg.insert(schemaPg.pushSubscriptions).values(rows).onConflictDoNothing(),
  )
  await copy('finance_trades', all((sqlite as any).select().from(schemaSqlite.financeTrades)), (rows) =>
    pg.insert(schemaPg.financeTrades).values(rows).onConflictDoNothing(),
  )
  await copy('finance_transactions', all((sqlite as any).select().from(schemaSqlite.financeTransactions)), (rows) =>
    pg.insert(schemaPg.financeTransactions).values(rows).onConflictDoNothing(),
  )

  await pool.end()
  console.log('Done.')
  process.exit(0)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})

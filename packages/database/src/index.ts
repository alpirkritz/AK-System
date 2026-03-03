import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from './schema'
import * as fs from 'fs'
import * as path from 'path'

function getDbPath(): string {
  if (process.env.DATABASE_PATH) {
    const p = process.env.DATABASE_PATH
    return path.isAbsolute(p) ? p : path.resolve(process.cwd(), p)
  }
  const cwd = process.cwd()
  const sep = path.sep
  const inWeb = cwd.endsWith('web') || cwd.includes(`${sep}web${sep}`)
  const base = inWeb ? cwd : path.join(cwd, 'apps', 'web')
  return path.join(base, 'data', 'ak_system.sqlite')
}

const CALENDAR_COLUMNS = [
  'ALTER TABLE meetings ADD COLUMN end_time TEXT',
  'ALTER TABLE meetings ADD COLUMN location TEXT',
  'ALTER TABLE meetings ADD COLUMN calendar_event_id TEXT',
  'ALTER TABLE meetings ADD COLUMN calendar_source TEXT',
]

const FINANCE_TABLES = [
  `CREATE TABLE IF NOT EXISTS finance_trades (
    id TEXT PRIMARY KEY,
    symbol TEXT NOT NULL,
    direction TEXT NOT NULL,
    quantity TEXT NOT NULL,
    price TEXT NOT NULL,
    commission TEXT,
    currency TEXT NOT NULL DEFAULT 'USD',
    trade_date TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'ibkr_email',
    raw_email_id TEXT,
    description TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS finance_transactions (
    id TEXT PRIMARY KEY,
    amount TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'ILS',
    direction TEXT NOT NULL,
    category TEXT,
    description TEXT,
    transaction_date TEXT NOT NULL,
    source TEXT NOT NULL,
    raw_data TEXT,
    created_at TEXT NOT NULL
  )`,
]

export function getDb() {
  const dbPath = getDbPath()
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const sqlite = new Database(dbPath)
  // idempotent column migrations — SQLite throws if column already exists, which we ignore
  for (const sql of CALENDAR_COLUMNS) {
    try { sqlite.prepare(sql).run() } catch (_) { /* column already exists */ }
  }
  // create finance tables if they don't exist
  for (const sql of FINANCE_TABLES) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  return drizzle(sqlite, { schema })
}

export * from './schema'

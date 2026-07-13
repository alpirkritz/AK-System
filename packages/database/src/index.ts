import Database from 'better-sqlite3'
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3'
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schemaSqlite from './schema'
import * as schemaPg from './schema.pg'
import * as fs from 'fs'
import * as path from 'path'

function usePostgres(): boolean {
  return Boolean(process.env.DATABASE_URL)
}

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
  'ALTER TABLE meetings ADD COLUMN category TEXT',
]

const PEOPLE_COLUMNS = [
  'ALTER TABLE people ADD COLUMN phone TEXT',
  'ALTER TABLE people ADD COLUMN company TEXT',
  'ALTER TABLE people ADD COLUMN job_title TEXT',
  'ALTER TABLE people ADD COLUMN linkedin TEXT',
  'ALTER TABLE people ADD COLUMN tags TEXT',
  'ALTER TABLE people ADD COLUMN expert_in TEXT',
  'ALTER TABLE people ADD COLUMN last_contact TEXT',
  'ALTER TABLE people ADD COLUMN goal TEXT',
  'ALTER TABLE people ADD COLUMN contact_frequency_days INTEGER',
  'ALTER TABLE people ADD COLUMN notes TEXT',
]

const FEED_TABLES = [
  `CREATE TABLE IF NOT EXISTS feed_sources (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    url TEXT NOT NULL,
    category TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS feed_items (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL REFERENCES feed_sources(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    link TEXT NOT NULL,
    summary TEXT,
    published_at TEXT NOT NULL,
    tags TEXT,
    created_at TEXT NOT NULL
  )`,
]

const FACTS_TABLE = [
  `CREATE TABLE IF NOT EXISTS facts (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'conversation',
    created_at TEXT NOT NULL
  )`,
]
const MEMORY_TABLES = [
  `CREATE TABLE IF NOT EXISTS hugo_instructions (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL DEFAULT '',
    enabled INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'memory',
    source TEXT NOT NULL DEFAULT 'manual',
    pinned INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_memories_kind ON memories(kind)`,
  `CREATE INDEX IF NOT EXISTS idx_memories_pinned ON memories(pinned, updated_at)`,
  `CREATE TABLE IF NOT EXISTS user_settings (
    id TEXT PRIMARY KEY,
    agent_calendar_ids TEXT,
    updated_at TEXT NOT NULL
  )`,
]
const CHAT_MESSAGES_TABLE = [
  `CREATE TABLE IF NOT EXISTS chat_messages (
    id TEXT PRIMARY KEY,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'web',
    created_at TEXT NOT NULL
  )`,
]
const AGENT_TABLES = [
  `CREATE TABLE IF NOT EXISTS agent_threads (
    agent_id TEXT PRIMARY KEY,
    cursor_agent_id TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS agent_messages (
    id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_agent_messages_agent_id ON agent_messages(agent_id)`,
]
const HEALTH_TABLE = [
  `CREATE TABLE IF NOT EXISTS health_metrics (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    value TEXT NOT NULL,
    at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'manual',
    created_at TEXT NOT NULL
  )`,
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
    email_subject TEXT,
    action_type TEXT NOT NULL DEFAULT 'trade',
    account TEXT,
    source_detail TEXT,
    notion_page_id TEXT,
    imported_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_finance_trades_notion_page_id ON finance_trades(notion_page_id)`,
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

const FINANCE_TRADES_COLUMNS = [
  'ALTER TABLE finance_trades ADD COLUMN email_subject TEXT',
  "ALTER TABLE finance_trades ADD COLUMN action_type TEXT NOT NULL DEFAULT 'trade'",
  'ALTER TABLE finance_trades ADD COLUMN account TEXT',
  'ALTER TABLE finance_trades ADD COLUMN source_detail TEXT',
  'ALTER TABLE finance_trades ADD COLUMN notion_page_id TEXT',
  'ALTER TABLE finance_trades ADD COLUMN imported_at TEXT',
]

const PUSH_SUBSCRIPTIONS_TABLE = [
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    id TEXT PRIMARY KEY,
    endpoint TEXT NOT NULL,
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_push_subscriptions_endpoint ON push_subscriptions(endpoint)`,
]

const EXPO_PUSH_TOKENS_TABLE = [
  `CREATE TABLE IF NOT EXISTS expo_push_tokens (
    id TEXT PRIMARY KEY,
    token TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL
  )`,
]

const NOTIFICATIONS_TABLE = [
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT NOT NULL,
    type TEXT NOT NULL,
    read_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at, created_at)`,
]

const WHATSAPP_TABLES = [
  `CREATE TABLE IF NOT EXISTS whatsapp_labels (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    summary_times TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS whatsapp_groups (
    id TEXT PRIMARY KEY,
    jid TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    label_id TEXT REFERENCES whatsapp_labels(id) ON DELETE SET NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    fomo_enabled INTEGER NOT NULL DEFAULT 0,
    fomo_threshold INTEGER NOT NULL DEFAULT 5,
    fomo_window_minutes INTEGER NOT NULL DEFAULT 5,
    summary_times TEXT,
    keywords TEXT NOT NULL DEFAULT '[]',
    last_fomo_alert_at TEXT,
    updated_at TEXT NOT NULL
  )`,
]

const AGENT_TRIGGERS_TABLE = [
  `CREATE TABLE IF NOT EXISTS agent_triggers (
    agent_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    schedule_times TEXT NOT NULL DEFAULT '[]',
    trigger_message TEXT,
    last_run_at TEXT,
    last_run_status TEXT,
    last_run_error TEXT,
    updated_at TEXT NOT NULL
  )`,
]

const NOTIFICATION_PREFERENCES_TABLE = [
  `CREATE TABLE IF NOT EXISTS notification_preferences (
    type_id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 1,
    channel_whatsapp INTEGER NOT NULL DEFAULT 1,
    channel_push INTEGER NOT NULL DEFAULT 1,
    channel_telegram INTEGER NOT NULL DEFAULT 1,
    schedule_times TEXT,
    last_sent_at TEXT,
    agent_id TEXT,
    trigger_message TEXT,
    updated_at TEXT NOT NULL
  )`,
]

const USER_SETTINGS_COLUMNS = [
  'ALTER TABLE user_settings ADD COLUMN agent_display_names TEXT',
]

const NOTIFICATION_PREFERENCES_COLUMNS = [
  'ALTER TABLE notification_preferences ADD COLUMN agent_id TEXT',
  'ALTER TABLE notification_preferences ADD COLUMN trigger_message TEXT',
]

const GOOGLE_CONNECTIONS_TABLE = [
  `CREATE TABLE IF NOT EXISTS google_connections (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL DEFAULT 'default',
    provider TEXT NOT NULL DEFAULT 'google',
    calendar_email TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT NOT NULL,
    token_expires_at TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_google_connections_email ON google_connections(calendar_email)`,
]

const VAT_ENTRIES_TABLE = [
  `CREATE TABLE IF NOT EXISTS vat_entries (
    id TEXT PRIMARY KEY,
    year INTEGER NOT NULL,
    period INTEGER NOT NULL,
    tax_code TEXT NOT NULL,
    category TEXT NOT NULL,
    entry_type TEXT NOT NULL,
    date TEXT NOT NULL,
    invoice_number TEXT,
    description TEXT NOT NULL,
    amount TEXT NOT NULL,
    is_vat_exempt INTEGER NOT NULL DEFAULT 0,
    deduction_percent TEXT,
    dollar_rate TEXT,
    invoice_file_url TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_vat_entries_year_period ON vat_entries(year, period)`,
  `CREATE INDEX IF NOT EXISTS idx_vat_entries_date ON vat_entries(date)`,
  `CREATE INDEX IF NOT EXISTS idx_vat_entries_tax_code ON vat_entries(tax_code)`,
]

const TASK_PEOPLE_TABLE = [
  `CREATE TABLE IF NOT EXISTS task_people (
    task_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
    person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_task_people_task_id ON task_people(task_id)`,
  `CREATE INDEX IF NOT EXISTS idx_task_people_person_id ON task_people(person_id)`,
]

let pgPool: Pool | null = null

function getPgPool(): Pool {
  if (!pgPool) {
    const url = process.env.DATABASE_URL
    if (!url) throw new Error('DATABASE_URL is required for Postgres')
    pgPool = new Pool({ connectionString: url })
  }
  return pgPool
}

export function getDb() {
  if (usePostgres()) {
    const pool = getPgPool()
    return drizzlePg(pool, { schema: schemaPg })
  }
  const dbPath = getDbPath()
  const dir = path.dirname(dbPath)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  const sqlite = new Database(dbPath)
  for (const sql of CALENDAR_COLUMNS) {
    try { sqlite.prepare(sql).run() } catch (_) { /* column already exists */ }
  }
  for (const sql of PEOPLE_COLUMNS) {
    try { sqlite.prepare(sql).run() } catch (_) { /* column already exists */ }
  }
  for (const sql of FEED_TABLES) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of FACTS_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of MEMORY_TABLES) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of HEALTH_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of CHAT_MESSAGES_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of AGENT_TABLES) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of FINANCE_TABLES) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of FINANCE_TRADES_COLUMNS) {
    try { sqlite.prepare(sql).run() } catch (_) { /* column already exists */ }
  }
  for (const sql of PUSH_SUBSCRIPTIONS_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of EXPO_PUSH_TOKENS_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of NOTIFICATIONS_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of TASK_PEOPLE_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of VAT_ENTRIES_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of WHATSAPP_TABLES) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of AGENT_TRIGGERS_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of GOOGLE_CONNECTIONS_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of NOTIFICATION_PREFERENCES_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of NOTIFICATION_PREFERENCES_COLUMNS) {
    try { sqlite.prepare(sql).run() } catch (_) { /* column already exists */ }
  }
  for (const sql of USER_SETTINGS_COLUMNS) {
    try { sqlite.prepare(sql).run() } catch (_) { /* column already exists */ }
  }
  return drizzleSqlite(sqlite, { schema: schemaSqlite })
}

// Export the schema that matches the current driver so routers use the correct tables
const schema = usePostgres() ? schemaPg : schemaSqlite

export const people = schema.people
export const projects = schema.projects
export const MEETING_CATEGORIES = schemaPg.MEETING_CATEGORIES
export const meetings = schema.meetings
export const meetingPeople = schema.meetingPeople
export const tasks = schema.tasks
export const taskPeople = schema.taskPeople
export const financeTrades = schema.financeTrades
export const financeTransactions = schema.financeTransactions
export const feedSources = schema.feedSources
export const feedItems = schema.feedItems
export const facts = schema.facts
export const chatMessages = schema.chatMessages
export const agentThreads = schema.agentThreads
export const agentMessages = schema.agentMessages
export const agentTriggers = schema.agentTriggers
export const healthMetrics = schema.healthMetrics
export const vatEntries = schema.vatEntries
export const pushSubscriptions = schema.pushSubscriptions
export const expoPushTokens = schema.expoPushTokens
export const notifications = schema.notifications
export const whatsappLabels = schema.whatsappLabels
export const whatsappGroups = schema.whatsappGroups
export const notificationPreferences = schema.notificationPreferences
export const hugoInstructions = schema.hugoInstructions
export const memories = schema.memories
export const userSettings = schema.userSettings

// Re-export MEETING_CATEGORIES from pg (same value) and types from schema (sqlite has the type exports)
export type MeetingCategory = typeof schemaPg.MEETING_CATEGORIES[number]
export type Fact = typeof schemaPg.facts.$inferSelect
export type NewFact = typeof schemaPg.facts.$inferInsert
export type ChatMessage = typeof schemaPg.chatMessages.$inferSelect
export type NewChatMessage = typeof schemaPg.chatMessages.$inferInsert
export type AgentThread = typeof schemaPg.agentThreads.$inferSelect
export type NewAgentThread = typeof schemaPg.agentThreads.$inferInsert
export type AgentMessage = typeof schemaPg.agentMessages.$inferSelect
export type NewAgentMessage = typeof schemaPg.agentMessages.$inferInsert
export type AgentTrigger = typeof schemaPg.agentTriggers.$inferSelect
export type NewAgentTrigger = typeof schemaPg.agentTriggers.$inferInsert
export type HealthMetric = typeof schemaPg.healthMetrics.$inferSelect
export type NewHealthMetric = typeof schemaPg.healthMetrics.$inferInsert
export type PushSubscription = typeof schemaPg.pushSubscriptions.$inferSelect
export type NewPushSubscription = typeof schemaPg.pushSubscriptions.$inferInsert
export type Person = typeof schemaPg.people.$inferSelect
export type NewPerson = typeof schemaPg.people.$inferInsert
export type Project = typeof schemaPg.projects.$inferSelect
export type NewProject = typeof schemaPg.projects.$inferInsert
export type Meeting = typeof schemaPg.meetings.$inferSelect
export type NewMeeting = typeof schemaPg.meetings.$inferInsert
export type Task = typeof schemaPg.tasks.$inferSelect
export type NewTask = typeof schemaPg.tasks.$inferInsert
export type FinanceTrade = typeof schemaPg.financeTrades.$inferSelect
export type NewFinanceTrade = typeof schemaPg.financeTrades.$inferInsert
export type FinanceTransaction = typeof schemaPg.financeTransactions.$inferSelect
export type NewFinanceTransaction = typeof schemaPg.financeTransactions.$inferInsert
export type FeedSource = typeof schemaPg.feedSources.$inferSelect
export type NewFeedSource = typeof schemaPg.feedSources.$inferInsert
export type FeedItem = typeof schemaPg.feedItems.$inferSelect
export type NewFeedItem = typeof schemaPg.feedItems.$inferInsert
export type VatEntry = typeof schemaPg.vatEntries.$inferSelect
export type NewVatEntry = typeof schemaPg.vatEntries.$inferInsert
export type WhatsappLabel = typeof schemaPg.whatsappLabels.$inferSelect
export type NewWhatsappLabel = typeof schemaPg.whatsappLabels.$inferInsert
export type WhatsappGroup = typeof schemaPg.whatsappGroups.$inferSelect
export type NewWhatsappGroup = typeof schemaPg.whatsappGroups.$inferInsert
export type NotificationPreference = typeof schemaPg.notificationPreferences.$inferSelect
export type NewNotificationPreference = typeof schemaPg.notificationPreferences.$inferInsert
export type HugoInstruction = typeof schemaPg.hugoInstructions.$inferSelect
export type NewHugoInstruction = typeof schemaPg.hugoInstructions.$inferInsert
export type Memory = typeof schemaPg.memories.$inferSelect
export type NewMemory = typeof schemaPg.memories.$inferInsert
export { MEMORY_KINDS, MEMORY_SOURCES } from './schema'
export type { MemoryKind, MemorySource } from './schema'

/** Normalize select result to array (works with both SQLite .all() and Postgres Promise) */
export async function queryRows<T>(q: Promise<T[]> | { all(): T[] }): Promise<T[]> {
  if (q != null && typeof (q as Promise<T[]>).then === 'function') return q as Promise<T[]>
  if (q != null && typeof (q as { all(): T[] }).all === 'function') return Promise.resolve((q as { all(): T[] }).all())
  return []
}

/** Run a mutation (update/insert/delete) for both SQLite .run() and Postgres Promise */
export async function runMutation(q: Promise<unknown> | { run(): void }): Promise<void> {
  if (q != null && typeof (q as Promise<unknown>).then === 'function') {
    await (q as Promise<unknown>)
  } else if (q != null && typeof (q as { run(): void }).run === 'function') {
    ;(q as { run(): void }).run()
  }
}

export { desc, lt, sql, eq, and, or, like, asc, isNull } from 'drizzle-orm'

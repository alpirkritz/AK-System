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
  'ALTER TABLE meetings ADD COLUMN series_id TEXT',
  'ALTER TABLE meetings ADD COLUMN type_id TEXT',
]

const MEETING_STRUCTURE_TABLES = [
  `CREATE TABLE IF NOT EXISTS meeting_series (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    cadence TEXT,
    recurrence_day TEXT,
    rolling_notes TEXT,
    google_recurring_event_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_meeting_series_google_recurring_event_id ON meeting_series(google_recurring_event_id)`,
  `CREATE TABLE IF NOT EXISTS meeting_types (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#8b5cf6',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_meetings_series_id ON meetings(series_id)`,
  `CREATE INDEX IF NOT EXISTS idx_meetings_type_id ON meetings(type_id)`,
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
  "ALTER TABLE people ADD COLUMN status TEXT NOT NULL DEFAULT 'confirmed'",
  "ALTER TABLE people ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'",
  'ALTER TABLE people ADD COLUMN notion_page_id TEXT',
  'ALTER TABLE people ADD COLUMN company_id TEXT',
  'CREATE INDEX IF NOT EXISTS idx_people_status ON people(status)',
  'CREATE INDEX IF NOT EXISTS idx_people_notion_page_id ON people(notion_page_id)',
  'CREATE INDEX IF NOT EXISTS idx_people_company_id ON people(company_id)',
]

const TASKS_COLUMNS = [
  "ALTER TABLE tasks ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'",
  'ALTER TABLE tasks ADD COLUMN notion_page_id TEXT',
  'ALTER TABLE tasks ADD COLUMN notion_account TEXT',
  'ALTER TABLE tasks ADD COLUMN notion_db TEXT',
  'ALTER TABLE tasks ADD COLUMN workspace_id TEXT',
  "ALTER TABLE tasks ADD COLUMN status TEXT NOT NULL DEFAULT 'not_started'",
  'ALTER TABLE tasks ADD COLUMN notion_status_raw TEXT',
  // Backfill status from the existing boolean for rows created before this column.
  // Idempotent: only touches rows still at the default that are already marked done.
  "UPDATE tasks SET status = 'done' WHERE done = 1 AND status = 'not_started'",
  'CREATE INDEX IF NOT EXISTS idx_tasks_notion_page_id ON tasks(notion_page_id)',
  'CREATE INDEX IF NOT EXISTS idx_tasks_workspace_id ON tasks(workspace_id)',
]

const WORKSPACE_NOTION_DATABASES_TABLE = [
  `CREATE TABLE IF NOT EXISTS workspace_notion_databases (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    notion_database_id TEXT NOT NULL,
    notion_database_name TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_workspace_notion_databases_workspace_id ON workspace_notion_databases(workspace_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_workspace_notion_databases_notion_database_id ON workspace_notion_databases(notion_database_id)`,
]

const NOTION_STATUS_OVERRIDES_TABLE = [
  `CREATE TABLE IF NOT EXISTS notion_status_overrides (
    id TEXT PRIMARY KEY,
    raw_label TEXT NOT NULL,
    canonical_status TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_notion_status_overrides_raw_label ON notion_status_overrides(raw_label)`,
]

const WORKSPACES_TABLE = [
  `CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT DEFAULT '#2dd4bf',
    notion_account_label TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
]

/** Seeded once with stable ids so re-running the bootstrap never duplicates them. */
const DEFAULT_WORKSPACES = [
  { id: 'ws_alpir_consulting', name: 'Alpir Consulting', color: '#2dd4bf' },
  { id: 'ws_dragontail', name: 'Dragontail', color: '#fb7185' },
  { id: 'ws_daz', name: 'DAZ', color: '#38bdf8' },
  { id: 'ws_personal', name: 'פרטי', color: '#b847e8' },
]

const WORKSPACES_SEED = DEFAULT_WORKSPACES.map(
  (w) =>
    `INSERT OR IGNORE INTO workspaces (id, name, color, notion_account_label, created_at, updated_at)
     VALUES ('${w.id}', '${w.name}', '${w.color}', NULL,
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`,
)

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

const READING_LIST_TABLE = [
  `CREATE TABLE IF NOT EXISTS reading_list_items (
    id TEXT PRIMARY KEY,
    url TEXT NOT NULL,
    title TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'unread',
    created_at TEXT NOT NULL,
    read_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reading_list_items_status ON reading_list_items(status)`,
  `CREATE INDEX IF NOT EXISTS idx_reading_list_items_created_at ON reading_list_items(created_at)`,
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

const FINANCE_TRANSACTIONS_COLUMNS = [
  'ALTER TABLE finance_transactions ADD COLUMN bank_account_id TEXT',
  'ALTER TABLE finance_transactions ADD COLUMN dedupe_key TEXT',
  'ALTER TABLE finance_transactions ADD COLUMN installment_info TEXT',
  'ALTER TABLE finance_transactions ADD COLUMN txn_status TEXT',
  'CREATE INDEX IF NOT EXISTS idx_finance_transactions_bank_account_id ON finance_transactions(bank_account_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_finance_transactions_dedupe_key ON finance_transactions(dedupe_key)',
]

const FINANCE_CATEGORY_RULES_TABLE = [
  `CREATE TABLE IF NOT EXISTS finance_category_rules (
    id TEXT PRIMARY KEY,
    pattern TEXT NOT NULL,
    category TEXT NOT NULL,
    direction TEXT,
    created_by TEXT NOT NULL DEFAULT 'user',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_finance_category_rules_pattern ON finance_category_rules(pattern)`,
]

const BANK_TABLES = [
  `CREATE TABLE IF NOT EXISTS bank_connections (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    display_name TEXT NOT NULL,
    credentials_encrypted TEXT NOT NULL,
    credentials_iv TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    last_sync_at TEXT,
    last_error TEXT,
    last_error_type TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bank_connections_provider ON bank_connections(provider)`,
  `CREATE TABLE IF NOT EXISTS bank_accounts (
    id TEXT PRIMARY KEY,
    connection_id TEXT NOT NULL REFERENCES bank_connections(id) ON DELETE CASCADE,
    account_number TEXT NOT NULL,
    account_type TEXT NOT NULL,
    balance TEXT,
    balance_currency TEXT NOT NULL DEFAULT 'ILS',
    balance_updated_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bank_accounts_connection_id ON bank_accounts(connection_id)`,
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

const PUSH_DELIVERY_LOG_TABLE = [
  `CREATE TABLE IF NOT EXISTS push_delivery_log (
    id TEXT PRIMARY KEY,
    ticket_id TEXT,
    token TEXT NOT NULL,
    status TEXT NOT NULL,
    error_code TEXT,
    message TEXT,
    sent_at TEXT NOT NULL,
    checked_at TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_push_delivery_log_status ON push_delivery_log(status, sent_at)`,
]

const NOTIFICATIONS_TABLE = [
  `CREATE TABLE IF NOT EXISTS notifications (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    url TEXT NOT NULL,
    type TEXT NOT NULL,
    read_at TEXT,
    archived_at TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications(read_at, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_notifications_inbox ON notifications(archived_at, created_at)`,
]

const NOTIFICATIONS_COLUMNS = [
  'ALTER TABLE notifications ADD COLUMN archived_at TEXT',
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
    priority INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id TEXT PRIMARY KEY,
    group_jid TEXT NOT NULL,
    wa_message_id TEXT NOT NULL,
    sender TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    text TEXT NOT NULL,
    ts INTEGER NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_group_ts ON whatsapp_messages(group_jid, ts)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_messages_group_msg ON whatsapp_messages(group_jid, wa_message_id)`,
]

const WHATSAPP_GROUPS_COLUMNS = [
  'ALTER TABLE whatsapp_groups ADD COLUMN priority INTEGER NOT NULL DEFAULT 0',
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
  'ALTER TABLE user_settings ADD COLUMN business_profile TEXT',
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

const VAT_ENTRIES_COLUMNS = [
  'ALTER TABLE vat_entries ADD COLUMN sales_document_id TEXT',
  'CREATE INDEX IF NOT EXISTS idx_vat_entries_sales_document_id ON vat_entries(sales_document_id)',
]

const SALES_DOCUMENTS_TABLES = [
  `CREATE TABLE IF NOT EXISTS companies (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_en TEXT,
    tax_id TEXT,
    tax_id_type TEXT NOT NULL DEFAULT 'company',
    address TEXT,
    city TEXT,
    zip_code TEXT,
    country TEXT NOT NULL DEFAULT 'IL',
    preferred_language TEXT NOT NULL DEFAULT 'he',
    phone TEXT,
    email TEXT,
    website TEXT,
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_companies_name ON companies(name)`,
  `CREATE INDEX IF NOT EXISTS idx_companies_tax_id ON companies(tax_id)`,
  `CREATE TABLE IF NOT EXISTS service_items (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    name_en TEXT,
    description TEXT,
    unit TEXT NOT NULL DEFAULT 'item',
    default_unit_price TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'ILS',
    vat_applicable INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_service_items_name ON service_items(name)`,
  `CREATE INDEX IF NOT EXISTS idx_service_items_is_active ON service_items(is_active)`,
  `CREATE TABLE IF NOT EXISTS company_item_prices (
    id TEXT PRIMARY KEY,
    company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    service_item_id TEXT NOT NULL REFERENCES service_items(id) ON DELETE CASCADE,
    unit_price TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'ILS',
    note TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_company_item_prices_pair ON company_item_prices(company_id, service_item_id)`,
  `CREATE TABLE IF NOT EXISTS sales_documents (
    id TEXT PRIMARY KEY,
    doc_type TEXT NOT NULL,
    doc_number INTEGER,
    number_prefix TEXT,
    status TEXT NOT NULL DEFAULT 'draft',
    language TEXT NOT NULL DEFAULT 'he',
    issue_date TEXT NOT NULL,
    due_date TEXT,
    valid_until TEXT,
    company_id TEXT REFERENCES companies(id) ON DELETE SET NULL,
    person_id TEXT REFERENCES people(id) ON DELETE SET NULL,
    client_name TEXT,
    client_tax_id TEXT,
    client_address TEXT,
    client_country TEXT,
    client_email TEXT,
    client_phone TEXT,
    issuer_json TEXT,
    currency TEXT NOT NULL DEFAULT 'ILS',
    exchange_rate TEXT,
    total_ils TEXT NOT NULL DEFAULT '0',
    vat_mode TEXT NOT NULL DEFAULT 'standard',
    vat_rate TEXT NOT NULL DEFAULT '0.18',
    subtotal TEXT NOT NULL DEFAULT '0',
    vat_amount TEXT NOT NULL DEFAULT '0',
    total TEXT NOT NULL DEFAULT '0',
    notes TEXT,
    internal_notes TEXT,
    allocation_number TEXT,
    related_document_id TEXT,
    credited_by_document_id TEXT,
    vat_entry_id TEXT,
    issued_at TEXT,
    cancelled_at TEXT,
    cancel_reason TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sales_documents_doc_type ON sales_documents(doc_type)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_documents_status ON sales_documents(status)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_documents_issue_date ON sales_documents(issue_date)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_documents_company_id ON sales_documents(company_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_documents_related_document_id ON sales_documents(related_document_id)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS uq_sales_documents_type_number ON sales_documents(doc_type, doc_number)`,
  `CREATE TABLE IF NOT EXISTS sales_document_lines (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES sales_documents(id) ON DELETE CASCADE,
    service_item_id TEXT REFERENCES service_items(id) ON DELETE SET NULL,
    price_source TEXT NOT NULL DEFAULT 'manual',
    position INTEGER NOT NULL DEFAULT 0,
    description TEXT NOT NULL,
    quantity TEXT NOT NULL DEFAULT '1',
    unit_price TEXT NOT NULL DEFAULT '0',
    discount_percent TEXT,
    vat_applicable INTEGER NOT NULL DEFAULT 1,
    line_total TEXT NOT NULL DEFAULT '0',
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sales_document_lines_document_id ON sales_document_lines(document_id)`,
  `CREATE INDEX IF NOT EXISTS idx_sales_document_lines_service_item_id ON sales_document_lines(service_item_id)`,
  `CREATE TABLE IF NOT EXISTS sales_document_payments (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL REFERENCES sales_documents(id) ON DELETE CASCADE,
    method TEXT NOT NULL DEFAULT 'bank_transfer',
    amount TEXT NOT NULL,
    paid_date TEXT NOT NULL,
    reference TEXT,
    bank_details TEXT,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_sales_document_payments_document_id ON sales_document_payments(document_id)`,
  `CREATE TABLE IF NOT EXISTS sales_document_counters (
    id TEXT PRIMARY KEY,
    doc_type TEXT NOT NULL,
    last_number INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  )`,
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
  for (const sql of WORKSPACES_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of WORKSPACES_SEED) {
    try { sqlite.prepare(sql).run() } catch (_) { /* already seeded */ }
  }
  for (const sql of TASKS_COLUMNS) {
    try { sqlite.prepare(sql).run() } catch (_) { /* column already exists */ }
  }
  for (const sql of WORKSPACE_NOTION_DATABASES_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of NOTION_STATUS_OVERRIDES_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of FEED_TABLES) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of READING_LIST_TABLE) {
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
  for (const sql of FINANCE_TRANSACTIONS_COLUMNS) {
    try { sqlite.prepare(sql).run() } catch (_) { /* column already exists */ }
  }
  for (const sql of BANK_TABLES) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of FINANCE_CATEGORY_RULES_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of PUSH_SUBSCRIPTIONS_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of EXPO_PUSH_TOKENS_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of PUSH_DELIVERY_LOG_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of NOTIFICATIONS_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of NOTIFICATIONS_COLUMNS) {
    try { sqlite.prepare(sql).run() } catch (_) { /* column already exists */ }
  }
  for (const sql of TASK_PEOPLE_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of MEETING_STRUCTURE_TABLES) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of VAT_ENTRIES_TABLE) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of VAT_ENTRIES_COLUMNS) {
    try { sqlite.prepare(sql).run() } catch (_) { /* column already exists */ }
  }
  for (const sql of SALES_DOCUMENTS_TABLES) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of WHATSAPP_TABLES) {
    try { sqlite.prepare(sql).run() } catch (_) { /* ignore */ }
  }
  for (const sql of WHATSAPP_GROUPS_COLUMNS) {
    try { sqlite.prepare(sql).run() } catch (_) { /* column already exists */ }
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
export const workspaces = schema.workspaces
export const workspaceNotionDatabases = schema.workspaceNotionDatabases
export const notionStatusOverrides = schema.notionStatusOverrides
export const MEETING_CATEGORIES = schemaPg.MEETING_CATEGORIES
export const PEOPLE_STATUSES = schemaPg.PEOPLE_STATUSES
export const PEOPLE_SOURCES = schemaPg.PEOPLE_SOURCES
export const TASK_SOURCES = schemaPg.TASK_SOURCES
export const meetings = schema.meetings
export const meetingSeries = schema.meetingSeries
export const meetingTypes = schema.meetingTypes
export const meetingPeople = schema.meetingPeople
export const tasks = schema.tasks
export const taskPeople = schema.taskPeople
export const financeTrades = schema.financeTrades
export const financeTransactions = schema.financeTransactions
export const bankConnections = schema.bankConnections
export const bankAccounts = schema.bankAccounts
export const financeCategoryRules = schema.financeCategoryRules
export const feedSources = schema.feedSources
export const feedItems = schema.feedItems
export const readingListItems = schema.readingListItems
export const facts = schema.facts
export const chatMessages = schema.chatMessages
export const agentThreads = schema.agentThreads
export const agentMessages = schema.agentMessages
export const agentTriggers = schema.agentTriggers
export const healthMetrics = schema.healthMetrics
export const vatEntries = schema.vatEntries
export const pushSubscriptions = schema.pushSubscriptions
export const expoPushTokens = schema.expoPushTokens
export const pushDeliveryLog = schema.pushDeliveryLog
export const notifications = schema.notifications
export const whatsappLabels = schema.whatsappLabels
export const whatsappGroups = schema.whatsappGroups
export const whatsappMessages = schema.whatsappMessages
export const notificationPreferences = schema.notificationPreferences
export const hugoInstructions = schema.hugoInstructions
export const memories = schema.memories
export const userSettings = schema.userSettings
export const companies = schema.companies
export const serviceItems = schema.serviceItems
export const companyItemPrices = schema.companyItemPrices
export const salesDocuments = schema.salesDocuments
export const salesDocumentLines = schema.salesDocumentLines
export const salesDocumentPayments = schema.salesDocumentPayments
export const salesDocumentCounters = schema.salesDocumentCounters

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
export type Workspace = typeof schemaPg.workspaces.$inferSelect
export type NewWorkspace = typeof schemaPg.workspaces.$inferInsert
export type WorkspaceNotionDatabase = typeof schemaPg.workspaceNotionDatabases.$inferSelect
export type NewWorkspaceNotionDatabase = typeof schemaPg.workspaceNotionDatabases.$inferInsert
export type NotionStatusOverride = typeof schemaPg.notionStatusOverrides.$inferSelect
export type NewNotionStatusOverride = typeof schemaPg.notionStatusOverrides.$inferInsert
export const TASK_STATUSES = schemaPg.TASK_STATUSES
export type TaskStatusValue = (typeof schemaPg.TASK_STATUSES)[number]
export type Meeting = typeof schemaPg.meetings.$inferSelect
export type NewMeeting = typeof schemaPg.meetings.$inferInsert
export type MeetingSeries = typeof schemaPg.meetingSeries.$inferSelect
export type NewMeetingSeries = typeof schemaPg.meetingSeries.$inferInsert
export type MeetingType = typeof schemaPg.meetingTypes.$inferSelect
export type NewMeetingType = typeof schemaPg.meetingTypes.$inferInsert
export type PersonStatus = (typeof schemaPg.PEOPLE_STATUSES)[number]
export type PersonSource = (typeof schemaPg.PEOPLE_SOURCES)[number]
export type TaskSource = (typeof schemaPg.TASK_SOURCES)[number]
export type Task = typeof schemaPg.tasks.$inferSelect
export type NewTask = typeof schemaPg.tasks.$inferInsert
export type FinanceTrade = typeof schemaPg.financeTrades.$inferSelect
export type NewFinanceTrade = typeof schemaPg.financeTrades.$inferInsert
export type FinanceTransaction = typeof schemaPg.financeTransactions.$inferSelect
export type NewFinanceTransaction = typeof schemaPg.financeTransactions.$inferInsert
export type BankConnection = typeof schemaPg.bankConnections.$inferSelect
export type NewBankConnection = typeof schemaPg.bankConnections.$inferInsert
export type BankAccount = typeof schemaPg.bankAccounts.$inferSelect
export type NewBankAccount = typeof schemaPg.bankAccounts.$inferInsert
export type FinanceCategoryRule = typeof schemaPg.financeCategoryRules.$inferSelect
export type NewFinanceCategoryRule = typeof schemaPg.financeCategoryRules.$inferInsert
export const BANK_PROVIDERS = schemaPg.BANK_PROVIDERS
export const BANK_CONNECTION_STATUSES = schemaPg.BANK_CONNECTION_STATUSES
export type { BankProvider, BankConnectionStatus } from './schema.pg'
export type FeedSource = typeof schemaPg.feedSources.$inferSelect
export type NewFeedSource = typeof schemaPg.feedSources.$inferInsert
export type FeedItem = typeof schemaPg.feedItems.$inferSelect
export type NewFeedItem = typeof schemaPg.feedItems.$inferInsert
export type ReadingListItem = typeof schemaPg.readingListItems.$inferSelect
export type NewReadingListItem = typeof schemaPg.readingListItems.$inferInsert
export type VatEntry = typeof schemaPg.vatEntries.$inferSelect
export type NewVatEntry = typeof schemaPg.vatEntries.$inferInsert
export type Company = typeof schemaPg.companies.$inferSelect
export type NewCompany = typeof schemaPg.companies.$inferInsert
export type ServiceItem = typeof schemaPg.serviceItems.$inferSelect
export type NewServiceItem = typeof schemaPg.serviceItems.$inferInsert
export type CompanyItemPrice = typeof schemaPg.companyItemPrices.$inferSelect
export type NewCompanyItemPrice = typeof schemaPg.companyItemPrices.$inferInsert
export type SalesDocument = typeof schemaPg.salesDocuments.$inferSelect
export type NewSalesDocument = typeof schemaPg.salesDocuments.$inferInsert
export type SalesDocumentLine = typeof schemaPg.salesDocumentLines.$inferSelect
export type NewSalesDocumentLine = typeof schemaPg.salesDocumentLines.$inferInsert
export type SalesDocumentPayment = typeof schemaPg.salesDocumentPayments.$inferSelect
export type NewSalesDocumentPayment = typeof schemaPg.salesDocumentPayments.$inferInsert
export type SalesDocumentCounter = typeof schemaPg.salesDocumentCounters.$inferSelect
export type NewSalesDocumentCounter = typeof schemaPg.salesDocumentCounters.$inferInsert
export type WhatsappLabel = typeof schemaPg.whatsappLabels.$inferSelect
export type NewWhatsappLabel = typeof schemaPg.whatsappLabels.$inferInsert
export type WhatsappGroup = typeof schemaPg.whatsappGroups.$inferSelect
export type NewWhatsappGroup = typeof schemaPg.whatsappGroups.$inferInsert
export type WhatsappMessage = typeof schemaPg.whatsappMessages.$inferSelect
export type NewWhatsappMessage = typeof schemaPg.whatsappMessages.$inferInsert
export type NotificationPreference = typeof schemaPg.notificationPreferences.$inferSelect
export type NewNotificationPreference = typeof schemaPg.notificationPreferences.$inferInsert
export type HugoInstruction = typeof schemaPg.hugoInstructions.$inferSelect
export type NewHugoInstruction = typeof schemaPg.hugoInstructions.$inferInsert
export type Memory = typeof schemaPg.memories.$inferSelect
export type NewMemory = typeof schemaPg.memories.$inferInsert
export { MEMORY_KINDS, MEMORY_SOURCES, READING_LIST_STATUSES } from './schema'
export type { MemoryKind, MemorySource, ReadingListStatus } from './schema'

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

export { desc, lt, lte, gt, gte, sql, eq, and, or, like, asc, isNull, inArray } from 'drizzle-orm'

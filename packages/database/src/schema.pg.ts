import { pgTable, text, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core'

/** CRM review status — unconfirmed people (e.g. unknown calendar attendees) stay out of the main list */
export const PEOPLE_STATUSES = ['confirmed', 'unconfirmed', 'ignored'] as const
export type PersonStatus = (typeof PEOPLE_STATUSES)[number]

/** Where a person record originated */
export const PEOPLE_SOURCES = ['manual', 'calendar', 'notion'] as const
export type PersonSource = (typeof PEOPLE_SOURCES)[number]

/** Where a task record originated */
export const TASK_SOURCES = ['manual', 'notion'] as const
export type TaskSource = (typeof TASK_SOURCES)[number]

/** Where a project record originated */
export const PROJECT_SOURCES = ['manual', 'notion'] as const
export type ProjectSource = (typeof PROJECT_SOURCES)[number]

/** External identity providers for a canonical person row */
export const PERSON_EXTERNAL_PROVIDERS = ['notion', 'google_contact', 'slack', 'email'] as const
export type PersonExternalProvider = (typeof PERSON_EXTERNAL_PROVIDERS)[number]

/** Billing-grade client entity — `people.company` stays as legacy free text */
export const companies = pgTable('companies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nameEn: text('name_en'),
  taxId: text('tax_id'),
  taxIdType: text('tax_id_type').notNull().default('company'),
  address: text('address'),
  city: text('city'),
  zipCode: text('zip_code'),
  country: text('country').notNull().default('IL'),
  preferredLanguage: text('preferred_language').notNull().default('he'),
  phone: text('phone'),
  email: text('email'),
  website: text('website'),
  notes: text('notes'),
  notionPageId: text('notion_page_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  nameIdx: index('idx_companies_name').on(table.name),
  taxIdIdx: index('idx_companies_tax_id').on(table.taxId),
  notionPageIdIdx: index('idx_companies_notion_page_id').on(table.notionPageId),
}))

export const people = pgTable('people', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role'),
  email: text('email'),
  color: text('color').default('#e8c547'),
  phone: text('phone'),
  company: text('company'),
  companyId: text('company_id').references(() => companies.id, { onDelete: 'set null' }),
  jobTitle: text('job_title'),
  linkedin: text('linkedin'),
  tags: text('tags'),
  expertIn: text('expert_in'),
  lastContact: text('last_contact'),
  goal: text('goal'),
  contactFrequencyDays: integer('contact_frequency_days'),
  notes: text('notes'),
  status: text('status').notNull().default('confirmed'),
  source: text('source').notNull().default('manual'),
  notionPageId: text('notion_page_id'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  emailIdx: index('idx_people_email').on(table.email),
  statusIdx: index('idx_people_status').on(table.status),
  notionPageIdIdx: index('idx_people_notion_page_id').on(table.notionPageId),
  companyIdIdx: index('idx_people_company_id').on(table.companyId),
}))

/** Multi-source identity links for a canonical person (many Notion people DBs, Google, Slack, email). */
export const personExternalIds = pgTable('person_external_ids', {
  id: text('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(),
  accountKey: text('account_key').notNull(),
  externalId: text('external_id').notNull(),
  displayName: text('display_name'),
  raw: text('raw'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  personIdIdx: index('idx_person_external_ids_person_id').on(table.personId),
  providerExternalUq: uniqueIndex('uq_person_external_ids_provider_account_external').on(
    table.provider,
    table.accountKey,
    table.externalId,
  ),
}))

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').default('#47b8e8'),
  notionPageId: text('notion_page_id'),
  companyId: text('company_id').references(() => companies.id, { onDelete: 'set null' }),
  source: text('source').notNull().default('manual'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  notionPageIdIdx: index('idx_projects_notion_page_id').on(table.notionPageId),
  companyIdIdx: index('idx_projects_company_id').on(table.companyId),
}))

export const projectPeople = pgTable('project_people', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
}, (table) => ({
  projectIdIdx: index('idx_project_people_project_id').on(table.projectId),
  personIdIdx: index('idx_project_people_person_id').on(table.personId),
  pairUq: uniqueIndex('uq_project_people_pair').on(table.projectId, table.personId),
}))

/** Top-level task origin (Alpir Consulting / Dragontail / DAZ / personal) — orthogonal to projects */
export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').default('#2dd4bf'),
  notionAccountLabel: text('notion_account_label'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/** Explicit workspace ↔ Notion database (by id) links — preferred over the free-text label match */
export const workspaceNotionDatabases = pgTable('workspace_notion_databases', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  notionDatabaseId: text('notion_database_id').notNull(),
  notionDatabaseName: text('notion_database_name'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  workspaceIdIdx: index('idx_workspace_notion_databases_workspace_id').on(table.workspaceId),
  notionDatabaseIdUq: uniqueIndex('uq_workspace_notion_databases_notion_database_id').on(table.notionDatabaseId),
}))

/** Canonical task status values (Notion-faithful) — orthogonal to the derived `done` boolean */
export const TASK_STATUSES = ['not_started', 'pending', 'in_progress', 'blocked', 'done', 'cancelled'] as const
export type TaskStatusValue = (typeof TASK_STATUSES)[number]

/** User-editable mapping from a literal Notion status/select label to a canonical status */
export const notionStatusOverrides = pgTable('notion_status_overrides', {
  id: text('id').primaryKey(),
  rawLabel: text('raw_label').notNull(),
  canonicalStatus: text('canonical_status').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  rawLabelUq: uniqueIndex('uq_notion_status_overrides_raw_label').on(table.rawLabel),
}))

/** Meeting category for daily summary (Work/Family/General) */
export const MEETING_CATEGORIES = ['work', 'family', 'general'] as const
export type MeetingCategory = (typeof MEETING_CATEGORIES)[number]

/** Recurring meetings sharing a cadence are grouped under one series */
export const meetingSeries = pgTable('meeting_series', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  cadence: text('cadence'),
  recurrenceDay: text('recurrence_day'),
  rollingNotes: text('rolling_notes'),
  googleRecurringEventId: text('google_recurring_event_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  googleRecurringEventIdIdx: index('idx_meeting_series_google_recurring_event_id').on(table.googleRecurringEventId),
}))

/** User-managed meeting types (1:1, strategy, operations, ...) — mirrors projects */
export const meetingTypes = pgTable('meeting_types', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').default('#8b5cf6'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const meetings = pgTable('meetings', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  date: text('date').notNull(),
  time: text('time').notNull().default('09:00'),
  endTime: text('end_time'),
  recurring: text('recurring'),
  recurrenceDay: text('recurrence_day'),
  notes: text('notes'),
  location: text('location'),
  category: text('category'),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  seriesId: text('series_id').references(() => meetingSeries.id, { onDelete: 'set null' }),
  typeId: text('type_id').references(() => meetingTypes.id, { onDelete: 'set null' }),
  calendarEventId: text('calendar_event_id'),
  calendarSource: text('calendar_source'),
  /** Notion Meetings page id when synced from a Notion meetings database */
  notionPageId: text('notion_page_id'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  dateIdx: index('idx_meetings_date').on(table.date),
  projectIdIdx: index('idx_meetings_project_id').on(table.projectId),
  seriesIdIdx: index('idx_meetings_series_id').on(table.seriesId),
  typeIdIdx: index('idx_meetings_type_id').on(table.typeId),
  calendarEventIdIdx: index('idx_meetings_calendar_event_id').on(table.calendarEventId),
  notionPageIdIdx: index('idx_meetings_notion_page_id').on(table.notionPageId),
}))

export const meetingPeople = pgTable('meeting_people', {
  meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
}, (table) => ({
  meetingIdIdx: index('idx_meeting_people_meeting_id').on(table.meetingId),
  personIdIdx: index('idx_meeting_people_person_id').on(table.personId),
}))

/** Notion AI meeting notes (and similar) persisted for CRM / project context. */
export const meetingNotes = pgTable('meeting_notes', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  date: text('date'),
  snippet: text('snippet'),
  /** Flattened Notion page body (plain text), capped at 8000 chars on write. */
  bodyText: text('body_text'),
  /** ISO timestamp of last successful block pull. */
  bodySyncedAt: text('body_synced_at'),
  /** Notion page last_edited_time at last body sync. */
  notionLastEditedAt: text('notion_last_edited_at'),
  notionUrl: text('notion_url'),
  notionPageId: text('notion_page_id'),
  meetingId: text('meeting_id').references(() => meetings.id, { onDelete: 'set null' }),
  notionAccount: text('notion_account'),
  notionDb: text('notion_db'),
  source: text('source').notNull().default('notion'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  notionPageIdIdx: index('idx_meeting_notes_notion_page_id').on(table.notionPageId),
  meetingIdIdx: index('idx_meeting_notes_meeting_id').on(table.meetingId),
  dateIdx: index('idx_meeting_notes_date').on(table.date),
}))

export const meetingNotePeople = pgTable('meeting_note_people', {
  meetingNoteId: text('meeting_note_id').notNull().references(() => meetingNotes.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
}, (table) => ({
  meetingNoteIdIdx: index('idx_meeting_note_people_note_id').on(table.meetingNoteId),
  personIdIdx: index('idx_meeting_note_people_person_id').on(table.personId),
  pairUq: uniqueIndex('uq_meeting_note_people_pair').on(table.meetingNoteId, table.personId),
}))

export const meetingNoteProjects = pgTable('meeting_note_projects', {
  meetingNoteId: text('meeting_note_id').notNull().references(() => meetingNotes.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
}, (table) => ({
  meetingNoteIdIdx: index('idx_meeting_note_projects_note_id').on(table.meetingNoteId),
  projectIdIdx: index('idx_meeting_note_projects_project_id').on(table.projectId),
  pairUq: uniqueIndex('uq_meeting_note_projects_pair').on(table.meetingNoteId, table.projectId),
}))

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  meetingId: text('meeting_id').references(() => meetings.id, { onDelete: 'set null' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  assigneeId: text('assignee_id').references(() => people.id, { onDelete: 'set null' }),
  dueDate: text('due_date'),
  done: boolean('done').notNull().default(false),
  status: text('status').notNull().default('not_started'),
  priority: text('priority').notNull().default('medium'),
  source: text('source').notNull().default('manual'),
  notionPageId: text('notion_page_id'),
  notionAccount: text('notion_account'),
  notionDb: text('notion_db'),
  notionStatusRaw: text('notion_status_raw'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  meetingIdIdx: index('idx_tasks_meeting_id').on(table.meetingId),
  projectIdIdx: index('idx_tasks_project_id').on(table.projectId),
  workspaceIdIdx: index('idx_tasks_workspace_id').on(table.workspaceId),
  assigneeIdIdx: index('idx_tasks_assignee_id').on(table.assigneeId),
  notionPageIdIdx: index('idx_tasks_notion_page_id').on(table.notionPageId),
}))

export const taskPeople = pgTable('task_people', {
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
}, (table) => ({
  taskIdIdx: index('idx_task_people_task_id').on(table.taskId),
  personIdIdx: index('idx_task_people_person_id').on(table.personId),
}))

export const financeTrades = pgTable('finance_trades', {
  id: text('id').primaryKey(),
  symbol: text('symbol').notNull(),
  direction: text('direction').notNull(),
  quantity: text('quantity').notNull(),
  price: text('price').notNull(),
  commission: text('commission'),
  currency: text('currency').notNull().default('USD'),
  tradeDate: text('trade_date').notNull(),
  source: text('source').notNull().default('ibkr_email'),
  rawEmailId: text('raw_email_id'),
  description: text('description'),
  emailSubject: text('email_subject'),
  actionType: text('action_type').notNull().default('trade'),
  account: text('account'),
  sourceDetail: text('source_detail'),
  notionPageId: text('notion_page_id'),
  importedAt: text('imported_at'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  tradeDateIdx: index('idx_finance_trades_trade_date').on(table.tradeDate),
  rawEmailIdIdx: index('idx_finance_trades_raw_email_id').on(table.rawEmailId),
  symbolIdx: index('idx_finance_trades_symbol').on(table.symbol),
  notionPageIdIdx: index('idx_finance_trades_notion_page_id').on(table.notionPageId),
}))

export const financeTransactions = pgTable('finance_transactions', {
  id: text('id').primaryKey(),
  amount: text('amount').notNull(),
  currency: text('currency').notNull().default('ILS'),
  direction: text('direction').notNull(),
  category: text('category'),
  description: text('description'),
  transactionDate: text('transaction_date').notNull(),
  source: text('source').notNull(),
  rawData: text('raw_data'),
  bankAccountId: text('bank_account_id'),
  dedupeKey: text('dedupe_key'),
  installmentInfo: text('installment_info'), // JSON string { number, total } for installment purchases
  txnStatus: text('txn_status'), // 'completed' | 'pending' (from bank scraper)
  createdAt: text('created_at').notNull(),
}, (table) => ({
  transactionDateIdx: index('idx_finance_transactions_date').on(table.transactionDate),
  directionIdx: index('idx_finance_transactions_direction').on(table.direction),
  bankAccountIdIdx: index('idx_finance_transactions_bank_account_id').on(table.bankAccountId),
  dedupeKeyIdx: uniqueIndex('idx_finance_transactions_dedupe_key').on(table.dedupeKey),
}))

// ─── Bank & credit card connections (israeli-bank-scrapers) ────────────────

/** Supported account-aggregation providers (values match israeli-bank-scrapers CompanyTypes) */
export const BANK_PROVIDERS = ['hapoalim', 'otsarHahayal', 'visaCal', 'isracard'] as const
export type BankProvider = (typeof BANK_PROVIDERS)[number]

export const BANK_CONNECTION_STATUSES = [
  'pending',
  'connected',
  'error',
  'disabled',
  'awaiting_otp',
] as const
export type BankConnectionStatus = (typeof BANK_CONNECTION_STATUSES)[number]

export const bankConnections = pgTable('bank_connections', {
  id: text('id').primaryKey(),
  provider: text('provider').notNull(), // BankProvider
  displayName: text('display_name').notNull(),
  credentialsEncrypted: text('credentials_encrypted').notNull(), // base64 AES-256-GCM ciphertext
  credentialsIv: text('credentials_iv').notNull(), // base64 IV
  status: text('status').notNull().default('pending'), // BankConnectionStatus
  lastSyncAt: text('last_sync_at'),
  lastError: text('last_error'),
  lastErrorType: text('last_error_type'), // scraper errorType e.g. INVALID_PASSWORD
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  providerIdx: index('idx_bank_connections_provider').on(table.provider),
}))

export const bankAccounts = pgTable('bank_accounts', {
  id: text('id').primaryKey(),
  connectionId: text('connection_id').notNull().references(() => bankConnections.id, { onDelete: 'cascade' }),
  accountNumber: text('account_number').notNull(),
  accountType: text('account_type').notNull(), // 'bank' | 'credit_card'
  balance: text('balance'),
  balanceCurrency: text('balance_currency').notNull().default('ILS'),
  balanceUpdatedAt: text('balance_updated_at'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  connectionIdIdx: index('idx_bank_accounts_connection_id').on(table.connectionId),
}))

/** Learned categorization rules: a lowercase substring of a description → a cash-flow category. */
export const financeCategoryRules = pgTable('finance_category_rules', {
  id: text('id').primaryKey(),
  pattern: text('pattern').notNull(),
  category: text('category').notNull(),
  direction: text('direction'), // 'income' | 'expense' | null (both)
  createdBy: text('created_by').notNull().default('user'), // 'user' | 'builtin'
  createdAt: text('created_at').notNull(),
}, (table) => ({
  patternIdx: index('idx_finance_category_rules_pattern').on(table.pattern),
}))

/** User-defined cashflow category labels beyond the built-in list in @ak-system/types. */
export const financeCustomCategories = pgTable('finance_custom_categories', {
  id: text('id').primaryKey(),
  label: text('label').notNull(),
  color: text('color').notNull().default('#647399'),
  kind: text('kind').notNull().default('expense'), // 'expense' | 'income'
  createdAt: text('created_at').notNull(),
}, (table) => ({
  labelUq: uniqueIndex('uq_finance_custom_categories_label').on(table.label),
}))

/**
 * Cache of LLM-written finance narratives. Keyed by the facts that produced them, so the
 * same deterministic inputs never pay for a second Gemini call.
 */
export const financeInsightNarratives = pgTable('finance_insight_narratives', {
  id: text('id').primaryKey(),
  scopeKey: text('scope_key').notNull(), // 'cashflow:2026-08' | 'trading:month' | 'overview'
  inputHash: text('input_hash').notNull(), // hash of the facts sent to the model
  model: text('model'),
  content: text('content').notNull(), // JSON { headline, body, connections, watchlist }
  generatedAt: text('generated_at').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  scopeHashUq: uniqueIndex('uq_finance_insight_narratives_scope_hash').on(table.scopeKey, table.inputHash),
}))

export const feedSources = pgTable('feed_sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  category: text('category').notNull(),
  createdAt: text('created_at').notNull(),
})

export const feedItems = pgTable('feed_items', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull().references(() => feedSources.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  link: text('link').notNull(),
  summary: text('summary'),
  publishedAt: text('published_at').notNull(),
  tags: text('tags'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  sourceIdIdx: index('idx_feed_items_source_id').on(table.sourceId),
  linkIdx: uniqueIndex('idx_feed_items_link').on(table.link),
  publishedAtIdx: index('idx_feed_items_published_at').on(table.publishedAt),
}))

export const feedDigests = pgTable('feed_digests', {
  id: text('id').primaryKey(),
  tldr: text('tldr').notNull(),
  watch: text('watch').notNull(),
  itemCount: integer('item_count').notNull(),
  generatedAt: text('generated_at').notNull(),
})

export const readingListItems = pgTable('reading_list_items', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  title: text('title').notNull(),
  note: text('note'),
  status: text('status').notNull().default('unread'),
  createdAt: text('created_at').notNull(),
  readAt: text('read_at'),
}, (table) => ({
  statusIdx: index('idx_reading_list_items_status').on(table.status),
  createdAtIdx: index('idx_reading_list_items_created_at').on(table.createdAt),
}))

export const facts = pgTable('facts', {
  id: text('id').primaryKey(),
  content: text('content').notNull(),
  source: text('source').notNull().default('conversation'),
  createdAt: text('created_at').notNull(),
})

export const chatMessages = pgTable('chat_messages', {
  id: text('id').primaryKey(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  source: text('source').notNull().default('web'),
  createdAt: text('created_at').notNull(),
})

export const agentThreads = pgTable('agent_threads', {
  agentId: text('agent_id').primaryKey(),
  cursorAgentId: text('cursor_agent_id').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const agentMessages = pgTable('agent_messages', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  agentIdIdx: index('idx_agent_messages_agent_id').on(table.agentId),
}))

/**
 * @deprecated Superseded by `agentSchedules`. Retained (data intact) as a rollback
 * target for the dynamic-agent-management migration; nothing reads or writes it.
 */
export const agentTriggers = pgTable('agent_triggers', {
  agentId: text('agent_id').primaryKey(),
  enabled: integer('enabled').notNull().default(0),
  scheduleTimes: text('schedule_times').notNull().default('[]'),
  triggerMessage: text('trigger_message'),
  lastRunAt: text('last_run_at'),
  lastRunStatus: text('last_run_status'),
  lastRunError: text('last_run_error'),
  updatedAt: text('updated_at').notNull(),
})

/**
 * Clock-based agent runs. Event-based runs are routed through
 * notificationPreferences.agentId; both paths stamp lastRunAt so an agent wired
 * to both runs once per slot.
 */
export const agentSchedules = pgTable('agent_schedules', {
  agentId: text('agent_id').primaryKey(),
  enabled: integer('enabled').notNull().default(0),
  scheduleTimes: text('schedule_times').notNull().default('[]'),
  triggerMessage: text('trigger_message'),
  lastRunAt: text('last_run_at'),
  lastRunStatus: text('last_run_status'),
  lastRunError: text('last_run_error'),
  updatedAt: text('updated_at').notNull(),
})

export const healthMetrics = pgTable('health_metrics', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  value: text('value').notNull(),
  at: text('at').notNull(),
  source: text('source').notNull().default('manual'),
  createdAt: text('created_at').notNull(),
})

export const vatEntries = pgTable('vat_entries', {
  id: text('id').primaryKey(),
  year: integer('year').notNull(),
  period: integer('period').notNull(),
  taxCode: text('tax_code').notNull(),
  category: text('category').notNull(),
  entryType: text('entry_type').notNull(),
  date: text('date').notNull(),
  invoiceNumber: text('invoice_number'),
  description: text('description').notNull(),
  amount: text('amount').notNull(),
  isVatExempt: integer('is_vat_exempt').notNull().default(0),
  deductionPercent: text('deduction_percent'),
  dollarRate: text('dollar_rate'),
  invoiceFileUrl: text('invoice_file_url'),
  /** Set when the entry was generated by issuing a sales document — prevents double sync */
  salesDocumentId: text('sales_document_id'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  yearPeriodIdx: index('idx_vat_entries_year_period').on(table.year, table.period),
  dateIdx: index('idx_vat_entries_date').on(table.date),
  taxCodeIdx: index('idx_vat_entries_tax_code').on(table.taxCode),
  salesDocumentIdIdx: index('idx_vat_entries_sales_document_id').on(table.salesDocumentId),
}))

export const pushSubscriptions = pgTable('push_subscriptions', {
  id: text('id').primaryKey(),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  endpointIdx: uniqueIndex('idx_push_subscriptions_endpoint').on(table.endpoint),
}))

export const expoPushTokens = pgTable('expo_push_tokens', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  createdAt: text('created_at').notNull(),
})

/** Direct FCM device tokens for the ARO Android app. */
export const fcmPushTokens = pgTable('fcm_push_tokens', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  platform: text('platform').notNull(), // android
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/**
 * Push delivery log. Historical Expo rows use provider='expo' + ticket_id;
 * new direct-FCM rows use provider='fcm' + provider_message_id and are logged
 * immediately (no delayed receipt polling).
 */
export const pushDeliveryLog = pgTable('push_delivery_log', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id'),
  provider: text('provider').notNull().default('expo'), // expo | fcm
  providerMessageId: text('provider_message_id'),
  token: text('token').notNull(),
  status: text('status').notNull(), // pending | ok | error | expired
  errorCode: text('error_code'),
  message: text('message'),
  sentAt: text('sent_at').notNull(),
  checkedAt: text('checked_at'),
}, (table) => ({
  statusIdx: index('idx_push_delivery_log_status').on(table.status, table.sentAt),
}))

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  url: text('url').notNull(),
  type: text('type').notNull(),
  readAt: text('read_at'),
  archivedAt: text('archived_at'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  unreadIdx: index('idx_notifications_unread').on(table.readAt, table.createdAt),
  inboxIdx: index('idx_notifications_inbox').on(table.archivedAt, table.createdAt),
}))

export const whatsappLabels = pgTable('whatsapp_labels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  summaryTimes: text('summary_times').notNull().default('[]'),
  createdAt: text('created_at').notNull(),
})

export const whatsappGroups = pgTable('whatsapp_groups', {
  id: text('id').primaryKey(),
  jid: text('jid').notNull().unique(),
  name: text('name').notNull(),
  labelId: text('label_id').references(() => whatsappLabels.id, { onDelete: 'set null' }),
  enabled: integer('enabled').notNull().default(0),
  fomoEnabled: integer('fomo_enabled').notNull().default(0),
  fomoThreshold: integer('fomo_threshold').notNull().default(5),
  fomoWindowMinutes: integer('fomo_window_minutes').notNull().default(5),
  summaryTimes: text('summary_times'),
  keywords: text('keywords').notNull().default('[]'),
  lastFomoAlertAt: text('last_fomo_alert_at'),
  priority: integer('priority').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
})

export const whatsappMessages = pgTable('whatsapp_messages', {
  id: text('id').primaryKey(),
  groupJid: text('group_jid').notNull(),
  waMessageId: text('wa_message_id').notNull(),
  sender: text('sender').notNull(),
  senderName: text('sender_name').notNull(),
  text: text('text').notNull(),
  ts: integer('ts').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  groupTsIdx: index('idx_whatsapp_messages_group_ts').on(table.groupJid, table.ts),
  groupMsgUq: uniqueIndex('uq_whatsapp_messages_group_msg').on(table.groupJid, table.waMessageId),
}))

export const hugoInstructions = pgTable('hugo_instructions', {
  id: text('id').primaryKey(),
  content: text('content').notNull().default(''),
  enabled: boolean('enabled').notNull().default(true),
  updatedAt: text('updated_at').notNull(),
})

export const memories = pgTable('memories', {
  id: text('id').primaryKey(),
  content: text('content').notNull(),
  kind: text('kind').notNull().default('memory'),
  source: text('source').notNull().default('manual'),
  pinned: boolean('pinned').notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  kindIdx: index('idx_memories_kind').on(table.kind),
  pinnedIdx: index('idx_memories_pinned').on(table.pinned, table.updatedAt),
}))

export const userSettings = pgTable('user_settings', {
  id: text('id').primaryKey(),
  agentCalendarIds: text('agent_calendar_ids'),
  agentDisplayNames: text('agent_display_names'),
  /** JSON BusinessProfile — issuer details, logo and document numbering */
  businessProfile: text('business_profile'),
  /** One-shot guard for the agent_triggers → agent_schedules migration */
  agentSchedulesMigratedAt: text('agent_schedules_migrated_at'),
  /** JSON DashboardPrefs — meetingWindow / taskWindow for mobile (and future web) */
  dashboardPrefs: text('dashboard_prefs'),
  updatedAt: text('updated_at').notNull(),
})

export const notificationPreferences = pgTable('notification_preferences', {
  typeId: text('type_id').primaryKey(),
  enabled: boolean('enabled').notNull().default(true),
  channelWhatsapp: boolean('channel_whatsapp').notNull().default(true),
  channelPush: boolean('channel_push').notNull().default(true),
  channelTelegram: boolean('channel_telegram').notNull().default(true),
  scheduleTimes: text('schedule_times'),
  lastSentAt: text('last_sent_at'),
  agentId: text('agent_id'),
  triggerMessage: text('trigger_message'),
  updatedAt: text('updated_at').notNull(),
})
// ─── Sales documents (quotes, invoices, receipts) ───────────────────────────

/** Priced catalog of recurring services — suggestions for document lines, never mandatory */
export const serviceItems = pgTable('service_items', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  nameEn: text('name_en'),
  description: text('description'),
  unit: text('unit').notNull().default('item'),
  defaultUnitPrice: text('default_unit_price').notNull(),
  currency: text('currency').notNull().default('ILS'),
  vatApplicable: boolean('vat_applicable').notNull().default(true),
  isActive: boolean('is_active').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  nameIdx: index('idx_service_items_name').on(table.name),
  isActiveIdx: index('idx_service_items_is_active').on(table.isActive),
}))

/** Deliberately pinned rate for a client — outranks the price derived from history */
export const companyItemPrices = pgTable('company_item_prices', {
  id: text('id').primaryKey(),
  companyId: text('company_id').notNull().references(() => companies.id, { onDelete: 'cascade' }),
  serviceItemId: text('service_item_id').notNull().references(() => serviceItems.id, { onDelete: 'cascade' }),
  unitPrice: text('unit_price').notNull(),
  currency: text('currency').notNull().default('ILS'),
  note: text('note'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  pairUq: uniqueIndex('uq_company_item_prices_pair').on(table.companyId, table.serviceItemId),
}))

export const salesDocuments = pgTable('sales_documents', {
  id: text('id').primaryKey(),
  docType: text('doc_type').notNull(),
  /** Assigned only on issue — drafts stay null so the unique index tolerates them */
  docNumber: integer('doc_number'),
  numberPrefix: text('number_prefix'),
  status: text('status').notNull().default('draft'),
  language: text('language').notNull().default('he'),
  issueDate: text('issue_date').notNull(),
  dueDate: text('due_date'),
  validUntil: text('valid_until'),
  companyId: text('company_id').references(() => companies.id, { onDelete: 'set null' }),
  personId: text('person_id').references(() => people.id, { onDelete: 'set null' }),
  clientName: text('client_name'),
  clientTaxId: text('client_tax_id'),
  clientAddress: text('client_address'),
  clientCountry: text('client_country'),
  clientEmail: text('client_email'),
  clientPhone: text('client_phone'),
  /** JSON snapshot of the issuer profile at issue time, logo included */
  issuerJson: text('issuer_json'),
  currency: text('currency').notNull().default('ILS'),
  exchangeRate: text('exchange_rate'),
  totalIls: text('total_ils').notNull().default('0'),
  vatMode: text('vat_mode').notNull().default('standard'),
  vatRate: text('vat_rate').notNull().default('0.18'),
  subtotal: text('subtotal').notNull().default('0'),
  vatAmount: text('vat_amount').notNull().default('0'),
  total: text('total').notNull().default('0'),
  notes: text('notes'),
  internalNotes: text('internal_notes'),
  allocationNumber: text('allocation_number'),
  relatedDocumentId: text('related_document_id'),
  creditedByDocumentId: text('credited_by_document_id'),
  vatEntryId: text('vat_entry_id'),
  issuedAt: text('issued_at'),
  cancelledAt: text('cancelled_at'),
  cancelReason: text('cancel_reason'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  docTypeIdx: index('idx_sales_documents_doc_type').on(table.docType),
  statusIdx: index('idx_sales_documents_status').on(table.status),
  issueDateIdx: index('idx_sales_documents_issue_date').on(table.issueDate),
  companyIdIdx: index('idx_sales_documents_company_id').on(table.companyId),
  relatedIdx: index('idx_sales_documents_related_document_id').on(table.relatedDocumentId),
  typeNumberUq: uniqueIndex('uq_sales_documents_type_number').on(table.docType, table.docNumber),
}))

export const salesDocumentLines = pgTable('sales_document_lines', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => salesDocuments.id, { onDelete: 'cascade' }),
  serviceItemId: text('service_item_id').references(() => serviceItems.id, { onDelete: 'set null' }),
  priceSource: text('price_source').notNull().default('manual'),
  position: integer('position').notNull().default(0),
  description: text('description').notNull(),
  quantity: text('quantity').notNull().default('1'),
  unitPrice: text('unit_price').notNull().default('0'),
  discountPercent: text('discount_percent'),
  vatApplicable: boolean('vat_applicable').notNull().default(true),
  lineTotal: text('line_total').notNull().default('0'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  documentIdIdx: index('idx_sales_document_lines_document_id').on(table.documentId),
  serviceItemIdIdx: index('idx_sales_document_lines_service_item_id').on(table.serviceItemId),
}))

export const salesDocumentPayments = pgTable('sales_document_payments', {
  id: text('id').primaryKey(),
  documentId: text('document_id').notNull().references(() => salesDocuments.id, { onDelete: 'cascade' }),
  method: text('method').notNull().default('bank_transfer'),
  amount: text('amount').notNull(),
  paidDate: text('paid_date').notNull(),
  reference: text('reference'),
  bankDetails: text('bank_details'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  documentIdIdx: index('idx_sales_document_payments_document_id').on(table.documentId),
}))

/** Continuous per-type numbering, no yearly reset — seeded from settings startNumbers */
export const salesDocumentCounters = pgTable('sales_document_counters', {
  id: text('id').primaryKey(),
  docType: text('doc_type').notNull(),
  lastNumber: integer('last_number').notNull().default(0),
  updatedAt: text('updated_at').notNull(),
})

export type BankConnection = typeof bankConnections.$inferSelect
export type NewBankConnection = typeof bankConnections.$inferInsert
export type BankAccount = typeof bankAccounts.$inferSelect
export type NewBankAccount = typeof bankAccounts.$inferInsert

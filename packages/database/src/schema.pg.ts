import { pgTable, text, integer, boolean, real, index, uniqueIndex, type AnyPgColumn } from 'drizzle-orm/pg-core'

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
  /** Opt-in: save this person's WhatsApp 1:1 chat */
  captureWhatsapp: boolean('capture_whatsapp').notNull().default(false),
  /** When capture was switched on; earlier messages are never stored */
  captureWhatsappSince: text('capture_whatsapp_since'),
  createdAt: text('created_at').notNull(),
  warmthNote: text('warmth_note'),
  warmthNoteUpdatedAt: text('warmth_note_updated_at'),
  /** ISO time of the last character-trait write */
  traitsAt: text('traits_at'),
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
  /** The one world or workspace this project belongs to. Null until assigned. */
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  source: text('source').notNull().default('manual'),
  standingBrief: text('standing_brief'),
  standingBriefAt: text('standing_brief_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  notionPageIdIdx: index('idx_projects_notion_page_id').on(table.notionPageId),
  companyIdIdx: index('idx_projects_company_id').on(table.companyId),
  workspaceIdIdx: index('idx_projects_workspace_id').on(table.workspaceId),
}))

export const projectPeople = pgTable('project_people', {
  projectId: text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
}, (table) => ({
  projectIdIdx: index('idx_project_people_project_id').on(table.projectId),
  personIdIdx: index('idx_project_people_person_id').on(table.personId),
  pairUq: uniqueIndex('uq_project_people_pair').on(table.projectId, table.personId),
}))

/** What a workspace is in Alpir's life — drives relationship suggestions and Harness context */
export const WORKSPACE_KINDS = ['employer', 'own_company', 'personal', 'other'] as const
export type WorkspaceKind = (typeof WORKSPACE_KINDS)[number]

/** Top-level task origin (Alpir Consulting / Dragontail / DAZ / personal) — orthogonal to projects */
export const workspaces = pgTable('workspaces', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').default('#2dd4bf'),
  notionAccountLabel: text('notion_account_label'),
  /** WorkspaceKind; null until the owner classifies it. Meaningful on worlds; a workspace shows its world's kind. */
  kind: text('kind'),
  description: text('description'),
  /** Null = this row is a world. Set = it is a workspace inside that world. One level only. */
  parentId: text('parent_id').references((): AnyPgColumn => workspaces.id, { onDelete: 'restrict' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  parentIdIdx: index('idx_workspaces_parent_id').on(table.parentId),
}))

/**
 * A person's place in one life domain. Many-to-many: the same person can be a colleague at
 * Dragontail and a friend in the personal workspace — one row per (person, workspace).
 */
export const personWorkspaces = pgTable('person_workspaces', {
  id: text('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  /** Free text; the UI suggests values per workspace kind */
  relationshipType: text('relationship_type').notNull(),
  /** Org-chart line inside this workspace only */
  reportsToPersonId: text('reports_to_person_id').references(() => people.id, { onDelete: 'set null' }),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  pairUq: uniqueIndex('uq_person_workspaces_pair').on(table.personId, table.workspaceId),
  workspaceIdIdx: index('idx_person_workspaces_workspace_id').on(table.workspaceId),
  personIdIdx: index('idx_person_workspaces_person_id').on(table.personId),
}))

/** Explicit workspace ↔ Notion database (by id) links — preferred over the free-text label match */
export const workspaceNotionDatabases = pgTable('workspace_notion_databases', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  notionDatabaseId: text('notion_database_id').notNull(),
  notionDatabaseName: text('notion_database_name'),
  /**
   * Set when the database was registered by paste-a-link (see notion-task-source-manager).
   * Matches a `NOTION_ACCOUNTS` label; the token is resolved at sync time and never stored.
   * Null on rows linked from the env checkbox list — those tokens come from `resolveDatabases('tasks')`.
   */
  accountLabel: text('account_label'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  workspaceIdIdx: index('idx_workspace_notion_databases_workspace_id').on(table.workspaceId),
  notionDatabaseIdUq: uniqueIndex('uq_workspace_notion_databases_notion_database_id').on(table.notionDatabaseId),
}))

/**
 * Self-service "people" Notion database registrations (Settings ← מקורות), additive to whatever
 * is already configured via the `NOTION_ACCOUNTS` env var. Not workspace-scoped — people sync
 * pulls from every registered directory regardless of workspace. `accountLabel` matches a label
 * in `NOTION_ACCOUNTS`; the token itself is resolved from env at sync time, never stored here.
 */
export const peopleNotionSources = pgTable('people_notion_sources', {
  id: text('id').primaryKey(),
  accountLabel: text('account_label').notNull(),
  notionDatabaseId: text('notion_database_id').notNull(),
  notionDatabaseName: text('notion_database_name'),
  /**
   * Pinned per-field property names, chosen once (auto-detected or picked by the owner) when the
   * source is added — see notion-people-full-field-sync. Null means "skip this field for this
   * source", not "fall back to a heuristic": pinning is all-or-nothing per source.
   */
  phonePropertyName: text('phone_property_name'),
  rolePropertyName: text('role_property_name'),
  companyPropertyName: text('company_property_name'),
  linkedinPropertyName: text('linkedin_property_name'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  notionDatabaseIdUq: uniqueIndex('uq_people_notion_sources_notion_database_id').on(table.notionDatabaseId),
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
  titleKey: text('title_key'),
  rosterSavedAt: text('roster_saved_at'),
  rosterDismissedSig: text('roster_dismissed_sig'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  warmthNote: text('warmth_note'),
  warmthNoteUpdatedAt: text('warmth_note_updated_at'),
  /** The one world or workspace this series belongs to. Its meetings inherit it unless set by hand. */
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
}, (table) => ({
  googleRecurringEventIdIdx: index('idx_meeting_series_google_recurring_event_id').on(table.googleRecurringEventId),
  titleKeyIdx: index('idx_meeting_series_title_key').on(table.titleKey),
  workspaceIdIdx: index('idx_meeting_series_workspace_id').on(table.workspaceId),
}))

export const SERIES_ROSTER_SOURCES = ['attendees', 'description', 'manual'] as const

export const seriesRoster = pgTable('series_roster', {
  id: text('id').primaryKey(),
  seriesId: text('series_id').notNull().references(() => meetingSeries.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  email: text('email'),
  source: text('source').notNull(),
  personId: text('person_id').references(() => people.id, { onDelete: 'set null' }),
  inactive: boolean('inactive').notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  seriesIdIdx: index('idx_series_roster_series_id').on(table.seriesId),
  personIdIdx: index('idx_series_roster_person_id').on(table.personId),
}))

export const ROSTER_EXCEPTION_KINDS = ['absent', 'guest'] as const

export const meetingRosterExceptions = pgTable('meeting_roster_exceptions', {
  id: text('id').primaryKey(),
  meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  kind: text('kind').notNull(),
  rosterId: text('roster_id').references(() => seriesRoster.id, { onDelete: 'cascade' }),
  displayName: text('display_name').notNull(),
  email: text('email'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  meetingIdIdx: index('idx_meeting_roster_exceptions_meeting_id').on(table.meetingId),
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
  /** The connected calendar's own id (e.g. from `fetchGoogleCalendarEvents`), used to scope calendar-based features like recording auto-linking; null for non-calendar-sourced meetings or rows synced before this column existed */
  calendarId: text('calendar_id'),
  /** Notion Meetings page id when synced from a Notion meetings database */
  notionPageId: text('notion_page_id'),
  /** Source of this meeting: 'calendar' | 'notion_note' | 'manual' */
  source: text('source').notNull().default('calendar'),
  /** When source='notion_note', this is the first note that created the meeting */
  sourceNoteId: text('source_note_id').references(() => meetingNotes.id, { onDelete: 'set null' }),
  calendarParticipants: text('calendar_participants'),
  /** The one world or workspace this meeting belongs to. Null until assigned. */
  workspaceId: text('workspace_id').references(() => workspaces.id, { onDelete: 'set null' }),
  /** manual | series | calendar | attendees — manual is never overwritten */
  workspaceSource: text('workspace_source'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  dateIdx: index('idx_meetings_date').on(table.date),
  workspaceIdIdx: index('idx_meetings_workspace_id').on(table.workspaceId),
  projectIdIdx: index('idx_meetings_project_id').on(table.projectId),
  seriesIdIdx: index('idx_meetings_series_id').on(table.seriesId),
  typeIdIdx: index('idx_meetings_type_id').on(table.typeId),
  calendarEventIdIdx: index('idx_meetings_calendar_event_id').on(table.calendarEventId),
  notionPageIdIdx: index('idx_meetings_notion_page_id').on(table.notionPageId),
  sourceIdx: index('idx_meetings_source').on(table.source),
  sourceNoteIdIdx: index('idx_meetings_source_note_id').on(table.sourceNoteId),
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
  /** `meeting_page` = AI notes on the Meetings DB page; `notes_db` = separate meeting_notes database. */
  sourceKind: text('source_kind'),
  /** Notion block id of the in-page AI Meeting Notes widget when known. */
  sourceBlockId: text('source_block_id'),
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

/** Deep qualitative analysis of meeting conversations (from Notion transcripts or recordings). */
export const meetingAnalyses = pgTable('meeting_analyses', {
  id: text('id').primaryKey(),
  meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  meetingNoteId: text('meeting_note_id').references(() => meetingNotes.id, { onDelete: 'set null' }),
  source: text('source').notNull(),
  transcriptText: text('transcript_text'),
  audioPath: text('audio_path'),
  hatName: text('hat_name'),
  topic: text('topic'),
  mood: text('mood'),
  subtext: text('subtext'),
  keyInsight: text('key_insight'),
  score: integer('score'),
  scoreRationale: text('score_rationale'),
  kaizenKeep: text('kaizen_keep'),
  kaizenImprove: text('kaizen_improve'),
  openQuestion: text('open_question'),
  participantsJson: text('participants_json'),
  actionItemsJson: text('action_items_json'),
  model: text('model'),
  status: text('status').notNull().default('pending'),
  error: text('error'),
  consentConfirmedAt: text('consent_confirmed_at'),
  /** Set after the learning WhatsApp for this analysis was sent */
  whatsappNotifiedAt: text('whatsapp_notified_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  meetingIdIdx: index('idx_meeting_analyses_meeting_id').on(table.meetingId),
  statusIdx: index('idx_meeting_analyses_status').on(table.status),
  sourceIdx: index('idx_meeting_analyses_source').on(table.source),
}))

export const MEETING_PREP_SOURCES = ['agent', 'template'] as const
export type MeetingPrepSource = (typeof MEETING_PREP_SOURCES)[number]

/** The pre-meeting brief generated ~15 min before a meeting, kept so the meeting page can show it. */
export const meetingPreps = pgTable('meeting_preps', {
  id: text('id').primaryKey(),
  meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  /** Null when the built-in template produced the brief instead of an agent. */
  agentId: text('agent_id'),
  /** agent | template */
  source: text('source').notNull(),
  bodyText: text('body_text').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  meetingIdUq: uniqueIndex('uq_meeting_preps_meeting_id').on(table.meetingId),
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
  'awaiting_captcha',
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

// ─── Personal CFO Module Tables ────────────────────────────────────────────

/**
 * User-defined debts for the Debt Avalanche engine: overdrafts, credit loans, installments.
 * Enables tracking and optimal payoff schedule calculation.
 */
export const financeDebts = pgTable('finance_debts', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  name: text('name').notNull(), // e.g. "משיכת יתר בנק הפועלים"
  balance: text('balance').notNull(), // current debt balance
  apr: text('apr').notNull(), // annual percentage rate (decimal, e.g. "0.15" for 15%)
  minPayment: text('min_payment').notNull(), // minimum monthly payment
  debtType: text('debt_type').notNull(), // 'overdraft' | 'credit_loan' | 'installment'
  createdAt: text('created_at').notNull(),
}, (table) => ({
  userIdIdx: index('idx_finance_debts_user_id').on(table.userId),
}))

/**
 * Pension & long-term savings policies for audit and fee benchmarking.
 * Tracks deposit fees, accumulation fees, and policy activity status.
 */
export const financePensionPolicies = pgTable('finance_pension_policies', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  provider: text('provider').notNull(), // e.g. "מיטב דש", "הראל"
  policyType: text('policy_type').notNull(), // 'pension' | 'keren_hishtalmut' | 'gemel_lehaskaa' | 'bituach_managers'
  balance: text('balance').notNull(), // current accumulated balance
  depositFeePct: text('deposit_fee_pct').notNull(), // management fee on deposits (decimal)
  accumFeePct: text('accum_fee_pct').notNull(), // management fee on accumulated balance (decimal)
  monthlyDeposit: text('monthly_deposit').notNull(), // average monthly deposit
  retirementAge: integer('retirement_age').notNull().default(67), // target retirement age
  isActive: integer('is_active').notNull().default(1), // 0/1 for duplicate detection
  createdAt: text('created_at').notNull(),
}, (table) => ({
  userIdIdx: index('idx_finance_pension_policies_user_id').on(table.userId),
}))

/**
 * Cache of LLM-generated CFO reports: leak negotiation letters, pension fee-reduction
 * requests, monthly review summaries. Keyed by scopeKey + inputHash to avoid regeneration.
 */
export const financeCfoReports = pgTable('finance_cfo_reports', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  reportMonth: text('report_month').notNull(), // YYYY-MM
  scopeKey: text('scope_key').notNull(), // 'leak' | 'debt' | 'liquidity' | 'pension' | 'monthly'
  inputHash: text('input_hash').notNull(), // hash of facts sent to LLM
  reportJson: text('report_json').notNull(), // JSON: { headline, body, actionItems, formalLetter? }
  model: text('model'), // Gemini model ID
  generatedAt: text('generated_at').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  userIdIdx: index('idx_finance_cfo_reports_user_id').on(table.userId),
  scopeHashUq: uniqueIndex('uq_finance_cfo_reports_scope_hash').on(table.userId, table.scopeKey, table.inputHash),
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
  /** JSON map { "HH:MM": 0 | 1 } — 0 = today, 1 = tomorrow. Only used for 06_calendar_optimizer. */
  scheduleDayOffsets: text('schedule_day_offsets').notNull().default('{}'),
  triggerMessage: text('trigger_message'),
  lastRunAt: text('last_run_at'),
  lastRunStatus: text('last_run_status'),
  lastRunError: text('last_run_error'),
  updatedAt: text('updated_at').notNull(),
})

/**
 * One row per successful Tier 1 QA daily-agent run. Powers day-over-day
 * diffing for the WhatsApp update (docs/specs/tier1-qa-whatsapp-agent.md).
 * `snapshotDate` is the Asia/Jerusalem calendar day, unique.
 */
export const tier1QaSnapshots = pgTable('tier1_qa_snapshots', {
  id: text('id').primaryKey(),
  snapshotDate: text('snapshot_date').notNull().unique(),
  /** JSON: { testId, statusBdika, done, testedBy, hasResultLink, linkedBugIds[] }[] */
  testsSnapshot: text('tests_snapshot').notNull(),
  /** JSON: { bugId, status, priority, assignee, due, archived, deleted }[] */
  bugsSnapshot: text('bugs_snapshot').notNull(),
  /** JSON: computed aggregate counts, for audit/debug without re-deriving */
  summaryStats: text('summary_stats').notNull(),
  createdAt: text('created_at').notNull(),
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
  aggregateSummaries: integer('aggregate_summaries').notNull().default(0),
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
  /** Kept past retention */
  pinned: boolean('pinned').notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  groupTsIdx: index('idx_whatsapp_messages_group_ts').on(table.groupJid, table.ts),
  groupMsgUq: uniqueIndex('uq_whatsapp_messages_group_msg').on(table.groupJid, table.waMessageId),
}))

export const whatsappPersonLinks = pgTable('whatsapp_person_links', {
  id: text('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  whatsappJid: text('whatsapp_jid').notNull(),
  matchedBy: text('matched_by').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  personIdIdx: index('idx_whatsapp_person_links_person_id').on(table.personId),
  jidUq: uniqueIndex('uq_whatsapp_person_links_jid').on(table.whatsappJid),
}))

export const duplicateReviews = pgTable('duplicate_reviews', {
  id: text('id').primaryKey(),
  personIdA: text('person_id_a').notNull().references(() => people.id, { onDelete: 'cascade' }),
  personIdB: text('person_id_b').notNull().references(() => people.id, { onDelete: 'cascade' }),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  pairUq: uniqueIndex('uq_duplicate_reviews_pair').on(table.personIdA, table.personIdB),
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
  /** JSON ListSortPrefs — multi-level sort defaults for dashboard, /tasks, meetings past */
  listSortPrefs: text('list_sort_prefs'),
  /** Auto-create tasks from meeting analysis action items */
  autoCreateActionItemTasks: boolean('auto_create_action_item_tasks').notNull().default(false),
  duplicatesNotifiedPairs: text('duplicates_notified_pairs'),
  /** null = use the code default for the evening WhatsApp digest */
  whatsappDailyDigestPrompt: text('whatsapp_daily_digest_prompt'),
  /** ms timestamp (as text) of the newest whatsapp_messages row already scanned for group commitments */
  whatsappGroupCommitmentScanCursor: text('whatsapp_group_commitment_scan_cursor'),
  /** Bridge's own JID cached after last successful getBridgeStatus — used as fallback when bridge is offline during a group-commitment scan */
  whatsappSelfJid: text('whatsapp_self_jid'),
  /** ms timestamp (as text) of the newest slack_messages row already scanned for channel commitments */
  slackCommitmentScanCursor: text('slack_commitment_scan_cursor'),
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

export const agentRunLogs = pgTable('agent_run_logs', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  agentId: text('agent_id').notNull(),
  channel: text('channel').notNull(),
  priority: text('priority').notNull(),
  status: text('status').notNull(),
  finishReason: text('finish_reason'),
  blockReason: text('block_reason'),
  toolsCalled: text('tools_called').notNull().default('[]'),
  geminiCalls: integer('gemini_calls').notNull().default(0),
  queueWaitMs: integer('queue_wait_ms').notNull().default(0),
  attempts: integer('attempts').notNull().default(1),
  modelTier: text('model_tier').notNull().default('flash'),
  cacheHit: boolean('cache_hit').notNull().default(false),
  durationMs: integer('duration_ms').notNull().default(0),
  replyChars: integer('reply_chars').notNull().default(0),
  errorMessage: text('error_message'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  runIdIdx: index('idx_agent_run_logs_run_id').on(table.runId),
  agentIdIdx: index('idx_agent_run_logs_agent_id').on(table.agentId),
  statusIdx: index('idx_agent_run_logs_status').on(table.status),
  createdAtIdx: index('idx_agent_run_logs_created_at').on(table.createdAt),
}))

export const agentJobs = pgTable('agent_jobs', {
  id: text('id').primaryKey(),
  dedupeKey: text('dedupe_key').notNull(),
  channel: text('channel').notNull(),
  agentId: text('agent_id').notNull(),
  payload: text('payload').notNull().default('{}'),
  status: text('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextRunAt: text('next_run_at'),
  lastError: text('last_error'),
  createdAt: text('created_at').notNull(),
  completedAt: text('completed_at'),
}, (table) => ({
  dedupeKeyUq: uniqueIndex('uq_agent_jobs_dedupe_key').on(table.dedupeKey),
  statusIdx: index('idx_agent_jobs_status').on(table.status),
  nextRunAtIdx: index('idx_agent_jobs_next_run_at').on(table.nextRunAt),
}))

export const agentCache = pgTable('agent_cache', {
  key: text('key').primaryKey(),
  value: text('value').notNull().default('{}'),
  expiresAt: text('expires_at').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  expiresAtIdx: index('idx_agent_cache_expires_at').on(table.expiresAt),
}))

export type BankConnection = typeof bankConnections.$inferSelect
export type NewBankConnection = typeof bankConnections.$inferInsert
export type BankAccount = typeof bankAccounts.$inferSelect
export type NewBankAccount = typeof bankAccounts.$inferInsert
export type AgentRunLog = typeof agentRunLogs.$inferSelect
export type NewAgentRunLog = typeof agentRunLogs.$inferInsert
export type AgentJob = typeof agentJobs.$inferSelect
export type NewAgentJob = typeof agentJobs.$inferInsert
export type AgentCacheEntry = typeof agentCache.$inferSelect
export type NewAgentCacheEntry = typeof agentCache.$inferInsert

/** 1:1 WhatsApp messages with an allowlisted person (`people.captureWhatsapp`), both directions. */
export const whatsappDmMessages = pgTable('whatsapp_dm_messages', {
  id: text('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  /** The other party's JID */
  whatsappJid: text('whatsapp_jid').notNull(),
  waMessageId: text('wa_message_id').notNull(),
  fromMe: boolean('from_me').notNull(),
  /** `[expired]` after DM retention unless pinned */
  text: text('text').notNull(),
  ts: integer('ts').notNull(),
  /** Meeting with this person within 3 days of the message */
  meetingId: text('meeting_id').references(() => meetings.id, { onDelete: 'set null' }),
  pinned: boolean('pinned').notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  personIdIdx: index('idx_whatsapp_dm_messages_person_id').on(table.personId),
  tsIdx: index('idx_whatsapp_dm_messages_ts').on(table.ts),
  msgUq: uniqueIndex('uq_whatsapp_dm_messages_msg').on(table.waMessageId, table.whatsappJid),
}))

/** Nightly summary of one person's 1:1 chat; outlives the raw messages. */
export const whatsappDmSummaries = pgTable('whatsapp_dm_summaries', {
  id: text('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  summary: text('summary').notNull(),
  fromTs: integer('from_ts').notNull(),
  toTs: integer('to_ts').notNull(),
  messageCount: integer('message_count').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  personIdIdx: index('idx_whatsapp_dm_summaries_person_id').on(table.personId),
}))

export const COMMITMENT_STATUSES = ['proposed', 'accepted', 'dismissed'] as const
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number]
export const COMMITMENT_SOURCES = ['whatsapp_dm', 'whatsapp_group', 'meeting_analysis', 'email', 'voice', 'slack_channel'] as const
export type CommitmentSource = (typeof COMMITMENT_SOURCES)[number]
export const COMMITMENT_OWNERS = ['me', 'them'] as const
export type CommitmentOwner = (typeof COMMITMENT_OWNERS)[number]

/** Something promised in a conversation; becomes a task only when the owner accepts it. */
export const commitments = pgTable('commitments', {
  id: text('id').primaryKey(),
  /** Null while a group sender is not a contact yet. */
  personId: text('person_id').references(() => people.id, { onDelete: 'cascade' }),
  /** Set only while personId is null. */
  senderJid: text('sender_jid'),
  senderName: text('sender_name'),
  /** me | them */
  owner: text('owner').notNull(),
  content: text('content').notNull(),
  /** ISO date when the conversation named one */
  dueInferred: text('due_inferred'),
  /** whatsapp_dm | whatsapp_group | meeting_analysis | email | voice */
  source: text('source').notNull(),
  sourceId: text('source_id'),
  /** A short quote from the source message. */
  sourceSnippet: text('source_snippet'),
  /** When the source message was actually sent, not when the scan ran. Null for non-message sources. */
  sourceTs: integer('source_ts'),
  /** Group JID, or the other party's JID for a DM. */
  sourceChatJid: text('source_chat_jid'),
  /** Group name, or the person's name for a DM. */
  sourceChatName: text('source_chat_name'),
  /** One Hebrew sentence from the classifier: why this is still standing. */
  sourceReason: text('source_reason'),
  /** proposed | accepted | dismissed */
  status: text('status').notNull().default('proposed'),
  taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  personIdIdx: index('idx_commitments_person_id').on(table.personId),
  statusIdx: index('idx_commitments_status').on(table.status),
  taskIdIdx: index('idx_commitments_task_id').on(table.taskId),
  sourceTsIdx: index('idx_commitments_source_ts').on(table.sourceTs),
}))

export type WhatsappDmMessage = typeof whatsappDmMessages.$inferSelect
export type WhatsappDmSummary = typeof whatsappDmSummaries.$inferSelect
export type Commitment = typeof commitments.$inferSelect

// ─── Slack integration ───────────────────────────────────────────────────────

/** Active Slack OAuth connection (one row per team_id; revokedAt set on disconnect). */
export const slackConnections = pgTable('slack_connections', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull().unique(),
  teamName: text('team_name').notNull(),
  /** xoxb-... bot token. Stored plain like google_connections — can add AES later. */
  botToken: text('bot_token').notNull(),
  botUserId: text('bot_user_id').notNull(),
  /** Comma-separated granted scopes */
  scopes: text('scopes').notNull(),
  installedAt: text('installed_at').notNull(),
  revokedAt: text('revoked_at'),
  updatedAt: text('updated_at').notNull(),
})

/** A Slack channel the user wants to monitor. */
export const slackChannels = pgTable('slack_channels', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  /** Slack C… / G… channel id */
  channelId: text('channel_id').notNull().unique(),
  name: text('name').notNull(),
  isPrivate: integer('is_private').notNull().default(0),
  enabled: integer('enabled').notNull().default(0),
  fomoEnabled: integer('fomo_enabled').notNull().default(0),
  fomoThreshold: integer('fomo_threshold').notNull().default(10),
  fomoWindowMinutes: integer('fomo_window_minutes').notNull().default(5),
  /** JSON string[] */
  keywords: text('keywords').notNull().default('[]'),
  lastFomoAlertAt: text('last_fomo_alert_at'),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  teamIdIdx: index('idx_slack_channels_team_id').on(table.teamId),
}))

/** Rolling archive of watched-channel messages for commitments/insights. */
export const slackMessages = pgTable('slack_messages', {
  id: text('id').primaryKey(),
  teamId: text('team_id').notNull(),
  channelId: text('channel_id').notNull(),
  /** Slack's "1234567890.123456" timestamp — unique within a channel */
  slackTs: text('slack_ts').notNull(),
  userId: text('user_id').notNull(),
  userName: text('user_name').notNull(),
  text: text('text').notNull(),
  /** Non-null for replies inside a thread */
  threadTs: text('thread_ts'),
  /** Epoch ms for range queries */
  ts: integer('ts').notNull(),
  /** Set when Slack fires a message_changed event */
  editedTs: text('edited_ts'),
  deleted: boolean('deleted').notNull().default(false),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  channelTsUq: uniqueIndex('uq_slack_messages_channel_ts').on(table.channelId, table.slackTs),
  channelTsIdx: index('idx_slack_messages_channel_ts').on(table.channelId, table.ts),
}))

export type SlackConnection = typeof slackConnections.$inferSelect
export type SlackChannel = typeof slackChannels.$inferSelect
export type SlackMessage = typeof slackMessages.$inferSelect

/** Latest state of an email thread with a known person, one row per (thread, person). */
export const personEmailThreads = pgTable('person_email_threads', {
  id: text('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  /** `accountEmail::threadId` — Gmail thread ids are only unique per account */
  gmailThreadId: text('gmail_thread_id').notNull(),
  accountEmail: text('account_email').notNull(),
  subject: text('subject').notNull(),
  from: text('from').notNull(),
  to: text('to').notNull(),
  /** ISO timestamp of the latest message */
  date: text('date').notNull(),
  snippet: text('snippet'),
  messageCount: integer('message_count').notNull().default(1),
  /** needs_reply | fyi | chatter. Null until the reply-need gate classifies the thread. */
  replyNeed: text('reply_need'),
  /** ISO timestamp of the classification. Cleared when a newer message moves `date`. */
  replyNeedAt: text('reply_need_at'),
  lastSyncedAt: text('last_synced_at').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  personIdIdx: index('idx_person_email_threads_person_id').on(table.personId),
  dateIdx: index('idx_person_email_threads_date').on(table.date),
  threadPersonUq: uniqueIndex('uq_person_email_threads_thread_person').on(table.gmailThreadId, table.personId),
}))

export const VOICE_RECORDING_STATUSES = ['uploaded', 'processing', 'completed', 'failed'] as const
export type VoiceRecordingStatus = (typeof VOICE_RECORDING_STATUSES)[number]

/** A consented recording; its analysis always lives on a meeting (a placeholder one when standalone). */
export const voiceRecordings = pgTable('voice_recordings', {
  id: text('id').primaryKey(),
  audioPath: text('audio_path').notNull(),
  mimeType: text('mime_type').notNull(),
  sizeBytes: integer('size_bytes').notNull(),
  transcriptText: text('transcript_text'),
  analysisId: text('analysis_id').references(() => meetingAnalyses.id, { onDelete: 'set null' }),
  meetingId: text('meeting_id').references(() => meetings.id, { onDelete: 'set null' }),
  /** Placeholder meeting created for a standalone recording; removed when attached elsewhere */
  createdMeetingId: text('created_meeting_id'),
  /** Seconds */
  duration: integer('duration').notNull(),
  /** uploaded | processing | completed | failed */
  status: text('status').notNull().default('uploaded'),
  error: text('error'),
  consentConfirmedAt: text('consent_confirmed_at').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
  /** Optional project this conversation is about; copied onto the voice meeting */
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  /** skipped | pending | completed | failed — self-voice diarization pass, independent of transcription status */
  diarizationStatus: text('diarization_status').notNull().default('skipped'),
  diarizationError: text('diarization_error'),
  /** live (recorded in-app) | imported (e.g. a phone call recording picked/shared from device storage) */
  source: text('source').notNull().default('live'),
  /** True when `meetingId` was set by automatic calendar-context matching rather than manual attach or placeholder creation */
  matchedAutomatically: boolean('matched_automatically').notNull().default(false),
  /** Set once the "who is speaking?" notification went out, so it is never sent twice */
  speakerPromptSentAt: text('speaker_prompt_sent_at'),
}, (table) => ({
  meetingIdIdx: index('idx_voice_recordings_meeting_id').on(table.meetingId),
  analysisIdIdx: index('idx_voice_recordings_analysis_id').on(table.analysisId),
  createdAtIdx: index('idx_voice_recordings_created_at').on(table.createdAt),
  projectIdIdx: index('idx_voice_recordings_project_id').on(table.projectId),
}))

export const voiceRecordingPeople = pgTable('voice_recording_people', {
  recordingId: text('recording_id').notNull().references(() => voiceRecordings.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  /** True when this person was tagged by automatic self-voice matching rather than a manual "attach person" action */
  matchedAutomatically: boolean('matched_automatically').notNull().default(false),
  /** Cosine-similarity score (0-1) that produced the automatic match; null for manual tags */
  confidence: real('confidence'),
}, (table) => ({
  recordingIdIdx: index('idx_voice_recording_people_recording_id').on(table.recordingId),
  personIdIdx: index('idx_voice_recording_people_person_id').on(table.personId),
  pairUq: uniqueIndex('uq_voice_recording_people_pair').on(table.recordingId, table.personId),
}))

/** One speaker turn from the transcription, with the times needed to play it back as a voice sample. */
export const voiceTranscriptSegments = pgTable('voice_transcript_segments', {
  id: text('id').primaryKey(),
  recordingId: text('recording_id').notNull().references(() => voiceRecordings.id, { onDelete: 'cascade' }),
  /** The label the model returned, e.g. `דובר 1` — relative to this recording only */
  speakerLabel: text('speaker_label').notNull(),
  startMs: integer('start_ms').notNull(),
  endMs: integer('end_ms').notNull(),
  text: text('text').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  recordingIdIdx: index('idx_voice_transcript_segments_recording_id').on(table.recordingId),
}))

export const VOICE_SPEAKER_STATES = ['identified', 'skipped', 'auto'] as const
export type VoiceSpeakerState = (typeof VOICE_SPEAKER_STATES)[number]

/** Who a speaker label is: answered by the user, skipped by them, or resolved by self-voice matching. */
export const voiceSpeakerIdentities = pgTable('voice_speaker_identities', {
  id: text('id').primaryKey(),
  recordingId: text('recording_id').notNull().references(() => voiceRecordings.id, { onDelete: 'cascade' }),
  speakerLabel: text('speaker_label').notNull(),
  /** Null when the user skipped this speaker */
  personId: text('person_id').references(() => people.id, { onDelete: 'cascade' }),
  /** identified | skipped | auto */
  state: text('state').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  recordingIdIdx: index('idx_voice_speaker_identities_recording_id').on(table.recordingId),
  speakerUq: uniqueIndex('uq_voice_speaker_identities_speaker').on(table.recordingId, table.speakerLabel),
}))

/** A single enrolled voice embedding used for automatic self-voice matching in recordings. MVP: one row (Alpir's own). */
export const voicePrints = pgTable('voice_prints', {
  id: text('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  /** JSON-encoded float array (kept as text for SQLite-mirror compatibility) */
  embedding: text('embedding').notNull(),
  /** Path to the enrollment sample audio, kept for re-enrollment/debugging */
  sampleAudioPath: text('sample_audio_path'),
  /** Embedding extraction method + version, so a model upgrade can invalidate old rows */
  model: text('model').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  personIdIdx: index('idx_voice_prints_person_id').on(table.personId),
  personIdUq: uniqueIndex('uq_voice_prints_person_id').on(table.personId),
}))

export const PERSON_TRAIT_STATUSES = ['shown', 'once', 'dismissed'] as const
export type PersonTraitStatus = (typeof PERSON_TRAIT_STATUSES)[number]

export const PERSON_TRAIT_SOURCE_KINDS = ['meeting_analysis', 'whatsapp_dm_summary', 'email_thread'] as const
export type PersonTraitSourceKind = (typeof PERSON_TRAIT_SOURCE_KINDS)[number]

/** An artifact already read for character traits, so a re-run does not send it again. */
export const personSourceScans = pgTable('person_source_scans', {
  id: text('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  sourceKind: text('source_kind').notNull(),
  sourceId: text('source_id').notNull(),
  sourceUpdatedAt: text('source_updated_at').notNull(),
  scannedAt: text('scanned_at').notNull(),
}, (table) => ({
  personIdIdx: index('idx_person_source_scans_person_id').on(table.personId),
  sourceUq: uniqueIndex('uq_person_source_scans').on(table.personId, table.sourceKind, table.sourceId),
}))

/** One observed behaviour from a single conversation artifact. */
export const personObservations = pgTable('person_observations', {
  id: text('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  claim: text('claim').notNull(),
  quote: text('quote'),
  sourceKind: text('source_kind').notNull(),
  sourceId: text('source_id').notNull(),
  sourceDate: text('source_date').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  personIdIdx: index('idx_person_observations_person_id').on(table.personId),
}))

/** A character line folded from observations. `shown` needs two sources; `once` is detail-only. */
export const personTraits = pgTable('person_traits', {
  id: text('id').primaryKey(),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
  label: text('label').notNull(),
  line: text('line').notNull(),
  reasoning: text('reasoning').notNull(),
  supportCount: integer('support_count').notNull(),
  latestSourceDate: text('latest_source_date').notNull(),
  status: text('status').notNull().default('shown'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  personIdIdx: index('idx_person_traits_person_id').on(table.personId),
}))

export const personTraitEvidence = pgTable('person_trait_evidence', {
  id: text('id').primaryKey(),
  traitId: text('trait_id').notNull().references(() => personTraits.id, { onDelete: 'cascade' }),
  observationId: text('observation_id').notNull().references(() => personObservations.id, { onDelete: 'cascade' }),
}, (table) => ({
  traitIdIdx: index('idx_person_trait_evidence_trait_id').on(table.traitId),
  pairUq: uniqueIndex('uq_person_trait_evidence_pair').on(table.traitId, table.observationId),
}))

/** Harness world model — one row per entity the cross-domain reasoner can reach. */
export const HARNESS_NODE_KINDS = [
  'person',
  'meeting',
  'commitment',
  'financial_event',
  'whatsapp_signal',
  'slack_signal',
  'voice_recording',
  'email_thread',
] as const
export type HarnessNodeKind = (typeof HARNESS_NODE_KINDS)[number]

export const HARNESS_EDGE_KINDS = [
  'ATTENDED',
  'HAS_COMMITMENT',
  'MENTIONED_IN',
  'TRIGGERED_SPEND',
  'RELATED_TO',
] as const
export type HarnessEdgeKind = (typeof HARNESS_EDGE_KINDS)[number]

export const HARNESS_INSIGHT_SEVERITIES = ['info', 'attention', 'urgent'] as const
export type HarnessInsightSeverity = (typeof HARNESS_INSIGHT_SEVERITIES)[number]

export const HARNESS_INSIGHT_STATUSES = ['open', 'dismissed', 'acted'] as const
export type HarnessInsightStatus = (typeof HARNESS_INSIGHT_STATUSES)[number]

export const harnessNodes = pgTable('harness_nodes', {
  /** Deterministic `<kind>:<entityId>` so re-indexing upserts instead of duplicating. */
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  entityId: text('entity_id').notNull(),
  label: text('label').notNull(),
  /** One short line; this is what reaches the LLM prompt. */
  summary: text('summary'),
  /** JSON bag of kind-specific fields. */
  attrs: text('attrs'),
  /** ISO timestamp the underlying event happened; null for timeless nodes like people. */
  occurredAt: text('occurred_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  kindIdx: index('idx_harness_nodes_kind').on(table.kind),
  occurredAtIdx: index('idx_harness_nodes_occurred_at').on(table.occurredAt),
  entityIdIdx: index('idx_harness_nodes_entity_id').on(table.entityId),
}))

export const harnessEdges = pgTable('harness_edges', {
  /** Deterministic `<kind>:<fromId>:<toId>`. */
  id: text('id').primaryKey(),
  fromId: text('from_id').notNull(),
  toId: text('to_id').notNull(),
  kind: text('kind').notNull(),
  weight: real('weight').notNull().default(1),
  occurredAt: text('occurred_at'),
  attrs: text('attrs'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  fromIdIdx: index('idx_harness_edges_from_id').on(table.fromId),
  toIdIdx: index('idx_harness_edges_to_id').on(table.toId),
  kindIdx: index('idx_harness_edges_kind').on(table.kind),
}))

export const harnessInsights = pgTable('harness_insights', {
  id: text('id').primaryKey(),
  /** Detector id, e.g. `silent_before_meeting`. */
  kind: text('kind').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  severity: text('severity').notNull().default('info'),
  score: real('score').notNull().default(0),
  personId: text('person_id').references(() => people.id, { onDelete: 'cascade' }),
  /** JSON `{ nodeId, kind, label }[]` — what the insight was derived from. */
  sources: text('sources'),
  status: text('status').notNull().default('open'),
  /** A detector re-firing on the same facts updates this row instead of adding one. */
  dedupeKey: text('dedupe_key').notNull(),
  generatedAt: text('generated_at').notNull(),
  expiresAt: text('expires_at'),
  /** ISO timestamp of the last push notification that included this insight; null = never pushed. */
  notifiedAt: text('notified_at'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  statusIdx: index('idx_harness_insights_status').on(table.status),
  personIdIdx: index('idx_harness_insights_person_id').on(table.personId),
  dedupeKeyUq: uniqueIndex('uq_harness_insights_dedupe_key').on(table.dedupeKey),
}))

export type PersonEmailThread = typeof personEmailThreads.$inferSelect
export type VoiceRecording = typeof voiceRecordings.$inferSelect
export type VoiceTranscriptSegment = typeof voiceTranscriptSegments.$inferSelect
export type VoiceSpeakerIdentity = typeof voiceSpeakerIdentities.$inferSelect
export type VoicePrint = typeof voicePrints.$inferSelect
export type HarnessNode = typeof harnessNodes.$inferSelect
export type HarnessEdge = typeof harnessEdges.$inferSelect
export type HarnessInsight = typeof harnessInsights.$inferSelect

// Personal CFO types
export type FinanceDebt = typeof financeDebts.$inferSelect
export type FinancePensionPolicy = typeof financePensionPolicies.$inferSelect
export type FinanceCfoReport = typeof financeCfoReports.$inferSelect

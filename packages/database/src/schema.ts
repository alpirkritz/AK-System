import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const people = sqliteTable('people', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  role: text('role'),
  email: text('email'),
  color: text('color').default('#e8c547'),
  phone: text('phone'),
  company: text('company'),
  jobTitle: text('job_title'),
  linkedin: text('linkedin'),
  tags: text('tags'),
  expertIn: text('expert_in'),
  lastContact: text('last_contact'),
  goal: text('goal'),
  contactFrequencyDays: integer('contact_frequency_days'),
  notes: text('notes'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  emailIdx: index('idx_people_email').on(table.email),
}))

export const projects = sqliteTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').default('#47b8e8'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/** Meeting category for daily summary (Work/Family/General) */
export const MEETING_CATEGORIES = ['work', 'family', 'general'] as const
export type MeetingCategory = (typeof MEETING_CATEGORIES)[number]

export const meetings = sqliteTable('meetings', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  date: text('date').notNull(),
  time: text('time').notNull().default('09:00'),
  endTime: text('end_time'),
  recurring: text('recurring'),
  recurrenceDay: text('recurrence_day'),
  notes: text('notes'),
  location: text('location'),
  /** work | family | general — for daily meeting summary grouping */
  category: text('category'),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  calendarEventId: text('calendar_event_id'),
  calendarSource: text('calendar_source'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  dateIdx: index('idx_meetings_date').on(table.date),
  projectIdIdx: index('idx_meetings_project_id').on(table.projectId),
  calendarEventIdIdx: index('idx_meetings_calendar_event_id').on(table.calendarEventId),
}))

export const meetingPeople = sqliteTable('meeting_people', {
  meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
}, (table) => ({
  meetingIdIdx: index('idx_meeting_people_meeting_id').on(table.meetingId),
  personIdIdx: index('idx_meeting_people_person_id').on(table.personId),
}))

export const tasks = sqliteTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  meetingId: text('meeting_id').references(() => meetings.id, { onDelete: 'set null' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  assigneeId: text('assignee_id').references(() => people.id, { onDelete: 'set null' }),
  dueDate: text('due_date'),
  done: integer('done', { mode: 'boolean' }).notNull().default(false),
  priority: text('priority').notNull().default('medium'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  meetingIdIdx: index('idx_tasks_meeting_id').on(table.meetingId),
  projectIdIdx: index('idx_tasks_project_id').on(table.projectId),
  assigneeIdIdx: index('idx_tasks_assignee_id').on(table.assigneeId),
}))

/** Many-to-many: task can be linked to multiple people (in addition to assignee) */
export const taskPeople = sqliteTable('task_people', {
  taskId: text('task_id').notNull().references(() => tasks.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
}, (table) => ({
  taskIdIdx: index('idx_task_people_task_id').on(table.taskId),
  personIdIdx: index('idx_task_people_person_id').on(table.personId),
}))

export const financeTrades = sqliteTable('finance_trades', {
  id: text('id').primaryKey(),
  symbol: text('symbol').notNull(),
  direction: text('direction').notNull(), // 'buy' | 'sell'
  quantity: text('quantity').notNull(),
  price: text('price').notNull(),
  commission: text('commission'),
  currency: text('currency').notNull().default('USD'),
  tradeDate: text('trade_date').notNull(),
  source: text('source').notNull().default('ibkr_email'),
  rawEmailId: text('raw_email_id'),
  description: text('description'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  tradeDateIdx: index('idx_finance_trades_trade_date').on(table.tradeDate),
  rawEmailIdIdx: index('idx_finance_trades_raw_email_id').on(table.rawEmailId),
  symbolIdx: index('idx_finance_trades_symbol').on(table.symbol),
}))

export const financeTransactions = sqliteTable('finance_transactions', {
  id: text('id').primaryKey(),
  amount: text('amount').notNull(),
  currency: text('currency').notNull().default('ILS'),
  direction: text('direction').notNull(), // 'income' | 'expense'
  category: text('category'),
  description: text('description'),
  transactionDate: text('transaction_date').notNull(),
  source: text('source').notNull(), // 'csv_import' | 'manual'
  rawData: text('raw_data'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  transactionDateIdx: index('idx_finance_transactions_date').on(table.transactionDate),
  directionIdx: index('idx_finance_transactions_direction').on(table.direction),
}))

// ─── Feed (עדכוני כלכלה וחדשות) ───────────────────────────────────────────

export const feedSources = sqliteTable('feed_sources', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  url: text('url').notNull(),
  category: text('category').notNull(), // 'economics' | 'us_market' | 'ai_tech' | 'israel_market'
  createdAt: text('created_at').notNull(),
})

export const feedItems = sqliteTable('feed_items', {
  id: text('id').primaryKey(),
  sourceId: text('source_id').notNull().references(() => feedSources.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  link: text('link').notNull(),
  summary: text('summary'),
  publishedAt: text('published_at').notNull(),
  tags: text('tags'), // JSON array of strings, e.g. ["us_market","ai"]
  createdAt: text('created_at').notNull(),
}, (table) => ({
  sourceIdIdx: index('idx_feed_items_source_id').on(table.sourceId),
  linkIdx: uniqueIndex('idx_feed_items_link').on(table.link),
  publishedAtIdx: index('idx_feed_items_published_at').on(table.publishedAt),
}))

// ─── Facts (knowledge base / memory for conversation engine) ───────────────────

export const facts = sqliteTable('facts', {
  id: text('id').primaryKey(),
  content: text('content').notNull(),
  source: text('source').notNull().default('conversation'), // 'conversation' | 'manual' | 'report'
  createdAt: text('created_at').notNull(),
})

export type Fact = typeof facts.$inferSelect
export type NewFact = typeof facts.$inferInsert

// ─── Hugo memory (custom instructions + memories/knowledge) ────────────────────

/** Standing custom instructions injected into every agent run. Single row id='default'. */
export const hugoInstructions = sqliteTable('hugo_instructions', {
  id: text('id').primaryKey(),
  content: text('content').notNull().default(''),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  updatedAt: text('updated_at').notNull(),
})

export const MEMORY_KINDS = ['instruction', 'memory', 'knowledge'] as const
export type MemoryKind = (typeof MEMORY_KINDS)[number]
export const MEMORY_SOURCES = ['manual', 'auto', 'chat'] as const
export type MemorySource = (typeof MEMORY_SOURCES)[number]

/** Discrete memories / knowledge items injected (pinned + recent) into agent prompts. */
export const memories = sqliteTable('memories', {
  id: text('id').primaryKey(),
  content: text('content').notNull(),
  kind: text('kind').notNull().default('memory'), // instruction | memory | knowledge
  source: text('source').notNull().default('manual'), // manual | auto | chat
  pinned: integer('pinned', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  kindIdx: index('idx_memories_kind').on(table.kind),
  pinnedIdx: index('idx_memories_pinned').on(table.pinned, table.updatedAt),
}))

export type HugoInstruction = typeof hugoInstructions.$inferSelect
export type NewHugoInstruction = typeof hugoInstructions.$inferInsert
export type Memory = typeof memories.$inferSelect
export type NewMemory = typeof memories.$inferInsert

// ─── User settings (agent preferences, persisted server-side) ─────────────────

/** Single-row preferences (id='default'). */
export const userSettings = sqliteTable('user_settings', {
  id: text('id').primaryKey(),
  agentCalendarIds: text('agent_calendar_ids'), // JSON string[] or null = all calendars
  updatedAt: text('updated_at').notNull(),
})

export type UserSettings = typeof userSettings.$inferSelect
export type NewUserSettings = typeof userSettings.$inferInsert

// ─── Chat messages (web chat + telegram + cron push) ──────────────────────────

export const chatMessages = sqliteTable('chat_messages', {
  id: text('id').primaryKey(),
  role: text('role').notNull(), // 'user' | 'assistant' | 'system'
  content: text('content').notNull(),
  source: text('source').notNull().default('web'), // 'web' | 'telegram' | 'whatsapp' | 'cron'
  createdAt: text('created_at').notNull(),
})

export type ChatMessage = typeof chatMessages.$inferSelect
export type NewChatMessage = typeof chatMessages.$inferInsert

// ─── ABC agent chat (Cursor SDK) ─────────────────────────────────────────────

export const agentThreads = sqliteTable('agent_threads', {
  agentId: text('agent_id').primaryKey(),
  cursorAgentId: text('cursor_agent_id').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const agentMessages = sqliteTable('agent_messages', {
  id: text('id').primaryKey(),
  agentId: text('agent_id').notNull(),
  role: text('role').notNull(), // 'user' | 'assistant' | 'system'
  content: text('content').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  agentIdIdx: index('idx_agent_messages_agent_id').on(table.agentId),
}))

export type AgentThread = typeof agentThreads.$inferSelect
export type NewAgentThread = typeof agentThreads.$inferInsert
export type AgentMessage = typeof agentMessages.$inferSelect
export type NewAgentMessage = typeof agentMessages.$inferInsert

// ─── ABC agent triggers (scheduled / manual runs) ─────────────────────────────

export const agentTriggers = sqliteTable('agent_triggers', {
  agentId: text('agent_id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  scheduleTimes: text('schedule_times').notNull().default('[]'), // JSON ["07:00"]
  triggerMessage: text('trigger_message'),
  lastRunAt: text('last_run_at'),
  lastRunStatus: text('last_run_status'), // 'ok' | 'error'
  lastRunError: text('last_run_error'),
  updatedAt: text('updated_at').notNull(),
})

export type AgentTrigger = typeof agentTriggers.$inferSelect
export type NewAgentTrigger = typeof agentTriggers.$inferInsert

// ─── Health (heart rate, sleep — for meeting correlation) ─────────────────────

export const healthMetrics = sqliteTable('health_metrics', {
  id: text('id').primaryKey(),
  type: text('type').notNull(), // 'heart_rate' | 'sleep_quality' | 'activity'
  value: text('value').notNull(), // number as string
  at: text('at').notNull(), // ISO timestamp
  source: text('source').notNull().default('manual'), // 'garmin' | 'apple_health' | 'manual' | 'csv'
  createdAt: text('created_at').notNull(),
})

export type HealthMetric = typeof healthMetrics.$inferSelect
export type NewHealthMetric = typeof healthMetrics.$inferInsert

// ─── VAT entries (bimonthly tax reporting) ──────────────────────────────────

export const vatEntries = sqliteTable('vat_entries', {
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
  isVatExempt: integer('is_vat_exempt', { mode: 'boolean' }).notNull().default(false),
  deductionPercent: text('deduction_percent'),
  dollarRate: text('dollar_rate'),
  invoiceFileUrl: text('invoice_file_url'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  yearPeriodIdx: index('idx_vat_entries_year_period').on(table.year, table.period),
  dateIdx: index('idx_vat_entries_date').on(table.date),
  taxCodeIdx: index('idx_vat_entries_tax_code').on(table.taxCode),
}))

export type VatEntry = typeof vatEntries.$inferSelect
export type NewVatEntry = typeof vatEntries.$inferInsert

// ─── Push subscriptions (Web Push API) ──────────────────────────────────────

export const pushSubscriptions = sqliteTable('push_subscriptions', {
  id: text('id').primaryKey(),
  endpoint: text('endpoint').notNull(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  endpointIdx: uniqueIndex('idx_push_subscriptions_endpoint').on(table.endpoint),
}))

export type PushSubscription = typeof pushSubscriptions.$inferSelect
export type NewPushSubscription = typeof pushSubscriptions.$inferInsert

// ─── Expo push tokens (Helm mobile app) ──────────────────────────────────────

export const expoPushTokens = sqliteTable('expo_push_tokens', {
  id: text('id').primaryKey(),
  token: text('token').notNull().unique(),
  createdAt: text('created_at').notNull(),
})

export type ExpoPushToken = typeof expoPushTokens.$inferSelect
export type NewExpoPushToken = typeof expoPushTokens.$inferInsert

// ─── In-app notifications ─────────────────────────────────────────────────────

export const notifications = sqliteTable('notifications', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  url: text('url').notNull(),
  type: text('type').notNull(), // cron | agent | fomo | hugo | system
  readAt: text('read_at'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  unreadIdx: index('idx_notifications_unread').on(table.readAt, table.createdAt),
}))

export type Notification = typeof notifications.$inferSelect
export type NewNotification = typeof notifications.$inferInsert

// ─── WhatsApp settings (groups + labels) ─────────────────────────────────────

export const whatsappLabels = sqliteTable('whatsapp_labels', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  summaryTimes: text('summary_times').notNull().default('[]'), // JSON ["20:00"]
  createdAt: text('created_at').notNull(),
})

export const whatsappGroups = sqliteTable('whatsapp_groups', {
  id: text('id').primaryKey(),
  jid: text('jid').notNull().unique(),
  name: text('name').notNull(),
  labelId: text('label_id').references(() => whatsappLabels.id, { onDelete: 'set null' }),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(false),
  fomoEnabled: integer('fomo_enabled', { mode: 'boolean' }).notNull().default(false),
  fomoThreshold: integer('fomo_threshold').notNull().default(5),
  fomoWindowMinutes: integer('fomo_window_minutes').notNull().default(5),
  summaryTimes: text('summary_times'), // JSON nullable override
  keywords: text('keywords').notNull().default('[]'), // JSON string[]
  lastFomoAlertAt: text('last_fomo_alert_at'),
  updatedAt: text('updated_at').notNull(),
})

export type WhatsappLabel = typeof whatsappLabels.$inferSelect
export type NewWhatsappLabel = typeof whatsappLabels.$inferInsert
export type WhatsappGroup = typeof whatsappGroups.$inferSelect
export type NewWhatsappGroup = typeof whatsappGroups.$inferInsert

// ─── Notification preferences (per type × channel routing) ───────────────────

export const notificationPreferences = sqliteTable('notification_preferences', {
  typeId: text('type_id').primaryKey(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  channelWhatsapp: integer('channel_whatsapp', { mode: 'boolean' }).notNull().default(true),
  channelPush: integer('channel_push', { mode: 'boolean' }).notNull().default(true),
  channelTelegram: integer('channel_telegram', { mode: 'boolean' }).notNull().default(true),
  scheduleTimes: text('schedule_times'), // JSON ["07:00"] — schedulable types only
  lastSentAt: text('last_sent_at'), // per-slot dedup for schedulable types
  updatedAt: text('updated_at').notNull(),
})

export type NotificationPreference = typeof notificationPreferences.$inferSelect
export type NewNotificationPreference = typeof notificationPreferences.$inferInsert

export type Person = typeof people.$inferSelect
export type NewPerson = typeof people.$inferInsert
export type Project = typeof projects.$inferSelect
export type NewProject = typeof projects.$inferInsert
export type Meeting = typeof meetings.$inferSelect
export type NewMeeting = typeof meetings.$inferInsert
export type Task = typeof tasks.$inferSelect
export type NewTask = typeof tasks.$inferInsert
export type FinanceTrade = typeof financeTrades.$inferSelect
export type NewFinanceTrade = typeof financeTrades.$inferInsert
export type FinanceTransaction = typeof financeTransactions.$inferSelect
export type NewFinanceTransaction = typeof financeTransactions.$inferInsert
export type FeedSource = typeof feedSources.$inferSelect
export type NewFeedSource = typeof feedSources.$inferInsert
export type FeedItem = typeof feedItems.$inferSelect
export type NewFeedItem = typeof feedItems.$inferInsert

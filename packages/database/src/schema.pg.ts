import { pgTable, text, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core'

export const people = pgTable('people', {
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

export const projects = pgTable('projects', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  color: text('color').default('#47b8e8'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

/** Meeting category for daily summary (Work/Family/General) */
export const MEETING_CATEGORIES = ['work', 'family', 'general'] as const
export type MeetingCategory = (typeof MEETING_CATEGORIES)[number]

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
  calendarEventId: text('calendar_event_id'),
  calendarSource: text('calendar_source'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  dateIdx: index('idx_meetings_date').on(table.date),
  projectIdIdx: index('idx_meetings_project_id').on(table.projectId),
  calendarEventIdIdx: index('idx_meetings_calendar_event_id').on(table.calendarEventId),
}))

export const meetingPeople = pgTable('meeting_people', {
  meetingId: text('meeting_id').notNull().references(() => meetings.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id, { onDelete: 'cascade' }),
}, (table) => ({
  meetingIdIdx: index('idx_meeting_people_meeting_id').on(table.meetingId),
  personIdIdx: index('idx_meeting_people_person_id').on(table.personId),
}))

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  meetingId: text('meeting_id').references(() => meetings.id, { onDelete: 'set null' }),
  projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
  assigneeId: text('assignee_id').references(() => people.id, { onDelete: 'set null' }),
  dueDate: text('due_date'),
  done: boolean('done').notNull().default(false),
  priority: text('priority').notNull().default('medium'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
}, (table) => ({
  meetingIdIdx: index('idx_tasks_meeting_id').on(table.meetingId),
  projectIdIdx: index('idx_tasks_project_id').on(table.projectId),
  assigneeIdIdx: index('idx_tasks_assignee_id').on(table.assigneeId),
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
  createdAt: text('created_at').notNull(),
}, (table) => ({
  tradeDateIdx: index('idx_finance_trades_trade_date').on(table.tradeDate),
  rawEmailIdIdx: index('idx_finance_trades_raw_email_id').on(table.rawEmailId),
  symbolIdx: index('idx_finance_trades_symbol').on(table.symbol),
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
  createdAt: text('created_at').notNull(),
}, (table) => ({
  transactionDateIdx: index('idx_finance_transactions_date').on(table.transactionDate),
  directionIdx: index('idx_finance_transactions_direction').on(table.direction),
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
  createdAt: text('created_at').notNull(),
}, (table) => ({
  yearPeriodIdx: index('idx_vat_entries_year_period').on(table.year, table.period),
  dateIdx: index('idx_vat_entries_date').on(table.date),
  taxCodeIdx: index('idx_vat_entries_tax_code').on(table.taxCode),
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

export const notifications = pgTable('notifications', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  url: text('url').notNull(),
  type: text('type').notNull(),
  readAt: text('read_at'),
  createdAt: text('created_at').notNull(),
}, (table) => ({
  unreadIdx: index('idx_notifications_unread').on(table.readAt, table.createdAt),
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
  updatedAt: text('updated_at').notNull(),
})

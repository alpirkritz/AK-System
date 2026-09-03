import { createTrpcClient } from './trpc'

export type MobilePerson = {
  id: string
  name: string
  color?: string | null
  role?: string | null
  company?: string | null
}

export type MobileTask = {
  id: string
  title: string
  done: boolean
  /** Canonical status; `done` is derived from it. Older rows may omit it. */
  status?: string | null
  priority: 'high' | 'medium' | 'low'
  dueDate?: string | null
  meetingId?: string | null
  projectId?: string | null
  workspaceId?: string | null
  assigneeId?: string | null
  /** 'manual' | 'notion' — Notion tasks mirror status changes back to Notion. */
  source?: string | null
  notionPageId?: string | null
  notionStatusRaw?: string | null
}

export type MobileWorkspace = {
  id: string
  name: string
  color?: string | null
  notionDatabases?: Array<{ id: string; notionDatabaseId: string; notionDatabaseName: string | null }>
}

/** Result of mirroring a status change to Notion; `null` for manual tasks. */
export type NotionSyncResult =
  | { ok: true; label: string }
  | { ok: false; reason: string; message?: string }
  | null

export type TaskInput = {
  title: string
  status?: string
  priority?: 'high' | 'medium' | 'low'
  dueDate?: string | null
  workspaceId?: string | null
  /** Omit to let the server default to the owner; `null` means nobody. */
  assigneeId?: string | null
  meetingId?: string | null
  projectId?: string | null
}

/** Counters returned by a manual Notion tasks sync. */
export type NotionTasksSyncResult = {
  peopleCreated: number
  peopleUpdated: number
  tasksCreated: number
  tasksUpdated: number
  tasksSkipped: number
  tasksPruned: number
  errors: string[]
}

export type MobileMeeting = {
  id: string
  title: string
  date: string
  time: string
  recurring?: string | null
  recurrenceDay?: string | null
  peopleIds?: string[]
  taskIds?: string[]
  notes?: string | null
  seriesId?: string | null
}

export type MobileMeetingSeries = {
  id: string
  title: string
  rollingNotes?: string | null
}

export type MobileReviewPerson = MobilePerson & {
  meetingCount?: number
  suggestedMatch?: { id: string; name: string } | null
}

export async function fetchPeople(token: string): Promise<MobilePerson[]> {
  const client = createTrpcClient(token)
  return (await client.people.list.query()) as MobilePerson[]
}

/** The contact row representing the app owner, used to default the assignee. */
export async function fetchSelfPerson(token: string): Promise<MobilePerson> {
  const client = createTrpcClient(token)
  return (await client.people.me.query()) as MobilePerson
}

export async function fetchTasks(token: string): Promise<MobileTask[]> {
  const client = createTrpcClient(token)
  return (await client.tasks.list.query()) as MobileTask[]
}

export async function fetchTask(token: string, id: string): Promise<MobileTask | null> {
  const client = createTrpcClient(token)
  return (await client.tasks.getById.query({ id })) as MobileTask | null
}

export async function fetchWorkspaces(token: string): Promise<MobileWorkspace[]> {
  const client = createTrpcClient(token)
  return (await client.workspaces.list.query()) as MobileWorkspace[]
}

export async function createTask(
  token: string,
  input: TaskInput,
): Promise<MobileTask & { notionSync?: NotionSyncResult }> {
  const client = createTrpcClient(token)
  return (await client.tasks.create.mutate(input)) as MobileTask & { notionSync?: NotionSyncResult }
}

export async function updateTask(
  token: string,
  id: string,
  input: Partial<TaskInput>,
): Promise<MobileTask & { notionSync?: NotionSyncResult }> {
  const client = createTrpcClient(token)
  return (await client.tasks.update.mutate({ id, ...input })) as MobileTask & {
    notionSync?: NotionSyncResult
  }
}

export async function toggleTaskDone(
  token: string,
  id: string,
): Promise<MobileTask & { notionSync?: NotionSyncResult }> {
  const client = createTrpcClient(token)
  return (await client.tasks.toggleDone.mutate({ id })) as MobileTask & {
    notionSync?: NotionSyncResult
  }
}

export async function fetchNotionConfigured(token: string): Promise<boolean> {
  const client = createTrpcClient(token)
  const res = (await client.tasks.notionConfigured.query()) as { configured: boolean }
  return res.configured
}

export async function syncTasksFromNotion(token: string): Promise<NotionTasksSyncResult> {
  const client = createTrpcClient(token)
  return (await client.tasks.syncFromNotion.mutate({
    windowDays: 60,
    dryRun: false,
  })) as NotionTasksSyncResult
}

export async function fetchMeetings(token: string): Promise<MobileMeeting[]> {
  const client = createTrpcClient(token)
  return (await client.meetings.list.query()) as MobileMeeting[]
}

export type MobileReadingListItem = {
  id: string
  url: string
  title: string
  note?: string | null
  status: string
  createdAt: string
  readAt?: string | null
}

export async function fetchReadingList(token: string): Promise<MobileReadingListItem[]> {
  const client = createTrpcClient(token)
  return (await client.readingList.list.query({ status: 'all' })) as MobileReadingListItem[]
}

export async function createReadingListItem(
  token: string,
  input: { url: string; title: string; note?: string },
): Promise<MobileReadingListItem> {
  const client = createTrpcClient(token)
  return (await client.readingList.create.mutate(input)) as MobileReadingListItem
}

export async function markReadingListItemRead(
  token: string,
  id: string,
  read: boolean,
): Promise<MobileReadingListItem> {
  const client = createTrpcClient(token)
  return (await client.readingList.markRead.mutate({ id, read })) as MobileReadingListItem
}

export async function deleteReadingListItem(token: string, id: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.readingList.delete.mutate({ id })
}

// ─── Dashboard prefs ─────────────────────────────────────────────────────────

export type MobileDashboardPrefs = {
  meetingWindow: 'today' | '3days' | 'week'
  taskWindow: 'today' | 'all'
}

export async function fetchDashboardPrefs(token: string): Promise<MobileDashboardPrefs> {
  const client = createTrpcClient(token)
  return (await client.settings.dashboard.get.query()) as MobileDashboardPrefs
}

export async function setDashboardPrefs(
  token: string,
  patch: Partial<MobileDashboardPrefs>,
): Promise<MobileDashboardPrefs> {
  const client = createTrpcClient(token)
  return (await client.settings.dashboard.set.mutate(patch)) as MobileDashboardPrefs
}

// ─── Agents (tRPC) ───────────────────────────────────────────────────────────

export type MobileAgentConfig = {
  agentId: string
  name: string
  role: string
  enabled: boolean
  scheduleTimes: string[]
  triggerMessage: string | null
  defaultTriggerMessage: string
  suggestedScheduleTimes: string[]
  subscribedEvents: string[]
  lastRunAt: string | null
  lastRunStatus: string | null
  lastRunError: string | null
}

export type MobileRoutableEvent = {
  typeId: string
  label: string
  description: string
  schedulable: boolean
  scheduleTimes: string[]
  routedAgentId: string | null
  suggestedAgentId: string | null
}

export async function fetchAgentConfigs(
  token: string,
): Promise<{ agents: MobileAgentConfig[]; events: MobileRoutableEvent[] }> {
  const client = createTrpcClient(token)
  return (await client.agents.list.query()) as {
    agents: MobileAgentConfig[]
    events: MobileRoutableEvent[]
  }
}

export async function setAgentSchedule(
  token: string,
  input: {
    agentId: string
    enabled?: boolean
    scheduleTimes?: string[]
    triggerMessage?: string | null
  },
): Promise<MobileAgentConfig> {
  const client = createTrpcClient(token)
  return (await client.agents.setSchedule.mutate(input)) as MobileAgentConfig
}

export async function setAgentEventSubscription(
  token: string,
  input: { agentId: string; typeId: string; subscribed: boolean },
): Promise<{ typeId: string; routedAgentId: string | null }> {
  const client = createTrpcClient(token)
  return (await client.agents.setEventSubscription.mutate(input)) as {
    typeId: string
    routedAgentId: string | null
  }
}

export async function runAgent(
  token: string,
  agentId: string,
): Promise<{ ok: boolean; text?: string; error?: string }> {
  const client = createTrpcClient(token)
  return (await client.agents.run.mutate({ agentId })) as {
    ok: boolean
    text?: string
    error?: string
  }
}

export async function setAgentDisplayName(
  token: string,
  agentId: string,
  displayName: string | null,
): Promise<void> {
  const client = createTrpcClient(token)
  await client.settings.agentDisplayNames.set.mutate({ agentId, displayName })
}

// ─── Meetings ────────────────────────────────────────────────────────────────

export async function fetchMeeting(
  token: string,
  id: string,
): Promise<MobileMeeting | null> {
  const client = createTrpcClient(token)
  return (await client.meetings.getById.query({ id })) as MobileMeeting | null
}

export async function createMeeting(
  token: string,
  input: Record<string, unknown>,
): Promise<MobileMeeting> {
  const client = createTrpcClient(token)
  return (await client.meetings.create.mutate(input)) as MobileMeeting
}

export async function updateMeeting(
  token: string,
  input: Record<string, unknown>,
): Promise<MobileMeeting> {
  const client = createTrpcClient(token)
  return (await client.meetings.update.mutate(input)) as MobileMeeting
}

export async function deleteMeeting(token: string, id: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.meetings.delete.mutate({ id })
}

export async function syncMeetingsFromCalendar(
  token: string,
): Promise<{ created: number; updated: number; deleted: number }> {
  const client = createTrpcClient(token)
  const today = new Date()
  const start = new Date(today)
  start.setDate(start.getDate() - 30)
  const end = new Date(today)
  end.setDate(end.getDate() + 90)
  const fmt = (d: Date) => {
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${d.getFullYear()}-${m}-${day}`
  }
  return (await client.meetings.syncFromCalendar.mutate({
    startDate: fmt(start),
    endDate: fmt(end),
  })) as {
    created: number
    updated: number
    deleted: number
  }
}

export async function updateSeriesNotes(
  token: string,
  seriesId: string,
  rollingNotes: string,
): Promise<void> {
  const client = createTrpcClient(token)
  await client.meetings.updateSeriesNotes.mutate({ id: seriesId, rollingNotes })
}

export async function fetchMeetingSeries(
  token: string,
  seriesId: string,
): Promise<MobileMeetingSeries | null> {
  const client = createTrpcClient(token)
  const res = (await client.meetings.getSeries.query({ id: seriesId })) as {
    id: string
    title: string
    rollingNotes?: string | null
  } | null
  if (!res) return null
  return { id: res.id, title: res.title, rollingNotes: res.rollingNotes ?? null }
}

// ─── Calendar ────────────────────────────────────────────────────────────────

export type MobileCalEvent = {
  id: string
  title: string
  start: string
  end: string
  isAllDay?: boolean
  status?: string
  rsvp?: string
  calendarId?: string | null
  color?: string
}

export async function fetchCalendarEvents(
  token: string,
  startDate: string,
  endDate: string,
): Promise<MobileCalEvent[]> {
  const client = createTrpcClient(token)
  const res = (await client.calendar.events.query({ startDate, endDate })) as {
    events?: MobileCalEvent[]
  } | MobileCalEvent[]
  return Array.isArray(res) ? res : (res.events ?? [])
}

export async function fetchCalendarConflicts(
  token: string,
  startDate: string,
  endDate: string,
): Promise<unknown[]> {
  const client = createTrpcClient(token)
  const res = (await client.calendar.conflicts.query({ startDate, endDate })) as {
    conflicts?: unknown[]
  } | unknown[]
  return Array.isArray(res) ? res : (res.conflicts ?? [])
}

export type GoogleAccountStatus = {
  email: string
  status: 'ok' | 'error' | 'unknown'
  error?: string
}

export async function fetchGoogleCalendarAccounts(token: string): Promise<GoogleAccountStatus[]> {
  const client = createTrpcClient(token)
  type HealthRow = { email: string; status: string; error?: string }
  const [accountsRes, healthRes] = await Promise.all([
    client.calendar.googleAccounts.query() as Promise<{
      accounts?: Array<{ email: string; isActive?: boolean }>
    }>,
    client.calendar.googleHealth.query().catch(() => ({ accounts: [] as HealthRow[] })) as Promise<{
      accounts?: HealthRow[]
    }>,
  ])
  const healthByEmail = new Map(
    (healthRes.accounts ?? []).map((row: HealthRow) => [row.email.toLowerCase(), row]),
  )
  return (accountsRes.accounts ?? []).map((account) => {
    const health = healthByEmail.get(account.email.toLowerCase())
    if (!health) return { email: account.email, status: 'unknown' as const }
    return {
      email: account.email,
      status: health.status === 'ok' ? ('ok' as const) : ('error' as const),
      error: health.error,
    }
  })
}

export async function startGoogleCalendarOAuth(
  token: string,
  hint?: string,
): Promise<{ authUrl: string }> {
  const client = createTrpcClient(token)
  return client.calendar.startGoogleOAuth.mutate({
    returnTo: 'mobile',
    hint,
  }) as Promise<{ authUrl: string }>
}

// ─── People ──────────────────────────────────────────────────────────────────

export async function fetchPeoplePaginated(
  token: string,
  input: { page?: number; pageSize?: number; search?: string } = {},
): Promise<{ items: MobilePerson[]; total: number }> {
  const client = createTrpcClient(token)
  const res = (await client.people.listPaginated.query({
    page: input.page ?? 1,
    pageSize: input.pageSize ?? 50,
    search: input.search,
  })) as { items?: MobilePerson[]; rows?: MobilePerson[]; total?: number }
  return { items: res.items ?? res.rows ?? [], total: res.total ?? 0 }
}

export async function fetchPerson(token: string, id: string): Promise<MobilePerson | null> {
  const client = createTrpcClient(token)
  return (await client.people.getById.query({ id })) as MobilePerson | null
}

export async function fetchPersonRelated(token: string, id: string): Promise<unknown> {
  const client = createTrpcClient(token)
  return client.people.getRelated.query({ id })
}

export async function fetchReviewQueue(token: string): Promise<MobileReviewPerson[]> {
  const client = createTrpcClient(token)
  return (await client.people.reviewQueue.query()) as MobileReviewPerson[]
}

export async function confirmPerson(token: string, id: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.people.confirm.mutate({ id })
}

export async function ignorePerson(token: string, id: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.people.ignore.mutate({ id })
}

export async function createPerson(
  token: string,
  input: { name: string; role?: string; company?: string },
): Promise<MobilePerson> {
  const client = createTrpcClient(token)
  return (await client.people.create.mutate(input)) as MobilePerson
}

export async function updatePerson(
  token: string,
  input: { id: string; name?: string; role?: string | null; company?: string | null },
): Promise<MobilePerson> {
  const client = createTrpcClient(token)
  return (await client.people.update.mutate(input)) as MobilePerson
}

export async function deletePerson(token: string, id: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.people.delete.mutate({ id })
}

// ─── Projects ────────────────────────────────────────────────────────────────

export type MobileProject = {
  id: string
  name: string
  color?: string | null
  status?: string | null
  description?: string | null
}

export async function fetchProjects(token: string): Promise<MobileProject[]> {
  const client = createTrpcClient(token)
  return (await client.projects.list.query()) as MobileProject[]
}

export async function fetchProject(token: string, id: string): Promise<MobileProject | null> {
  const client = createTrpcClient(token)
  return (await client.projects.getById.query({ id })) as MobileProject | null
}

export async function createProject(
  token: string,
  input: { name: string; color?: string; description?: string },
): Promise<MobileProject> {
  const client = createTrpcClient(token)
  return (await client.projects.create.mutate(input)) as MobileProject
}

export async function updateProject(
  token: string,
  input: { id: string; name?: string; color?: string | null; description?: string | null },
): Promise<MobileProject> {
  const client = createTrpcClient(token)
  return (await client.projects.update.mutate(input)) as MobileProject
}

export async function deleteProject(token: string, id: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.projects.delete.mutate({ id })
}

// ─── Finance / VAT (subset) ──────────────────────────────────────────────────

export async function fetchFinanceSummary(token: string): Promise<Record<string, unknown>> {
  const client = createTrpcClient(token)
  return (await client.finance.getSummary.query()) as Record<string, unknown>
}

export async function fetchFinanceTransactions(
  token: string,
  limit = 50,
): Promise<unknown[]> {
  const client = createTrpcClient(token)
  const res = (await client.finance.listTransactions.query({ limit })) as
    | unknown[]
    | { items?: unknown[] }
  return Array.isArray(res) ? res : (res.items ?? [])
}

export async function setTransactionCategory(
  token: string,
  input: { id: string; category: string; applyToSimilar?: boolean },
): Promise<void> {
  const client = createTrpcClient(token)
  await client.finance.setTransactionCategory.mutate(input)
}

export async function fetchTradingJournal(token: string): Promise<Record<string, unknown>> {
  const client = createTrpcClient(token)
  return (await client.finance.getTradingJournal.query({})) as Record<string, unknown>
}

export async function fetchAccountsSnapshot(token: string): Promise<unknown> {
  const client = createTrpcClient(token)
  return client.finance.getAccountsSnapshot.query()
}

export async function fetchFinanceInsights(token: string, month?: string): Promise<unknown> {
  const client = createTrpcClient(token)
  const m = month ?? currentMonthKey()
  return client.finance.analytics.insights.query({ month: m })
}

export async function fetchFinanceNarrative(token: string): Promise<unknown> {
  const client = createTrpcClient(token)
  return client.finance.analytics.narrative.query({ scope: 'cashflow' })
}

function currentMonthKey(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export async function fetchFinanceCoverage(token: string): Promise<unknown> {
  const client = createTrpcClient(token)
  return client.finance.analytics.coverage.query()
}

export async function fetchVatPeriodSummary(
  token: string,
  year: number,
  period: number,
): Promise<unknown> {
  const client = createTrpcClient(token)
  return client.vat.periodSummary.query({ year, period })
}

export async function parseInvoice(
  token: string,
  fileBase64: string,
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png',
): Promise<unknown> {
  const client = createTrpcClient(token)
  return client.vat.parseInvoice.mutate({ fileBase64, mimeType })
}

export async function createVatEntry(
  token: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  const client = createTrpcClient(token)
  return client.vat.create.mutate(input)
}

// ─── Memory / Feed ───────────────────────────────────────────────────────────

export async function fetchHugoInstructions(
  token: string,
): Promise<{ content: string; enabled: boolean }> {
  const client = createTrpcClient(token)
  return (await client.memory.instructions.get.query()) as { content: string; enabled: boolean }
}

export async function setHugoInstructions(
  token: string,
  content: string,
  enabled = true,
): Promise<void> {
  const client = createTrpcClient(token)
  await client.memory.instructions.set.mutate({ content, enabled })
}

export type MobileMemory = {
  id: string
  content: string
  pinned?: boolean
  kind?: string
  updatedAt?: string
}

export async function fetchMemories(token: string): Promise<MobileMemory[]> {
  const client = createTrpcClient(token)
  return (await client.memory.memories.list.query({})) as MobileMemory[]
}

export async function createMemory(token: string, content: string): Promise<MobileMemory> {
  const client = createTrpcClient(token)
  return (await client.memory.memories.create.mutate({ content })) as MobileMemory
}

export async function toggleMemoryPin(
  token: string,
  id: string,
  pinned: boolean,
): Promise<void> {
  const client = createTrpcClient(token)
  await client.memory.memories.togglePin.mutate({ id, pinned })
}

export async function deleteMemory(token: string, id: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.memory.memories.delete.mutate({ id })
}

export type MobileFeedItem = {
  id: string
  title: string
  url?: string | null
  summary?: string | null
  category?: string | null
  publishedAt?: string | null
}

export async function fetchFeedItems(token: string): Promise<MobileFeedItem[]> {
  const client = createTrpcClient(token)
  const res = (await client.feed.list.query({ limit: 50 })) as
    | MobileFeedItem[]
    | { items?: MobileFeedItem[] }
  return Array.isArray(res) ? res : (res.items ?? [])
}

export async function syncFeed(token: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.feed.sync.mutate()
}

// ─── Settings notifications / workspaces / meeting types ─────────────────────

export async function fetchNotificationPrefs(token: string): Promise<unknown> {
  const client = createTrpcClient(token)
  return client.settings.notifications.list.query()
}

export async function upsertNotificationPref(
  token: string,
  input: Record<string, unknown>,
): Promise<void> {
  const client = createTrpcClient(token)
  await client.settings.notifications.upsert.mutate(input)
}

export async function deleteTask(token: string, id: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.tasks.delete.mutate({ id })
}

export async function createWorkspace(
  token: string,
  input: { name: string; color?: string },
): Promise<MobileWorkspace> {
  const client = createTrpcClient(token)
  return (await client.workspaces.create.mutate(input)) as MobileWorkspace
}

export async function updateWorkspace(
  token: string,
  input: { id: string; name?: string; color?: string | null },
): Promise<MobileWorkspace> {
  const client = createTrpcClient(token)
  return (await client.workspaces.update.mutate(input)) as MobileWorkspace
}

export async function deleteWorkspace(token: string, id: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.workspaces.delete.mutate({ id })
}

export type MobileMeetingType = { id: string; name: string; color?: string | null }

export async function fetchMeetingTypes(token: string): Promise<MobileMeetingType[]> {
  const client = createTrpcClient(token)
  return (await client.meetingTypes.list.query()) as MobileMeetingType[]
}

export async function createMeetingType(
  token: string,
  input: { name: string; color?: string },
): Promise<MobileMeetingType> {
  const client = createTrpcClient(token)
  return (await client.meetingTypes.create.mutate(input)) as MobileMeetingType
}

export async function deleteMeetingType(token: string, id: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.meetingTypes.delete.mutate({ id })
}

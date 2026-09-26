import { createTrpcClient } from './trpc'
import {
  mapFeedDigest,
  mapFeedItems,
  type FeedCategory,
  type FeedListCategory,
  type FeedSyncResult,
  type MobileFeedDigest,
  type MobileFeedItem,
} from './feed'

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

export interface MobileWarmthPoint {
  meetingId: string
  date: string
  title: string
  score: number | null
  sentiment: number
}

export interface MobilePersonContext {
  recommendation: string | null
  warmthTrend: 'warming' | 'cooling' | 'stable' | null
  warmth: {
    trend: 'warming' | 'cooling' | 'stable' | null
    recentAvg: number | null
    olderAvg: number | null
    count: number
    timeline: MobileWarmthPoint[]
  }
  openLoops: { content: string; meetingId: string; meetingDate: string }[]
  whatsappSinceCount: number
  lastNotionMeetingDate: string | null
  circles: { seriesId: string; seriesTitle: string }[]
  captureWhatsapp: boolean
  captureReachable: boolean
  dmSummary: string | null
  proposedCommitmentCount: number
  emailThreads: { id: string; subject: string; date: string; snippet: string | null; gmailUrl: string | null }[]
  voiceRecordings: { id: string; createdAt: string; duration: number; status: string; topic: string | null; meetingId: string | null }[]
  traits: MobileTraitSummary
}

export interface MobileTraitSummary {
  traits: { id: string; label: string; line: string; supportCount: number }[]
  traitsAt: string | null
  stale: boolean
  hasSources: boolean
  sourceCount: number
  evidenceCount: number
}

export interface MobileTraitDetail {
  shown: { id: string; label: string; reasoning: string; supportCount: number; evidence: { observationId: string; sourceKind: string; sourceDate: string; quote: string | null; href: string | null }[] }[]
  once: { id: string; label: string; evidence: { sourceKind: string; sourceDate: string; quote: string | null }[] }[]
}

export interface MobileRelationshipFlag {
  personId: string
  name: string
  trend: 'warming' | 'cooling'
  recentAvg: number | null
  olderAvg: number | null
}

export interface MobileBoardCard {
  id: string
  name: string
  trend: 'warming' | 'cooling'
  recentAvg: number | null
  olderAvg: number | null
  dataReason: string
  note: string | null
  timeline: { meetingId: string; date: string; title: string; score: number | null; sentiment: number }[]
}

export async function fetchRelationshipBoard(token: string): Promise<{ people: MobileBoardCard[]; circles: MobileBoardCard[] }> {
  const client = createTrpcClient(token)
  const res = (await client.insights.relationshipBoard.query()) as { people: MobileBoardCard[]; circles: MobileBoardCard[] }
  return { people: res.people ?? [], circles: res.circles ?? [] }
}

export async function saveWarmthNote(
  token: string,
  input: { subject: 'person' | 'circle'; id: string; note: string | null },
): Promise<void> {
  const client = createTrpcClient(token)
  await client.insights.setWarmthNote.mutate(input)
}

export async function fetchRelationshipFlags(token: string): Promise<{ cooling: MobileRelationshipFlag[]; warming: MobileRelationshipFlag[] }> {
  const client = createTrpcClient(token)
  const res = (await client.insights.relationshipFlags.query()) as {
    cooling: MobileRelationshipFlag[]
    warming: MobileRelationshipFlag[]
  }
  return {
    cooling: res.cooling ?? [],
    warming: res.warming ?? [],
  }
}

export async function fetchPersonContext(token: string, personId: string): Promise<MobilePersonContext | null> {
  const client = createTrpcClient(token)
  const ctx = (await client.insights.personContext.query({ personId })) as {
    recommendation: string | null
    warmth: MobilePersonContext['warmth']
    openLoopsForPerson: { content: string; meetingId: string; meetingDate: string }[]
    whatsappSinceMeeting: unknown[]
    lastNotionMeetingDate: string | null
    circles: { seriesId: string; seriesTitle: string }[]
    captureWhatsapp: boolean
    captureReachable: boolean
    latestDmSummary: { summary: string } | null
    proposedCommitments: unknown[]
    emailThreads?: MobilePersonContext['emailThreads']
    voiceRecordings?: MobilePersonContext['voiceRecordings']
    traits?: MobileTraitSummary
  } | null
  if (!ctx) return null
  return {
    recommendation: ctx.recommendation,
    warmthTrend: ctx.warmth.trend,
    warmth: {
      trend: ctx.warmth.trend,
      recentAvg: ctx.warmth.recentAvg,
      olderAvg: ctx.warmth.olderAvg,
      count: ctx.warmth.count,
      timeline: ctx.warmth.timeline.map((p) => ({
        meetingId: p.meetingId,
        date: p.date,
        title: p.title,
        score: p.score,
        sentiment: p.sentiment,
      })),
    },
    openLoops: ctx.openLoopsForPerson.map((l) => ({ content: l.content, meetingId: l.meetingId, meetingDate: l.meetingDate })),
    whatsappSinceCount: ctx.whatsappSinceMeeting.length,
    lastNotionMeetingDate: ctx.lastNotionMeetingDate,
    circles: ctx.circles.map((c) => ({ seriesId: c.seriesId, seriesTitle: c.seriesTitle })),
    captureWhatsapp: ctx.captureWhatsapp,
    captureReachable: ctx.captureReachable,
    dmSummary: ctx.latestDmSummary?.summary ?? null,
    proposedCommitmentCount: ctx.proposedCommitments.length,
    emailThreads: (ctx.emailThreads ?? []).map((t) => ({ id: t.id, subject: t.subject, date: t.date, snippet: t.snippet, gmailUrl: t.gmailUrl })),
    voiceRecordings: (ctx.voiceRecordings ?? []).map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      duration: r.duration,
      status: r.status,
      topic: r.topic,
      meetingId: r.meetingId,
    })),
    traits: ctx.traits ?? { traits: [], traitsAt: null, stale: false, hasSources: false, sourceCount: 0, evidenceCount: 0 },
  }
}

export async function writePersonTraits(token: string, personId: string): Promise<MobileTraitSummary> {
  const client = createTrpcClient(token)
  return (await client.insights.writePersonTraits.mutate({ personId })) as MobileTraitSummary
}

export async function fetchPersonTraitDetail(token: string, personId: string): Promise<MobileTraitDetail> {
  const client = createTrpcClient(token)
  return (await client.insights.personTraitDetail.query({ personId })) as MobileTraitDetail
}

export async function dismissPersonTrait(token: string, traitId: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.insights.dismissPersonTrait.mutate({ traitId })
}

export async function restorePersonTrait(token: string, traitId: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.insights.restorePersonTrait.mutate({ traitId })
}

export async function setCaptureWhatsapp(token: string, id: string, enabled: boolean): Promise<boolean> {
  const client = createTrpcClient(token)
  const res = (await client.people.setCaptureWhatsapp.mutate({ id, enabled })) as { captureWhatsapp: boolean }
  return res.captureWhatsapp
}

export interface MobileCommitment {
  id: string
  personId: string
  personName: string
  owner: 'me' | 'them'
  content: string
  dueInferred: string | null
  source: string
  sourceSnippet: string | null
}

export async function fetchProposedCommitments(token: string, owner: 'all' | 'me' | 'them' = 'all'): Promise<MobileCommitment[]> {
  const client = createTrpcClient(token)
  return (await client.commitments.listProposed.query({ owner })) as MobileCommitment[]
}

export async function acceptCommitment(token: string, commitmentId: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.commitments.accept.mutate({ commitmentId })
}

export async function dismissCommitment(token: string, commitmentId: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.commitments.dismiss.mutate({ commitmentId })
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

export type MobileProjectTimelinePoint = {
  meetingId: string
  date: string
  title: string
  score: number | null
  scoreRationale: string | null
  mood: string | null
  subtext: string | null
  keyInsight: string | null
}

export type MobileProjectPerson = {
  personId: string
  name: string
  color: string | null
  trend: 'warming' | 'cooling' | 'stable' | null
  text: string
}

export type MobileProjectWarmth = {
  dataReason: string
  scoreText: string
  people: MobileProjectPerson[]
  timeline: MobileProjectTimelinePoint[]
}

export type MobileProjectStanding = {
  brief: string | null
  briefAt: string | null
  stale: boolean
}

export type MobileProjectRelated = {
  warmth: MobileProjectWarmth
  standing: MobileProjectStanding
}

export async function fetchProjectRelated(token: string, id: string): Promise<MobileProjectRelated> {
  const client = createTrpcClient(token)
  return (await client.projects.getRelated.query({ id })) as MobileProjectRelated
}

export async function writeProjectStanding(token: string, id: string): Promise<MobileProjectStanding> {
  const client = createTrpcClient(token)
  return client.projects.writeStanding.mutate({ id })
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

export type {
  FeedCategory,
  FeedListCategory,
  FeedSyncResult,
  MobileFeedDigest,
  MobileFeedItem,
} from './feed'
export { FEED_CATEGORIES } from './feed'

export async function fetchFeedItems(
  token: string,
  opts: { category?: FeedListCategory; limit?: number } = {},
): Promise<MobileFeedItem[]> {
  const client = createTrpcClient(token)
  const res = await client.feed.list.query({
    category: opts.category,
    limit: opts.limit ?? 80,
  })
  return mapFeedItems(res)
}

export async function fetchFeedDigest(
  token: string,
  category: FeedCategory,
): Promise<MobileFeedDigest | null> {
  const client = createTrpcClient(token)
  return mapFeedDigest(await client.feed.getDigest.query({ category }))
}

export async function generateFeedDigest(
  token: string,
  category: FeedCategory,
): Promise<MobileFeedDigest> {
  const client = createTrpcClient(token)
  const digest = mapFeedDigest(
    await client.feed.generateDigest.mutate({ category, limit: 100 }),
  )
  if (!digest) throw new Error('לא הצלחתי ליצור תמצית. נסה שוב.')
  return digest
}

export async function syncFeed(token: string): Promise<FeedSyncResult> {
  const client = createTrpcClient(token)
  const res = (await client.feed.sync.mutate()) as FeedSyncResult
  return {
    itemsInserted: Number(res.itemsInserted) || 0,
    sourcesInserted: Number(res.sourcesInserted) || 0,
  }
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

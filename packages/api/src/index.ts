import { router } from './trpc'
import { peopleRouter } from './routers/people'
import { projectsRouter } from './routers/projects'
import { workspacesRouter } from './routers/workspaces'
import { meetingsRouter } from './routers/meetings'
import { circlesRouter } from './routers/circles'
import { commitmentsRouter } from './routers/commitments'
import { meetingTypesRouter } from './routers/meeting-types'
import { tasksRouter } from './routers/tasks'
import { waitingRouter } from './routers/waiting'
import { calendarRouter } from './routers/calendar'
import { financeRouter } from './routers/finance'
import { feedRouter } from './routers/feed'
import { readingListRouter } from './routers/readingList'
import { factsRouter } from './routers/facts'
import { healthRouter } from './routers/health'
import { pushRouter } from './routers/push'
import { notificationsRouter } from './routers/notifications'
import { vatRouter } from './routers/vat'
import { whatsappRouter } from './routers/whatsapp'
import { agentsRouter } from './routers/agents'
import { memoryRouter } from './routers/memory'
import { agentFeedbackRouter } from './routers/agent-feedback'
import { ownerProfileRouter } from './routers/owner-profile'
import { episodesRouter } from './routers/episodes'
import { settingsRouter } from './routers/settings'
import { notionStatusOverridesRouter } from './routers/notion-status-overrides'
import { notionOverridesRouter } from './routers/notion-overrides'
import { backupRouter } from './routers/backup'
import { companiesRouter } from './routers/companies'
import { serviceItemsRouter } from './routers/service-items'
import { salesDocumentsRouter } from './routers/sales-documents'
import { notionGraphRouter } from './routers/notion-graph'
import { contactsRouter } from './routers/contacts'
import { insightsRouter } from './routers/insights'
import { emailRouter } from './routers/email'
import { voiceRouter } from './routers/voice'
import { cfoRouter } from './routers/cfo'
import { harnessRouter } from './routers/harness'
import { slackRouter } from './routers/slack'

export type { Context, AuthSession } from './trpc'
export { createContext } from './trpc'
export {
  getGoogleCalendarAuthUrl,
  exchangeGoogleCalendarCode,
  encodeGoogleCalendarOAuthState,
  parseGoogleCalendarOAuthState,
  googleCalendarOAuthFinishUrl,
  googleCalendarOAuthLandingHtml,
  MOBILE_CALENDAR_OAUTH_SCHEME,
} from './google-calendar-auth'
export { upsertGoogleCalendarConnection } from './services/google-connections'
export {
  getAgentCalendarIds,
  setAgentCalendarIds,
  filterEventsByCalendarScope,
  getAgentCalendarScopePromptBlock,
} from './services/agent-calendar-scope'
export { localTodayIso, localTomorrowIso, resolveLocalDayArg, localDateRangeToUtc, getDefaultTimezone, formatLocalClock, formatLocalRange, toZonedIso } from './lib/calendar-dates'
export {
  eventTimeStatus,
  groupEventsByTime,
  nowClockBlock,
  type EventTimeStatus,
  type GroupedSchedule,
} from './lib/event-time-status'
export { topicTokens, titlesShareTopic } from './lib/topic-match'
export {
  WHATSAPP_WINDOWS,
  isWhatsappWindow,
  normalizeWhatsappTs,
  resolveWhatsappTimeWindow,
  type WhatsappWindow,
  type WhatsappTimeWindowInput,
  type ResolvedWhatsappTimeWindow,
} from './lib/whatsapp-time-window'
export { probeGoogleCalendarHealth, type GoogleAccountHealth } from './services/google-calendar-health'
export {
  getAgentCalendarContext,
  formatAgentCalendarContextForPrompt,
  type AgentCalendarContext,
} from './services/agent-calendar-context'
export {
  getAgentDisplayNamesMap,
  getAgentDisplayNamesRaw,
  listAgentsWithDisplayNames,
  resolveAgentDisplayName,
  setAgentDisplayName,
  buildCustomAgentAliases,
  applyDisplayName,
  type AgentWithDisplayName,
} from './services/agent-display-names'
export {
  pushConfigToBridge,
  isBridgeConfigured,
  getBridgeStatus,
  getBridgeWatchedGroups,
  summarizeGroup,
  summarizeCluster,
  sendBridgeGroupText,
  type GroupRulePayload,
} from './services/whatsapp-bridge-client'
export {
  runTier1QaScan,
  formatIncompleteMessage,
  formatGroundingMessage,
  saveSnapshot as saveTier1QaSnapshot,
  deliverTier1QaGroupUpdate,
  TIER1_QA_NOTIFICATION_TYPE_ID,
  type Tier1QaScanResult,
} from './services/notion-tier1-qa'
export {
  partitionDueSummaries,
  formatClusterSummaryMessage,
  formatQuietDayClusterMessage,
  formatQuietDayGroupMessage,
  QUIET_DAY_BODY,
  type DueSummaryRow,
  type PartitionedSummaries,
} from './services/whatsapp-summary-clusters'
export { generateClusterSummary } from './services/whatsapp-insights'
export {
  ingestDmMessages,
  pushDmAllowlist,
  summarizeDmChats,
  scanDmCommitments,
  scanGroupCommitments,
  runDmRetention,
  defaultClassify,
  type DmIngestMessage,
  type ProposedCommitmentLabel,
  type DmSummaryRunResult,
  type DmCommitmentScanResult,
  type GroupCommitmentScanResult,
  type MessageClassifier,
  type ModelClassification,
} from './services/whatsapp-dm'
export {
  proposeCommitmentsFromAnalysis,
  buildCommitmentNotification,
  freshCommitments,
  COMMITMENT_FRESH_HOURS,
} from './services/commitments'
export { syncEmailThreads, type EmailSyncResult, type EmailHeaderMessage } from './services/email-sync'
export {
  ingestWorkMail,
  ingestWorkTeams,
  type WorkTeamsIngestPayload,
} from './services/work-comms-ingest'
export {
  saveVoiceUpload,
  processVoiceRecording,
  voiceStorageDir,
  VoiceUploadError,
  VOICE_MAX_BYTES,
} from './services/voice'
export {
  createVoiceUpload,
  getVoiceUploadStatus,
  writeVoiceUploadPart,
  completeVoiceUpload,
  VOICE_PART_MAX_BYTES,
  type CreateVoiceUploadInput,
} from './services/voice-resumable-upload'
export { runClusterSummary, type ClusterRunResult } from './services/whatsapp-cluster-run'
export {
  runFollowedDailyDigest,
  shouldSkipScheduledGroupSummaries,
  WHATSAPP_DAILY_DIGEST_TYPE,
  type DigestRunResult,
} from './services/whatsapp-daily-digest'
export {
  NOTIFICATION_TYPES,
  resolveNotificationChannels,
  getSchedulablePreference,
  getNotificationRouting,
  markNotificationSent,
  wasNotificationSentInSlot,
  wasNotificationSentToday,
  type NotificationChannel,
  type ResolvedChannels,
} from './services/notification-preferences'
export { getDefaultTriggerMessage, parseJsonTimes } from './agents-meta'
export {
  hasAgentRunInSlot,
  listAgentConfigs,
  listAgentsDueAtTime,
  markAgentRan,
  migrateAgentSchedulesOnce,
  setAgentSchedule,
  setEventSubscription,
  isRoutableEvent,
  wasAgentRunInSlot,
  type AgentScheduleConfig,
  type RoutableEventSummary,
} from './services/agent-schedules'
export {
  importIBKREmails,
  formatImportReport,
  type IbkrImportResult,
} from './services/ibkr-import-service'
export {
  ensureSelfPerson,
  getSelfPersonName,
  isSelfPersonName,
  matchTaskAssigneeId,
  omitSelfParticipants,
  ownerIdentityPrompt,
} from './services/self-person'
export { formatAnalysisMessage } from './services/analysis-message'
export { notifyAnalysisOnWhatsApp } from './services/analysis-whatsapp'
export {
  analyzeTranscript,
  derivePriorityFromContext,
  type AnalyzeTranscriptOptions,
  type AnalysisResult,
  type AnalysisParticipant,
  type AnalysisActionItem,
} from './services/meeting-analysis'
export {
  ensureMeetingForNote,
  linkOrphanedNotes,
  triggerAnalysisIfNeeded,
  type EnsureMeetingResult,
} from './services/notion-meeting-sync'
export { listAnalysisBacklog, runAnalysisBacklog, analysisBacklogSummary } from './services/analysis-backlog'
export {
  getMeetingPrep,
  saveMeetingPrep,
  type MeetingPrepRecord,
  type SaveMeetingPrepInput,
} from './services/meeting-preps'
export { buildHarnessHeader, renderHarnessHeader } from './services/harness-header'
export { refreshStaleProjectStandings } from './services/project-standing'
export { runMemoryDistiller } from './services/memory-distiller'
export { buildEpisodesBlock, recordEpisode, pruneEpisodes } from './services/agent-episodes'
export { buildOwnerProfileBlock, getOwnerProfile, prioritiesAgeDays, PRIORITIES_STALE_DAYS } from './services/owner-profile'
export {
  buildRelevantMemoryBlock,
  renderMemoryBlock,
  extractAnchors,
  ensureMemoryLinksBackfilled,
  MEMORY_CHAR_CAP,
  MEMORY_TRUNCATION_MARKER,
  type EntityRef,
  type MemoryRowLite,
  type RelevantMemoryResult,
} from './services/memory-relevance'
export {
  indexHarnessWorld,
  worldStateSummary,
  personSignals,
  nodesInWindow,
  HARNESS_SCOPES,
  type HarnessScope,
  type IndexResult,
  type WorldStateSummary,
  type PersonSignals,
} from './services/harness-context'
export {
  runDetectors,
  phraseInsights,
  persistInsights,
  reasonAndPersist,
  listOpenInsights,
  dismissInsight,
  closeInsightsForCommitment,
  formatInsightLines,
  selectInsightsToPush,
  SITUATION_INSIGHT_KINDS,
  VAT_FILING_DAY,
  type HarnessInsightDraft,
  type StoredInsight,
  type InsightSeverity,
  type InsightSource,
  type ReasonResult,
} from './services/harness-reasoner'
export { isGragMirrorEnabled, mirrorToGrag } from './services/harness-grag'
export {
  scanSlackCommitments,
  syncChannels as syncSlackChannels,
  syncSlackUsers,
  getActiveConnection as getActiveSlackConnection,
  verifySlackSignature,
  buildSlackInstallUrl,
  exchangeSlackCode,
  upsertConnection as upsertSlackConnection,
  revokeConnection as revokeSlackConnection,
  ingestSlackMessage,
  markSlackMessageEdited,
  markSlackMessageDeleted,
  detectFomoChannels as detectSlackFomoChannels,
  stampFomoAlert as stampSlackFomoAlert,
  slackTsToMs,
  type SlackCommitmentScanResult,
} from './services/slack'
export {
  upsertTeamsChat,
  ingestTeamsMessage,
  scanTeamsCommitments,
  type TeamsCommitmentScanResult,
} from './services/teams'

export const appRouter = router({
  people: peopleRouter,
  projects: projectsRouter,
  workspaces: workspacesRouter,
  meetings: meetingsRouter,
  circles: circlesRouter,
  commitments: commitmentsRouter,
  meetingTypes: meetingTypesRouter,
  tasks: tasksRouter,
  waiting: waitingRouter,
  calendar: calendarRouter,
  finance: financeRouter,
  feed: feedRouter,
  readingList: readingListRouter,
  facts: factsRouter,
  health: healthRouter,
  push: pushRouter,
  notifications: notificationsRouter,
  vat: vatRouter,
  whatsapp: whatsappRouter,
  agents: agentsRouter,
  memory: memoryRouter,
  agentFeedback: agentFeedbackRouter,
  ownerProfile: ownerProfileRouter,
  episodes: episodesRouter,
  settings: settingsRouter,
  notionStatusOverrides: notionStatusOverridesRouter,
  notionOverrides: notionOverridesRouter,
  backup: backupRouter,
  companies: companiesRouter,
  serviceItems: serviceItemsRouter,
  salesDocuments: salesDocumentsRouter,
  notionGraph: notionGraphRouter,
  contacts: contactsRouter,
  insights: insightsRouter,
  email: emailRouter,
  voice: voiceRouter,
  cfo: cfoRouter,
  harness: harnessRouter,
  slack: slackRouter,
})

export type AppRouter = typeof appRouter

export {
  createAgentJob,
  getPendingJobs,
  markJobRunning,
  markJobDone,
  markJobFailed,
  getJob,
  type AgentJobPayload,
  type CreateJobOptions,
} from './services/agent-jobs'
export {
  recordBackupRun,
  checkBackupFreshness,
  shouldRaiseBackupAlert,
  BACKUP_STALE_ALERT_TITLE,
  BACKUP_KINDS,
  type BackupReport,
} from './services/backup-runs'

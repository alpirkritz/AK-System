import { router } from './trpc'
import { peopleRouter } from './routers/people'
import { projectsRouter } from './routers/projects'
import { workspacesRouter } from './routers/workspaces'
import { meetingsRouter } from './routers/meetings'
import { meetingTypesRouter } from './routers/meeting-types'
import { tasksRouter } from './routers/tasks'
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
import { settingsRouter } from './routers/settings'
import { notionStatusOverridesRouter } from './routers/notion-status-overrides'
import { companiesRouter } from './routers/companies'
import { serviceItemsRouter } from './routers/service-items'
import { salesDocumentsRouter } from './routers/sales-documents'
import { notionGraphRouter } from './routers/notion-graph'
import { contactsRouter } from './routers/contacts'
import { insightsRouter } from './routers/insights'

export type { Context, AuthSession } from './trpc'
export { createContext } from './trpc'
export { getGoogleCalendarAuthUrl, exchangeGoogleCalendarCode } from './google-calendar-auth'
export { upsertGoogleCalendarConnection } from './services/google-connections'
export {
  getAgentCalendarIds,
  setAgentCalendarIds,
  filterEventsByCalendarScope,
  getAgentCalendarScopePromptBlock,
} from './services/agent-calendar-scope'
export { localTodayIso, localDateRangeToUtc, getDefaultTimezone } from './lib/calendar-dates'
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
  type GroupRulePayload,
} from './services/whatsapp-bridge-client'
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

export const appRouter = router({
  people: peopleRouter,
  projects: projectsRouter,
  workspaces: workspacesRouter,
  meetings: meetingsRouter,
  meetingTypes: meetingTypesRouter,
  tasks: tasksRouter,
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
  settings: settingsRouter,
  notionStatusOverrides: notionStatusOverridesRouter,
  companies: companiesRouter,
  serviceItems: serviceItemsRouter,
  salesDocuments: salesDocumentsRouter,
  notionGraph: notionGraphRouter,
  contacts: contactsRouter,
  insights: insightsRouter,
})

export type AppRouter = typeof appRouter

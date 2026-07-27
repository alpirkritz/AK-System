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
import { factsRouter } from './routers/facts'
import { healthRouter } from './routers/health'
import { pushRouter } from './routers/push'
import { notificationsRouter } from './routers/notifications'
import { vatRouter } from './routers/vat'
import { whatsappRouter } from './routers/whatsapp'
import { agentsRouter } from './routers/agents'
import { memoryRouter } from './routers/memory'
import { settingsRouter } from './routers/settings'

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
  type NotificationChannel,
  type ResolvedChannels,
} from './services/notification-preferences'
export { getDefaultTriggerMessage } from './agents-meta'
export {
  importIBKREmails,
  formatImportReport,
  type IbkrImportResult,
} from './services/ibkr-import-service'

export const appRouter = router({
  people: peopleRouter,
  projects: projectsRouter,
  meetings: meetingsRouter,
  workspaces: workspacesRouter,
  meetingTypes: meetingTypesRouter,
  tasks: tasksRouter,
  calendar: calendarRouter,
  finance: financeRouter,
  feed: feedRouter,
  facts: factsRouter,
  health: healthRouter,
  push: pushRouter,
  notifications: notificationsRouter,
  vat: vatRouter,
  whatsapp: whatsappRouter,
  agents: agentsRouter,
  memory: memoryRouter,
  settings: settingsRouter,
})

export type AppRouter = typeof appRouter

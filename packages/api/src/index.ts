import { router } from './trpc'
import { peopleRouter } from './routers/people'
import { projectsRouter } from './routers/projects'
import { meetingsRouter } from './routers/meetings'
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

export type { Context, AuthSession } from './trpc'
export { createContext } from './trpc'
export { getGoogleCalendarAuthUrl, exchangeGoogleCalendarCode } from './google-calendar-auth'
export { upsertGoogleCalendarConnection } from './services/google-connections'

export const appRouter = router({
  people: peopleRouter,
  projects: projectsRouter,
  meetings: meetingsRouter,
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
})

export type AppRouter = typeof appRouter

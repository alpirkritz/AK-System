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

export type { Context } from './trpc'
export { createContext } from './trpc'
export { getGoogleCalendarAuthUrl, exchangeGoogleCalendarCode } from './google-calendar-auth'

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
})

export type AppRouter = typeof appRouter

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

export type { Context } from './trpc'
export { createContext } from './trpc'

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
})

export type AppRouter = typeof appRouter

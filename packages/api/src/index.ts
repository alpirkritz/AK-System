import { router } from './trpc'
import { peopleRouter } from './routers/people'
import { projectsRouter } from './routers/projects'
import { meetingsRouter } from './routers/meetings'
import { tasksRouter } from './routers/tasks'
import { calendarRouter } from './routers/calendar'
import { financeRouter } from './routers/finance'

export type { Context } from './trpc'
export { createContext } from './trpc'

export const appRouter = router({
  people: peopleRouter,
  projects: projectsRouter,
  meetings: meetingsRouter,
  tasks: tasksRouter,
  calendar: calendarRouter,
  finance: financeRouter,
})

export type AppRouter = typeof appRouter

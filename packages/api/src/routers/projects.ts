import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import {
  projects,
  projectPeople,
  meetings,
  tasks,
  people,
  meetingNotes,
  meetingNoteProjects,
} from '@ak-system/database'
import { eq, desc, inArray } from 'drizzle-orm'
import { pushProjectPeople } from '../services/notion-task-writeback'

const createInput = z.object({
  name: z.string().min(1),
  color: z.string().optional(),
})

const updateInput = createInput.extend({
  id: z.string().min(1),
})

const idInput = z.object({ id: z.string().min(1) })

async function replaceProjectPeople(
  db: import('../trpc').Context['db'],
  projectId: string,
  personIds: string[],
) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId))
  if (!project) return { ok: false as const, notionSync: null }

  await db.delete(projectPeople).where(eq(projectPeople.projectId, projectId))
  const uniqueIds = [...new Set(personIds)]
  for (const personId of uniqueIds) {
    await db.insert(projectPeople).values({ projectId, personId })
  }

  let notionSync: Awaited<ReturnType<typeof pushProjectPeople>> | null = null
  if (project.notionPageId) {
    const personRows =
      uniqueIds.length === 0
        ? []
        : await db.select({ name: people.name }).from(people).where(inArray(people.id, uniqueIds))
    notionSync = await pushProjectPeople({
      notionPageId: project.notionPageId,
      personNames: personRows.map((p) => p.name),
    })
  }

  return { ok: true as const, notionSync }
}

export const projectsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(projects).orderBy(projects.name)
  }),

  getById: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [row] = await ctx.db.select().from(projects).where(eq(projects.id, input.id))
    return row ?? null
  }),

  getRelated: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const relatedPeople = await ctx.db
      .select({
        id: people.id,
        name: people.name,
        color: people.color,
        email: people.email,
        role: people.role,
      })
      .from(projectPeople)
      .innerJoin(people, eq(projectPeople.personId, people.id))
      .where(eq(projectPeople.projectId, input.id))
      .orderBy(people.name)

    const relatedMeetings = await ctx.db
      .select()
      .from(meetings)
      .where(eq(meetings.projectId, input.id))
      .orderBy(desc(meetings.date))

    const relatedTasks = await ctx.db
      .select()
      .from(tasks)
      .where(eq(tasks.projectId, input.id))
      .orderBy(desc(tasks.createdAt))

    const noteLinks = await ctx.db
      .select({
        id: meetingNotes.id,
        title: meetingNotes.title,
        date: meetingNotes.date,
        snippet: meetingNotes.snippet,
        bodyText: meetingNotes.bodyText,
        notionUrl: meetingNotes.notionUrl,
        meetingId: meetingNotes.meetingId,
      })
      .from(meetingNoteProjects)
      .innerJoin(meetingNotes, eq(meetingNoteProjects.meetingNoteId, meetingNotes.id))
      .where(eq(meetingNoteProjects.projectId, input.id))
      .orderBy(desc(meetingNotes.date))
      .limit(50)

    return {
      people: relatedPeople,
      meetings: relatedMeetings,
      tasks: relatedTasks,
      meetingNotes: noteLinks,
    }
  }),

  setPeople: protectedProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        personIds: z.array(z.string().min(1)),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      return replaceProjectPeople(ctx.db, input.projectId, input.personIds)
    }),

  addPerson: protectedProcedure
    .input(z.object({ projectId: z.string().min(1), personId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select({ personId: projectPeople.personId })
        .from(projectPeople)
        .where(eq(projectPeople.projectId, input.projectId))
      const ids = [...new Set([...existing.map((r) => r.personId), input.personId])]
      return replaceProjectPeople(ctx.db, input.projectId, ids)
    }),

  removePerson: protectedProcedure
    .input(z.object({ projectId: z.string().min(1), personId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db
        .select({ personId: projectPeople.personId })
        .from(projectPeople)
        .where(eq(projectPeople.projectId, input.projectId))
      const ids = existing.map((r) => r.personId).filter((id) => id !== input.personId)
      return replaceProjectPeople(ctx.db, input.projectId, ids)
    }),

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const id = 'proj' + Date.now()
    const now = new Date().toISOString()
    await ctx.db.insert(projects).values({
      id,
      name: input.name,
      color: input.color ?? '#47b8e8',
      source: 'manual',
      createdAt: now,
      updatedAt: now,
    })
    const [row] = await ctx.db.select().from(projects).where(eq(projects.id, id))
    return row!
  }),

  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(projects)
      .set({
        name: input.name,
        color: input.color ?? undefined,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(projects.id, input.id))
    const [row] = await ctx.db.select().from(projects).where(eq(projects.id, input.id))
    return row ?? null
  }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.update(meetings).set({ projectId: null }).where(eq(meetings.projectId, input.id))
    await ctx.db.update(tasks).set({ projectId: null }).where(eq(tasks.projectId, input.id))
    await ctx.db.delete(projectPeople).where(eq(projectPeople.projectId, input.id))
    await ctx.db.delete(projects).where(eq(projects.id, input.id))
    return { ok: true }
  }),
})

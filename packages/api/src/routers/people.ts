import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { people, meetings, meetingPeople, tasks, taskPeople, projects } from '@ak-system/database'
import { eq, or, like, sql, and, asc, desc, inArray } from 'drizzle-orm'

const createInput = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  email: z.string().optional(),
  color: z.string().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  jobTitle: z.string().optional(),
  linkedin: z.string().optional(),
  tags: z.string().optional(),
  expertIn: z.string().optional(),
  lastContact: z.string().optional(),
  goal: z.string().optional(),
  contactFrequencyDays: z.number().int().positive().optional(),
  notes: z.string().optional(),
})

const updateInput = createInput.extend({
  id: z.string().min(1),
})

const idInput = z.object({ id: z.string().min(1) })

const SORT_COLUMNS = {
  name: people.name,
  company: people.company,
  lastContact: people.lastContact,
  createdAt: people.createdAt,
  goal: people.goal,
  role: people.role,
} as const

export const peopleRouter = router({
  list: publicProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(people).orderBy(people.name)
  }),

  listPaginated: publicProcedure
    .input(z.object({
      page: z.number().int().min(1).default(1),
      pageSize: z.number().int().min(10).max(100).default(50),
      sortBy: z.enum(['name', 'company', 'lastContact', 'createdAt', 'goal', 'role']).default('name'),
      sortDir: z.enum(['asc', 'desc']).default('asc'),
      search: z.string().optional(),
      tags: z.array(z.string()).optional(),
      goal: z.string().optional(),
      company: z.string().optional(),
      lastContactAfter: z.string().optional(),
      lastContactBefore: z.string().optional(),
      contactNow: z.boolean().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const conditions = []

      if (input.search) {
        const q = '%' + input.search.trim() + '%'
        conditions.push(or(
          like(people.name, q),
          sql`COALESCE(${people.role}, '') LIKE ${q}`,
          sql`COALESCE(${people.email}, '') LIKE ${q}`,
          sql`COALESCE(${people.company}, '') LIKE ${q}`,
          sql`COALESCE(${people.tags}, '') LIKE ${q}`,
          sql`COALESCE(${people.expertIn}, '') LIKE ${q}`,
          sql`COALESCE(${people.jobTitle}, '') LIKE ${q}`,
        ))
      }

      if (input.tags && input.tags.length > 0) {
        const tagConditions = input.tags.map(tag =>
          sql`COALESCE(${people.tags}, '') LIKE ${'%' + tag + '%'}`
        )
        conditions.push(or(...tagConditions))
      }

      if (input.goal) {
        conditions.push(eq(people.goal, input.goal))
      }

      if (input.company) {
        conditions.push(eq(people.company, input.company))
      }

      if (input.lastContactAfter) {
        conditions.push(sql`${people.lastContact} >= ${input.lastContactAfter}`)
      }

      if (input.lastContactBefore) {
        conditions.push(sql`${people.lastContact} <= ${input.lastContactBefore}`)
      }

      if (input.contactNow) {
        const today = new Date().toISOString().slice(0, 10)
        conditions.push(sql`
          ${people.contactFrequencyDays} IS NOT NULL
          AND ${people.lastContact} IS NOT NULL
          AND date(${people.lastContact}, '+' || ${people.contactFrequencyDays} || ' days') <= ${today}
        `)
      }

      const where = conditions.length > 0 ? and(...conditions) : undefined
      const col = SORT_COLUMNS[input.sortBy]
      const orderFn = input.sortDir === 'desc' ? desc : asc
      const offset = (input.page - 1) * input.pageSize

      const [items, countResult] = await Promise.all([
        ctx.db
          .select()
          .from(people)
          .where(where)
          .orderBy(orderFn(col))
          .limit(input.pageSize)
          .offset(offset),
        ctx.db
          .select({ count: sql<number>`count(*)` })
          .from(people)
          .where(where),
      ])

      return {
        items,
        total: countResult[0]?.count ?? 0,
        page: input.page,
        pageSize: input.pageSize,
      }
    }),

  /** Distinct values for filter dropdowns and creatable selects */
  filterOptions: publicProcedure.query(async ({ ctx }) => {
    const allPeople = await ctx.db.select({
      tags: people.tags,
      company: people.company,
      goal: people.goal,
      role: people.role,
      expertIn: people.expertIn,
    }).from(people)

    const tagSet = new Set<string>()
    const companySet = new Set<string>()
    const goalSet = new Set<string>()
    const roleSet = new Set<string>()
    const expertInSet = new Set<string>()

    for (const p of allPeople) {
      if (p.tags) p.tags.split(',').forEach(t => { const trimmed = t.trim(); if (trimmed) tagSet.add(trimmed) })
      if (p.company) companySet.add(p.company)
      if (p.goal) goalSet.add(p.goal)
      if (p.role) roleSet.add(p.role)
      if (p.expertIn) p.expertIn.split(',').forEach(e => { const trimmed = e.trim(); if (trimmed) expertInSet.add(trimmed) })
    }

    return {
      tags: Array.from(tagSet).sort(),
      companies: Array.from(companySet).sort(),
      goals: Array.from(goalSet).sort(),
      roles: Array.from(roleSet).sort(),
      expertIn: Array.from(expertInSet).sort(),
    }
  }),

  getById: publicProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [row] = await ctx.db.select().from(people).where(eq(people.id, input.id))
    return row ?? null
  }),

  getRelated: publicProcedure.input(idInput).query(async ({ ctx, input }) => {
    const relatedMeetingIds = await ctx.db
      .select({ meetingId: meetingPeople.meetingId })
      .from(meetingPeople)
      .where(eq(meetingPeople.personId, input.id))

    const meetingIds = relatedMeetingIds.map(r => r.meetingId)

    const relatedMeetings = meetingIds.length > 0
      ? await ctx.db
          .select()
          .from(meetings)
          .where(inArray(meetings.id, meetingIds))
          .orderBy(desc(meetings.date))
      : []

    const linkedTaskIds = await ctx.db
      .select({ taskId: taskPeople.taskId })
      .from(taskPeople)
      .where(eq(taskPeople.personId, input.id))
    const linkedIds = linkedTaskIds.map(r => r.taskId)

    const tasksAsAssignee = await ctx.db
      .select()
      .from(tasks)
      .where(eq(tasks.assigneeId, input.id))
    const tasksAsLinked = linkedIds.length > 0
      ? await ctx.db.select().from(tasks).where(inArray(tasks.id, linkedIds))
      : []
    const allTaskIds = [...new Set([...tasksAsAssignee.map(t => t.id), ...tasksAsLinked.map(t => t.id)])]

    if (allTaskIds.length === 0) {
      return { meetings: relatedMeetings, tasks: [] }
    }

    const tasksWithContext = await ctx.db
      .select({
        id: tasks.id,
        title: tasks.title,
        done: tasks.done,
        dueDate: tasks.dueDate,
        meetingId: tasks.meetingId,
        projectId: tasks.projectId,
        assigneeId: tasks.assigneeId,
        meetingTitle: meetings.title,
        meetingDate: meetings.date,
        projectName: projects.name,
      })
      .from(tasks)
      .leftJoin(meetings, eq(tasks.meetingId, meetings.id))
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(inArray(tasks.id, allTaskIds))
      .orderBy(desc(tasks.createdAt))

    return { meetings: relatedMeetings, tasks: tasksWithContext }
  }),

  search: publicProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const q = '%' + input.query.trim() + '%'
      return ctx.db
        .select()
        .from(people)
        .where(or(
          like(people.name, q),
          sql`COALESCE(${people.role}, '') LIKE ${q}`,
          sql`COALESCE(${people.email}, '') LIKE ${q}`,
          sql`COALESCE(${people.company}, '') LIKE ${q}`,
          sql`COALESCE(${people.tags}, '') LIKE ${q}`,
          sql`COALESCE(${people.expertIn}, '') LIKE ${q}`,
        ))
        .orderBy(people.name)
    }),

  create: publicProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    const id = 'p' + Date.now()
    const createdAt = new Date().toISOString()
    await ctx.db.insert(people).values({
      id,
      name: input.name,
      role: input.role ?? null,
      email: input.email ?? null,
      color: input.color ?? '#e8c547',
      phone: input.phone ?? null,
      company: input.company ?? null,
      jobTitle: input.jobTitle ?? null,
      linkedin: input.linkedin ?? null,
      tags: input.tags ?? null,
      expertIn: input.expertIn ?? null,
      lastContact: input.lastContact ?? null,
      goal: input.goal ?? null,
      contactFrequencyDays: input.contactFrequencyDays ?? null,
      notes: input.notes ?? null,
      createdAt,
    })
    const [row] = await ctx.db.select().from(people).where(eq(people.id, id))
    return row!
  }),

  update: publicProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(people)
      .set({
        name: input.name,
        role: input.role ?? null,
        email: input.email ?? null,
        color: input.color ?? undefined,
        phone: input.phone ?? null,
        company: input.company ?? null,
        jobTitle: input.jobTitle ?? null,
        linkedin: input.linkedin ?? null,
        tags: input.tags ?? null,
        expertIn: input.expertIn ?? null,
        lastContact: input.lastContact ?? null,
        goal: input.goal ?? null,
        contactFrequencyDays: input.contactFrequencyDays ?? null,
        notes: input.notes ?? null,
      })
      .where(eq(people.id, input.id))
    const [row] = await ctx.db.select().from(people).where(eq(people.id, input.id))
    return row ?? null
  }),

  delete: publicProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(people).where(eq(people.id, input.id))
    return { ok: true }
  }),

  bulkDelete: publicProcedure
    .input(z.object({ ids: z.array(z.string().min(1)).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(people).where(inArray(people.id, input.ids))
      return { ok: true, deleted: input.ids.length }
    }),

  bulkUpdateGoal: publicProcedure
    .input(z.object({
      ids: z.array(z.string().min(1)).min(1),
      goal: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(people)
        .set({ goal: input.goal || null })
        .where(inArray(people.id, input.ids))
      return { ok: true }
    }),

  bulkAddTag: publicProcedure
    .input(z.object({
      ids: z.array(z.string().min(1)).min(1),
      tag: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db.select({ id: people.id, tags: people.tags })
        .from(people)
        .where(inArray(people.id, input.ids))

      for (const row of rows) {
        const existing = row.tags ? row.tags.split(',').map(t => t.trim()) : []
        if (!existing.includes(input.tag)) {
          const newTags = [...existing, input.tag].join(', ')
          await ctx.db.update(people).set({ tags: newTags }).where(eq(people.id, row.id))
        }
      }
      return { ok: true }
    }),

  bulkRemoveTag: publicProcedure
    .input(z.object({
      ids: z.array(z.string().min(1)).min(1),
      tag: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const rows = await ctx.db.select({ id: people.id, tags: people.tags })
        .from(people)
        .where(inArray(people.id, input.ids))

      for (const row of rows) {
        if (!row.tags) continue
        const filtered = row.tags.split(',').map(t => t.trim()).filter(t => t !== input.tag)
        await ctx.db.update(people).set({ tags: filtered.join(', ') || null }).where(eq(people.id, row.id))
      }
      return { ok: true }
    }),
})

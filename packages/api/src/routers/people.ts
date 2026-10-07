import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import {
  people,
  personExternalIds,
  meetings,
  meetingPeople,
  meetingNotes,
  meetingNotePeople,
  meetingNoteProjects,
  tasks,
  taskPeople,
  projects,
  projectPeople,
  workspaces,
  seriesRoster,
  whatsappPersonLinks,
  whatsappDmMessages,
  whatsappDmSummaries,
  commitments,
  personEmailThreads,
  voiceRecordingPeople,
  peopleNotionSources,
  PEOPLE_STATUSES,
} from '@ak-system/database'
import { eq, or, like, sql, and, asc, desc, inArray } from 'drizzle-orm'
import { ensureSelfPerson, getSelfPersonName, isSelfPersonName } from '../services/self-person'
import { repointPersonExternalIds } from '../services/person-external-ids'
import { compareDuplicatePair, findDuplicatePairs, markNotDuplicate, notifyNewDuplicates } from '../services/people-duplicates'
import { createNotification } from '../lib/notification-store'
import { pushDmAllowlist, setCaptureWhatsapp } from '../services/whatsapp-dm'
import {
  resolveDatabases,
  listNotionAccountLabels,
  findNotionAccountToken,
  extractNotionDatabaseId,
  resolveDatabaseFieldMappings,
} from '../services/notion-tasks-sync'
import { fetchDatabaseInfo } from '../services/notion-people-directory'

const statusEnum = z.enum(PEOPLE_STATUSES)

const MERGE_FILL_FIELDS = [
  'email', 'phone', 'company', 'companyId', 'role', 'jobTitle', 'linkedin', 'goal', 'notes', 'expertIn', 'tags', 'notionPageId',
] as const

const createInput = z.object({
  name: z.string().min(1),
  role: z.string().optional(),
  email: z.string().optional(),
  color: z.string().optional(),
  phone: z.string().optional(),
  company: z.string().optional(),
  companyId: z.string().nullable().optional(),
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
  captureWhatsapp: z.boolean().optional(),
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
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.select().from(people).where(eq(people.status, 'confirmed')).orderBy(people.name)
  }),

  /** The contact row that represents the app owner, created on first use. */
  me: protectedProcedure.query(async ({ ctx }) => {
    return ensureSelfPerson(ctx.db)
  }),

  listPaginated: protectedProcedure
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
      includeStatuses: z.array(statusEnum).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const conditions = []

      // Default: only confirmed people. Review queue passes includeStatuses explicitly.
      if (input.includeStatuses && input.includeStatuses.length > 0) {
        conditions.push(inArray(people.status, input.includeStatuses))
      } else {
        conditions.push(eq(people.status, 'confirmed'))
      }

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
  filterOptions: protectedProcedure.query(async ({ ctx }) => {
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

  getById: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [row] = await ctx.db.select().from(people).where(eq(people.id, input.id))
    return row ?? null
  }),

  getRelated: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [subject] = await ctx.db.select({ name: people.name }).from(people).where(eq(people.id, input.id))
    const ownerProfile = isSelfPersonName(subject?.name)
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

    // Cadence: how often this person recurs. Counts meetings in the last 8 weeks
    // and whether any are part of a recurring series.
    const WEEKS = 8
    const windowStart = Date.now() - WEEKS * 7 * 86400000
    const recentCount = relatedMeetings.filter((m) => {
      const t = new Date(m.date + 'T00:00:00').getTime()
      return t >= windowStart && t <= Date.now()
    }).length
    const seriesIds = new Set(relatedMeetings.map((m) => m.seriesId).filter(Boolean) as string[])
    const cadence = {
      isRecurring: relatedMeetings.some((m) => m.recurring) || seriesIds.size > 0,
      recentCount,
      weeks: WEEKS,
      seriesCount: seriesIds.size,
      totalMeetings: relatedMeetings.length,
    }

    const linkedTaskIds = await ctx.db
      .select({ taskId: taskPeople.taskId })
      .from(taskPeople)
      .where(eq(taskPeople.personId, input.id))
    const linkedIds = linkedTaskIds.map(r => r.taskId)

    const tasksAsAssignee = await ctx.db
      .select()
      .from(tasks)
      .where(eq(tasks.assigneeId, input.id))
    const mineIds = new Set(tasksAsAssignee.map((t) => t.id))
    const tasksAsLinked = linkedIds.length > 0
      ? await ctx.db.select().from(tasks).where(inArray(tasks.id, linkedIds))
      : []
    // The owner's own tasks belong to him, not to his contact card.
    const visibleAssignee = ownerProfile ? [] : tasksAsAssignee
    const visibleLinked = ownerProfile ? tasksAsLinked.filter((t) => !mineIds.has(t.id)) : tasksAsLinked
    const allTaskIds = [...new Set([...visibleAssignee.map(t => t.id), ...visibleLinked.map(t => t.id)])]

    const tasksWithContext =
      allTaskIds.length === 0
        ? []
        : await ctx.db
            .select({
              id: tasks.id,
              title: tasks.title,
              done: tasks.done,
              status: tasks.status,
              priority: tasks.priority,
              dueDate: tasks.dueDate,
              meetingId: tasks.meetingId,
              projectId: tasks.projectId,
              assigneeId: tasks.assigneeId,
              workspaceId: tasks.workspaceId,
              meetingTitle: meetings.title,
              meetingDate: meetings.date,
              projectName: projects.name,
              workspaceName: workspaces.name,
              workspaceColor: workspaces.color,
            })
            .from(tasks)
            .leftJoin(meetings, eq(tasks.meetingId, meetings.id))
            .leftJoin(projects, eq(tasks.projectId, projects.id))
            .leftJoin(workspaces, eq(tasks.workspaceId, workspaces.id))
            .where(inArray(tasks.id, allTaskIds))
            .orderBy(desc(tasks.createdAt))

    const projectLinks = await ctx.db
      .select({
        id: projects.id,
        name: projects.name,
        color: projects.color,
      })
      .from(projectPeople)
      .innerJoin(projects, eq(projectPeople.projectId, projects.id))
      .where(eq(projectPeople.personId, input.id))
      .orderBy(projects.name)

    const noteLinks = await ctx.db
      .select({
        id: meetingNotes.id,
        title: meetingNotes.title,
        date: meetingNotes.date,
        snippet: meetingNotes.snippet,
        bodyText: meetingNotes.bodyText,
        notionUrl: meetingNotes.notionUrl,
        meetingId: meetingNotes.meetingId,
        sourceKind: meetingNotes.sourceKind,
      })
      .from(meetingNotePeople)
      .innerJoin(meetingNotes, eq(meetingNotePeople.meetingNoteId, meetingNotes.id))
      .where(eq(meetingNotePeople.personId, input.id))
      .orderBy(desc(meetingNotes.date))
      .limit(20)

    const noteIds = noteLinks.map((n) => n.id)
    const noteProjectRows =
      noteIds.length === 0
        ? []
        : await ctx.db
            .select({
              meetingNoteId: meetingNoteProjects.meetingNoteId,
              projectId: meetingNoteProjects.projectId,
            })
            .from(meetingNoteProjects)
            .where(inArray(meetingNoteProjects.meetingNoteId, noteIds))
    const projectIdsByNote = new Map<string, string[]>()
    for (const row of noteProjectRows) {
      const list = projectIdsByNote.get(row.meetingNoteId) ?? []
      list.push(row.projectId)
      projectIdsByNote.set(row.meetingNoteId, list)
    }

    const identities = await ctx.db
      .select({
        id: personExternalIds.id,
        provider: personExternalIds.provider,
        accountKey: personExternalIds.accountKey,
        externalId: personExternalIds.externalId,
        displayName: personExternalIds.displayName,
      })
      .from(personExternalIds)
      .where(eq(personExternalIds.personId, input.id))

    return {
      meetings: relatedMeetings,
      tasks: tasksWithContext,
      cadence,
      projects: projectLinks,
      meetingNotes: noteLinks.map((n) => ({
        ...n,
        projectIds: projectIdsByNote.get(n.id) ?? [],
      })),
      identities,
    }
  }),

  /** Unknown/unconfirmed attendees awaiting review, with occurrence count and a suggested match. */
  reviewQueue: protectedProcedure.query(async ({ ctx }) => {
    const pending = await ctx.db
      .select()
      .from(people)
      .where(eq(people.status, 'unconfirmed'))
      .orderBy(desc(people.createdAt))
    if (pending.length === 0) return []

    const ids = pending.map((p) => p.id)
    const links = await ctx.db
      .select({ personId: meetingPeople.personId })
      .from(meetingPeople)
      .where(inArray(meetingPeople.personId, ids))
    const countByPerson = new Map<string, number>()
    for (const l of links) countByPerson.set(l.personId, (countByPerson.get(l.personId) ?? 0) + 1)

    // Suggest a confirmed person to merge into, by matching email domain or name.
    const confirmed = await ctx.db
      .select({ id: people.id, name: people.name, email: people.email })
      .from(people)
      .where(eq(people.status, 'confirmed'))

    return pending.map((p) => {
      const suggestion = confirmed.find(
        (c) =>
          (c.email && p.email && c.email.toLowerCase() === p.email.toLowerCase()) ||
          c.name.toLowerCase() === p.name.toLowerCase(),
      )
      return {
        ...p,
        meetingCount: countByPerson.get(p.id) ?? 0,
        suggestedMatch: suggestion ? { id: suggestion.id, name: suggestion.name } : null,
      }
    })
  }),

  confirm: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.update(people).set({ status: 'confirmed' }).where(eq(people.id, input.id))
    return { ok: true }
  }),

  ignore: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.update(people).set({ status: 'ignored' }).where(eq(people.id, input.id))
    return { ok: true }
  }),

  /** Merge `fromId` into `toId`: repoint all links, then delete the source person. */
  merge: protectedProcedure
    .input(z.object({ fromId: z.string().min(1), toId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      if (input.fromId === input.toId) return { ok: true }

      // meeting_people: move links, skipping duplicates the target already has
      const targetMeetingLinks = await ctx.db
        .select({ meetingId: meetingPeople.meetingId })
        .from(meetingPeople)
        .where(eq(meetingPeople.personId, input.toId))
      const targetMeetingIds = new Set(targetMeetingLinks.map((l) => l.meetingId))
      const fromMeetingLinks = await ctx.db
        .select({ meetingId: meetingPeople.meetingId })
        .from(meetingPeople)
        .where(eq(meetingPeople.personId, input.fromId))
      for (const l of fromMeetingLinks) {
        if (targetMeetingIds.has(l.meetingId)) continue
        await ctx.db.insert(meetingPeople).values({ meetingId: l.meetingId, personId: input.toId })
      }

      // task_people: move links, skipping duplicates
      const targetTaskLinks = await ctx.db
        .select({ taskId: taskPeople.taskId })
        .from(taskPeople)
        .where(eq(taskPeople.personId, input.toId))
      const targetTaskIds = new Set(targetTaskLinks.map((l) => l.taskId))
      const fromTaskLinks = await ctx.db
        .select({ taskId: taskPeople.taskId })
        .from(taskPeople)
        .where(eq(taskPeople.personId, input.fromId))
      for (const l of fromTaskLinks) {
        if (targetTaskIds.has(l.taskId)) continue
        await ctx.db.insert(taskPeople).values({ taskId: l.taskId, personId: input.toId })
      }

      // tasks.assigneeId
      await ctx.db.update(tasks).set({ assigneeId: input.toId }).where(eq(tasks.assigneeId, input.fromId))

      // project_people
      const targetProjectLinks = await ctx.db
        .select({ projectId: projectPeople.projectId })
        .from(projectPeople)
        .where(eq(projectPeople.personId, input.toId))
      const targetProjectIds = new Set(targetProjectLinks.map((l) => l.projectId))
      const fromProjectLinks = await ctx.db
        .select({ projectId: projectPeople.projectId })
        .from(projectPeople)
        .where(eq(projectPeople.personId, input.fromId))
      for (const l of fromProjectLinks) {
        if (targetProjectIds.has(l.projectId)) continue
        await ctx.db.insert(projectPeople).values({ projectId: l.projectId, personId: input.toId })
      }

      // meeting_note_people
      const targetNoteLinks = await ctx.db
        .select({ meetingNoteId: meetingNotePeople.meetingNoteId })
        .from(meetingNotePeople)
        .where(eq(meetingNotePeople.personId, input.toId))
      const targetNoteIds = new Set(targetNoteLinks.map((l) => l.meetingNoteId))
      const fromNoteLinks = await ctx.db
        .select({ meetingNoteId: meetingNotePeople.meetingNoteId })
        .from(meetingNotePeople)
        .where(eq(meetingNotePeople.personId, input.fromId))
      for (const l of fromNoteLinks) {
        if (targetNoteIds.has(l.meetingNoteId)) continue
        await ctx.db.insert(meetingNotePeople).values({
          meetingNoteId: l.meetingNoteId,
          personId: input.toId,
        })
      }

      await repointPersonExternalIds(ctx.db, input.fromId, input.toId)
      await ctx.db.update(seriesRoster).set({ personId: input.toId }).where(eq(seriesRoster.personId, input.fromId))
      await ctx.db.update(whatsappPersonLinks).set({ personId: input.toId }).where(eq(whatsappPersonLinks.personId, input.fromId))
      await ctx.db.update(whatsappDmMessages).set({ personId: input.toId }).where(eq(whatsappDmMessages.personId, input.fromId))
      await ctx.db.update(whatsappDmSummaries).set({ personId: input.toId }).where(eq(whatsappDmSummaries.personId, input.fromId))
      await ctx.db.update(commitments).set({ personId: input.toId }).where(eq(commitments.personId, input.fromId))
      const keptThreads = (
        await ctx.db.select({ t: personEmailThreads.gmailThreadId }).from(personEmailThreads).where(eq(personEmailThreads.personId, input.toId))
      ).map((r) => r.t)
      if (keptThreads.length > 0) {
        await ctx.db
          .delete(personEmailThreads)
          .where(and(eq(personEmailThreads.personId, input.fromId), inArray(personEmailThreads.gmailThreadId, keptThreads)))
      }
      await ctx.db.update(personEmailThreads).set({ personId: input.toId }).where(eq(personEmailThreads.personId, input.fromId))
      const keptRecordings = (
        await ctx.db.select({ r: voiceRecordingPeople.recordingId }).from(voiceRecordingPeople).where(eq(voiceRecordingPeople.personId, input.toId))
      ).map((r) => r.r)
      if (keptRecordings.length > 0) {
        await ctx.db
          .delete(voiceRecordingPeople)
          .where(and(eq(voiceRecordingPeople.personId, input.fromId), inArray(voiceRecordingPeople.recordingId, keptRecordings)))
      }
      await ctx.db.update(voiceRecordingPeople).set({ personId: input.toId }).where(eq(voiceRecordingPeople.personId, input.fromId))

      // Like Google Contacts: the kept record inherits fields it was missing.
      const [from] = await ctx.db.select().from(people).where(eq(people.id, input.fromId)).limit(1)
      const [to] = await ctx.db.select().from(people).where(eq(people.id, input.toId)).limit(1)
      if (from && to) {
        const fill: Partial<typeof from> = {}
        for (const key of MERGE_FILL_FIELDS) {
          if (!to[key] && from[key]) (fill as Record<string, unknown>)[key] = from[key]
        }
        if (Object.keys(fill).length > 0) await ctx.db.update(people).set(fill).where(eq(people.id, input.toId))
      }

      // Remove the source person (cascades remove its now-duplicate links)
      await ctx.db.delete(people).where(eq(people.id, input.fromId))
      return { ok: true }
    }),

  findDuplicates: protectedProcedure.query(async ({ ctx }) => {
    return { pairs: await findDuplicatePairs(ctx.db) }
  }),

  compareDuplicates: protectedProcedure
    .input(z.object({ personIdA: z.string().min(1), personIdB: z.string().min(1) }))
    .query(async ({ ctx, input }) => compareDuplicatePair(ctx.db, input.personIdA, input.personIdB)),

  notifyNewDuplicates: protectedProcedure.mutation(async ({ ctx }) =>
    notifyNewDuplicates(ctx.db, (n) => createNotification({ ...n, type: 'system' })),
  ),

  markNotDuplicate: protectedProcedure
    .input(z.object({ personIdA: z.string().min(1), personIdB: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await markNotDuplicate(ctx.db, input.personIdA, input.personIdB)
      return { ok: true }
    }),

  search: protectedProcedure
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

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    if (isSelfPersonName(input.name)) {
      const self = await ensureSelfPerson(ctx.db)
      await ctx.db.update(people).set({
        name: getSelfPersonName(),
        ...(input.role !== undefined ? { role: input.role } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.color !== undefined ? { color: input.color } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.company !== undefined ? { company: input.company } : {}),
        ...(input.companyId !== undefined ? { companyId: input.companyId } : {}),
        ...(input.jobTitle !== undefined ? { jobTitle: input.jobTitle } : {}),
        ...(input.linkedin !== undefined ? { linkedin: input.linkedin } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.expertIn !== undefined ? { expertIn: input.expertIn } : {}),
        ...(input.lastContact !== undefined ? { lastContact: input.lastContact } : {}),
        ...(input.goal !== undefined ? { goal: input.goal } : {}),
        ...(input.contactFrequencyDays !== undefined ? { contactFrequencyDays: input.contactFrequencyDays } : {}),
        ...(input.notes !== undefined ? { notes: input.notes } : {}),
      }).where(eq(people.id, self.id))
      if (input.phone) {
        await setCaptureWhatsapp(ctx.db, self.id, true)
        await pushDmAllowlist(ctx.db)
      }
      const [row] = await ctx.db.select().from(people).where(eq(people.id, self.id))
      return row!
    }

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
      companyId: input.companyId ?? null,
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
    // A phone number at creation time is enough to opt this person into WhatsApp 1:1 capture by
    // default — forward-only from now, no backfill, same semantics as toggling it on manually.
    if (input.phone) {
      await setCaptureWhatsapp(ctx.db, id, true)
      await pushDmAllowlist(ctx.db)
    }
    const [row] = await ctx.db.select().from(people).where(eq(people.id, id))
    return row!
  }),

  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    const [before] = await ctx.db
      .select({ phone: people.phone, capture: people.captureWhatsapp })
      .from(people)
      .where(eq(people.id, input.id))
    await ctx.db
      .update(people)
      .set({
        name: input.name,
        role: input.role ?? null,
        email: input.email ?? null,
        color: input.color ?? undefined,
        phone: input.phone ?? null,
        company: input.company ?? null,
        companyId: input.companyId ?? null,
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
    if (input.captureWhatsapp !== undefined) await setCaptureWhatsapp(ctx.db, input.id, input.captureWhatsapp)
    const [row] = await ctx.db.select().from(people).where(eq(people.id, input.id))
    const allowlistChanged =
      !!before && (!!before.capture !== !!row?.captureWhatsapp || (!!row?.captureWhatsapp && before.phone !== row.phone))
    if (allowlistChanged) await pushDmAllowlist(ctx.db)
    return row ?? null
  }),

  /** Opt a person in or out of WhatsApp 1:1 capture; capture starts from now, never backfills. */
  setCaptureWhatsapp: protectedProcedure
    .input(z.object({ id: z.string().min(1), enabled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const state = await setCaptureWhatsapp(ctx.db, input.id, input.enabled)
      if (!state) throw new TRPCError({ code: 'NOT_FOUND', message: 'Person not found' })
      const bridge = await pushDmAllowlist(ctx.db)
      return { captureWhatsapp: !!state.capture, captureWhatsappSince: state.since, bridgeUpdated: bridge.pushed }
    }),

  // ── Notion "people" sources: env-configured + self-service (Settings ← מקורות) ──

  /** Account labels configured in NOTION_ACCOUNTS, for the "add source" account picker. */
  notionAccounts: protectedProcedure.query(() => {
    return listNotionAccountLabels().map((label) => ({ label }))
  }),

  /** Every database the People pass currently scans: env-configured (read-only) + custom (removable). */
  notionSources: protectedProcedure.query(async ({ ctx }) => {
    const env = resolveDatabases('people').map((d) => ({
      source: 'env' as const,
      id: null as string | null,
      accountLabel: d.accountLabel,
      notionDatabaseId: d.databaseId,
      name: d.name,
    }))
    const customRows = await ctx.db.select().from(peopleNotionSources)
    const custom = customRows.map((r) => ({
      source: 'custom' as const,
      id: r.id as string | null,
      accountLabel: r.accountLabel,
      notionDatabaseId: r.notionDatabaseId,
      name: r.notionDatabaseName ?? r.notionDatabaseId,
    }))
    return [...env, ...custom]
  }),

  /**
   * Validates a pasted Notion database link/id against one account's token and previews its
   * title, without writing anything yet — the UI shows this for confirmation before `addNotionSource`.
   */
  resolveNotionDatabaseLink: protectedProcedure
    .input(z.object({ accountLabel: z.string().min(1), link: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const notionDatabaseId = extractNotionDatabaseId(input.link)
      if (!notionDatabaseId) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'לא זיהיתי מזהה בסיס נתונים בקישור הזה' })
      }
      const token = findNotionAccountToken(input.accountLabel)
      if (!token) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'חשבון Notion לא נמצא' })
      }
      let info: Awaited<ReturnType<typeof fetchDatabaseInfo>>
      try {
        info = await fetchDatabaseInfo(token, notionDatabaseId)
      } catch {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `האינטגרציה של ${input.accountLabel} לא משותפת לבסיס הנתונים הזה ב-Notion — שתף אותו קודם משם ונסה שוב`,
        })
      }
      const alreadyEnv = resolveDatabases('people').some((d) => d.databaseId === notionDatabaseId)
      const [existingCustom] = await ctx.db
        .select({ id: peopleNotionSources.id })
        .from(peopleNotionSources)
        .where(eq(peopleNotionSources.notionDatabaseId, notionDatabaseId))
      return {
        notionDatabaseId,
        name: info.title || notionDatabaseId,
        alreadyAdded: alreadyEnv || !!existingCustom,
        fieldMappings: resolveDatabaseFieldMappings(info.properties),
      }
    }),

  addNotionSource: protectedProcedure
    .input(z.object({
      accountLabel: z.string().min(1),
      notionDatabaseId: z.string().min(1),
      notionDatabaseName: z.string().min(1),
      phonePropertyName: z.string().nullable().optional(),
      rolePropertyName: z.string().nullable().optional(),
      companyPropertyName: z.string().nullable().optional(),
      linkedinPropertyName: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!findNotionAccountToken(input.accountLabel)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'חשבון Notion לא נמצא' })
      }
      const alreadyEnv = resolveDatabases('people').some((d) => d.databaseId === input.notionDatabaseId)
      const [existingCustom] = await ctx.db
        .select()
        .from(peopleNotionSources)
        .where(eq(peopleNotionSources.notionDatabaseId, input.notionDatabaseId))
      if (alreadyEnv || existingCustom) {
        throw new TRPCError({ code: 'CONFLICT', message: 'בסיס הנתונים כבר רשום כמקור אנשים' })
      }
      const id = 'pns' + Date.now() + Math.random().toString(36).slice(2, 7)
      await ctx.db.insert(peopleNotionSources).values({
        id,
        phonePropertyName: input.phonePropertyName ?? null,
        rolePropertyName: input.rolePropertyName ?? null,
        companyPropertyName: input.companyPropertyName ?? null,
        linkedinPropertyName: input.linkedinPropertyName ?? null,
        accountLabel: input.accountLabel,
        notionDatabaseId: input.notionDatabaseId,
        notionDatabaseName: input.notionDatabaseName.trim() || null,
        createdAt: new Date().toISOString(),
      })
      const [row] = await ctx.db.select().from(peopleNotionSources).where(eq(peopleNotionSources.id, id))
      return row!
    }),

  removeNotionSource: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(peopleNotionSources).where(eq(peopleNotionSources.id, input.id))
    return { ok: true }
  }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(people).where(eq(people.id, input.id))
    return { ok: true }
  }),

  bulkDelete: protectedProcedure
    .input(z.object({ ids: z.array(z.string().min(1)).min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(people).where(inArray(people.id, input.ids))
      return { ok: true, deleted: input.ids.length }
    }),

  bulkUpdateGoal: protectedProcedure
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

  bulkAddTag: protectedProcedure
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

  bulkRemoveTag: protectedProcedure
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

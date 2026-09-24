import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { and, desc, eq } from 'drizzle-orm'
import { commitments, meetings, people, projectPeople, COMMITMENT_STATUSES } from '@ak-system/database'
import { router, protectedProcedure, type Context } from '../trpc'
import { tasksRouter } from './tasks'
import { commitmentSourceUrl } from '../services/commitments'

const withPerson = {
  id: commitments.id,
  personId: commitments.personId,
  personName: people.name,
  personColor: people.color,
  owner: commitments.owner,
  content: commitments.content,
  dueInferred: commitments.dueInferred,
  source: commitments.source,
  sourceId: commitments.sourceId,
  sourceSnippet: commitments.sourceSnippet,
  status: commitments.status,
  taskId: commitments.taskId,
  createdAt: commitments.createdAt,
}

async function existingMeetingId(db: Context['db'], id: string): Promise<string | undefined> {
  const [m] = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.id, id))
  return m?.id
}

function withSourceUrl<T extends { source: string; sourceId: string | null }>(rows: T[]) {
  return rows.map((r) => ({ ...r, sourceUrl: commitmentSourceUrl(r) }))
}

export const commitmentsRouter = router({
  listProposed: protectedProcedure
    .input(z.object({ owner: z.enum(['me', 'them', 'all']).default('all') }).optional())
    .query(async ({ ctx, input }) => {
      const owner = input?.owner ?? 'all'
      const where = owner === 'all'
        ? eq(commitments.status, 'proposed')
        : and(eq(commitments.status, 'proposed'), eq(commitments.owner, owner))
      return ctx.db
        .select(withPerson)
        .from(commitments)
        .innerJoin(people, eq(people.id, commitments.personId))
        .where(where)
        .orderBy(desc(commitments.createdAt))
        .then(withSourceUrl)
    }),

  listForPerson: protectedProcedure
    .input(z.object({ personId: z.string().min(1), status: z.enum(COMMITMENT_STATUSES).optional() }))
    .query(async ({ ctx, input }) => {
      const where = input.status
        ? and(eq(commitments.personId, input.personId), eq(commitments.status, input.status))
        : eq(commitments.personId, input.personId)
      return ctx.db
        .select(withPerson)
        .from(commitments)
        .innerJoin(people, eq(people.id, commitments.personId))
        .where(where)
        .orderBy(desc(commitments.createdAt))
        .then(withSourceUrl)
    }),

  /** Turns a proposed commitment into a normal task (same path as any new task, incl. Notion). */
  accept: protectedProcedure
    .input(z.object({
      commitmentId: z.string().min(1),
      taskTitle: z.string().min(1).optional(),
      taskDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      taskProjectId: z.string().nullable().optional(),
      /** A workspace linked to a Notion tasks DB gets the task written back there */
      taskWorkspaceId: z.string().nullable().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [c] = await ctx.db.select().from(commitments).where(eq(commitments.id, input.commitmentId))
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Commitment not found' })
      if (c.status !== 'proposed') throw new TRPCError({ code: 'BAD_REQUEST', message: `Commitment already ${c.status}` })
      let projectId = input.taskProjectId
      if (projectId === undefined) {
        const [primary] = await ctx.db
          .select({ projectId: projectPeople.projectId })
          .from(projectPeople)
          .where(eq(projectPeople.personId, c.personId))
          .limit(1)
        projectId = primary?.projectId ?? null
      }
      const created = await tasksRouter.createCaller(ctx).create({
        title: input.taskTitle?.trim() || c.content,
        dueDate: input.taskDueDate === undefined ? c.dueInferred : input.taskDueDate,
        projectId,
        workspaceId: input.taskWorkspaceId ?? null,
        ...(c.owner === 'them' ? { assigneeId: c.personId } : {}),
        ...((c.source === 'meeting_analysis' || c.source === 'voice') && c.sourceId ? { meetingId: await existingMeetingId(ctx.db, c.sourceId) } : {}),
      })
      const taskId = created.id
      await ctx.db
        .update(commitments)
        .set({ status: 'accepted', taskId, updatedAt: new Date().toISOString() })
        .where(eq(commitments.id, c.id))
      return { taskId, notionSynced: created.notionSync?.ok ?? false }
    }),

  dismiss: protectedProcedure
    .input(z.object({ commitmentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [c] = await ctx.db.select({ status: commitments.status }).from(commitments).where(eq(commitments.id, input.commitmentId))
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Commitment not found' })
      if (c.status !== 'proposed') return { dismissed: false }
      await ctx.db
        .update(commitments)
        .set({ status: 'dismissed', updatedAt: new Date().toISOString() })
        .where(eq(commitments.id, input.commitmentId))
      return { dismissed: true }
    }),
})

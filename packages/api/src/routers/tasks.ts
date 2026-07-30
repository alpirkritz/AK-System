import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { tasks, meetings, taskPeople, people, TASK_STATUSES } from '@ak-system/database'
import { eq, inArray } from 'drizzle-orm'
import {
  syncNotionTasks,
  isNotionTasksConfigured,
  resolveWorkspaceNotionTarget,
  type CanonicalStatus,
} from '../services/notion-tasks-sync'
import { pushTaskStatus, createNotionTask, type WriteBackResult, type CreateResult } from '../services/notion-task-writeback'

const priorityEnum = z.enum(['high', 'medium', 'low'])
const statusEnum = z.enum(TASK_STATUSES)

/** `done` is derived from the canonical status so the two never drift apart. */
function doneFromStatus(status: string): boolean {
  return status === 'done' || status === 'cancelled'
}

type TaskRow = typeof tasks.$inferSelect

/**
 * Mirror a status change onto the Notion page the task came from. Manual tasks are a no-op.
 * The local row is already committed, so a Notion outage degrades to a reported reason rather
 * than a failed mutation.
 */
async function syncStatusToNotion(
  task: Pick<TaskRow, 'source' | 'notionPageId' | 'notionAccount' | 'notionDb'>,
  status: string,
): Promise<WriteBackResult | null> {
  if (task.source !== 'notion' || !task.notionPageId) return null
  return pushTaskStatus({
    notionPageId: task.notionPageId,
    notionAccount: task.notionAccount,
    notionDb: task.notionDb,
    status: status as CanonicalStatus,
  })
}

const createInput = z.object({
  title: z.string().min(1),
  meetingId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  done: z.boolean().optional(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
})

const updateInput = z.object({
  id: z.string().min(1),
  title: z.string().min(1).optional(),
  meetingId: z.string().nullable().optional(),
  projectId: z.string().nullable().optional(),
  workspaceId: z.string().nullable().optional(),
  assigneeId: z.string().nullable().optional(),
  dueDate: z.string().nullable().optional(),
  done: z.boolean().optional(),
  status: statusEnum.optional(),
  priority: priorityEnum.optional(),
})

const idInput = z.object({ id: z.string().min(1) })

export const tasksRouter = router({
  list: protectedProcedure
    .input(z.object({ workspaceId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      if (input?.workspaceId) {
        return ctx.db.select().from(tasks).where(eq(tasks.workspaceId, input.workspaceId)).orderBy(tasks.createdAt)
      }
      return ctx.db.select().from(tasks).orderBy(tasks.createdAt)
    }),

  listByMeeting: protectedProcedure.input(z.object({ meetingId: z.string() })).query(async ({ ctx, input }) => {
    return ctx.db.select().from(tasks).where(eq(tasks.meetingId, input.meetingId))
  }),

  listByProject: protectedProcedure.input(z.object({ projectId: z.string() })).query(async ({ ctx, input }) => {
    return ctx.db.select().from(tasks).where(eq(tasks.projectId, input.projectId))
  }),

  listByWorkspace: protectedProcedure.input(z.object({ workspaceId: z.string() })).query(async ({ ctx, input }) => {
    return ctx.db.select().from(tasks).where(eq(tasks.workspaceId, input.workspaceId))
  }),

  getById: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [row] = await ctx.db.select().from(tasks).where(eq(tasks.id, input.id))
    return row ?? null
  }),

  create: protectedProcedure.input(createInput).mutation(async ({ ctx, input }) => {
    // Quick-add makes same-millisecond creates realistic, so keep ids collision-safe.
    const id = 't' + Date.now() + Math.random().toString(36).slice(2, 7)
    const now = new Date().toISOString()
    let projectId = input.projectId ?? null
    if (input.meetingId && projectId === null) {
      const [meeting] = await ctx.db.select().from(meetings).where(eq(meetings.id, input.meetingId))
      if (meeting?.projectId) projectId = meeting.projectId
    }
    const status = input.status ?? (input.done ? 'done' : 'not_started')
    await ctx.db.insert(tasks).values({
      id,
      title: input.title,
      meetingId: input.meetingId ?? null,
      projectId,
      workspaceId: input.workspaceId ?? null,
      assigneeId: input.assigneeId ?? null,
      dueDate: input.dueDate ?? null,
      done: doneFromStatus(status),
      status,
      priority: input.priority ?? 'medium',
      createdAt: now,
      updatedAt: now,
    })
    let [row] = await ctx.db.select().from(tasks).where(eq(tasks.id, id))

    // Best-effort: push into the workspace's linked Notion database, if any. The local row
    // above is already committed and is never rolled back — a failed push just leaves the
    // task as an ordinary manual task, exactly as if no workspace link existed.
    let notionSync: CreateResult | null = null
    if (input.workspaceId) {
      const target = await resolveWorkspaceNotionTarget(input.workspaceId)
      if (target) {
        notionSync = await createNotionTask({ target, title: input.title, dueDate: input.dueDate ?? null })
        if (notionSync.ok) {
          await ctx.db
            .update(tasks)
            .set({
              source: 'notion',
              notionPageId: notionSync.pageId,
              notionAccount: notionSync.accountLabel,
              notionDb: notionSync.name,
              notionStatusRaw: notionSync.label,
            })
            .where(eq(tasks.id, id))
          ;[row] = await ctx.db.select().from(tasks).where(eq(tasks.id, id))
        }
      }
    }

    return { ...row!, notionSync }
  }),

  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    const { id, ...rest } = input
    const updates: Partial<typeof tasks.$inferInsert> = { updatedAt: new Date().toISOString() }
    if (rest.title !== undefined) updates.title = rest.title
    if (rest.meetingId !== undefined) updates.meetingId = rest.meetingId
    if (rest.projectId !== undefined) updates.projectId = rest.projectId
    if (rest.workspaceId !== undefined) updates.workspaceId = rest.workspaceId
    if (rest.assigneeId !== undefined) updates.assigneeId = rest.assigneeId
    if (rest.dueDate !== undefined) updates.dueDate = rest.dueDate
    if (rest.done !== undefined) updates.done = rest.done
    // Status wins when present and keeps `done` in lockstep.
    if (rest.status !== undefined) {
      updates.status = rest.status
      updates.done = doneFromStatus(rest.status)
    }
    if (rest.priority !== undefined) updates.priority = rest.priority
    await ctx.db.update(tasks).set(updates).where(eq(tasks.id, id))
    const [row] = await ctx.db.select().from(tasks).where(eq(tasks.id, id))
    if (!row) return null

    // Only a real status change is worth a round-trip to Notion.
    let notionSync: WriteBackResult | null = null
    if (rest.status !== undefined) {
      notionSync = await syncStatusToNotion(row, rest.status)
      if (notionSync?.ok) {
        await ctx.db
          .update(tasks)
          .set({ notionStatusRaw: notionSync.label })
          .where(eq(tasks.id, id))
        row.notionStatusRaw = notionSync.label
      }
    }
    return { ...row, notionSync }
  }),

  toggleDone: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const [task] = await ctx.db.select().from(tasks).where(eq(tasks.id, input.id))
    if (!task) return null
    const done = !task.done
    const status = done ? 'done' : 'not_started'
    await ctx.db
      .update(tasks)
      .set({ done, status, updatedAt: new Date().toISOString() })
      .where(eq(tasks.id, input.id))

    const notionSync = await syncStatusToNotion(task, status)
    let notionStatusRaw = task.notionStatusRaw
    if (notionSync?.ok) {
      notionStatusRaw = notionSync.label
      await ctx.db
        .update(tasks)
        .set({ notionStatusRaw })
        .where(eq(tasks.id, input.id))
    }
    return { ...task, done, status, notionStatusRaw, notionSync }
  }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(tasks).where(eq(tasks.id, input.id))
    return { ok: true }
  }),

  getTaskPeople: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select({ personId: taskPeople.personId })
      .from(taskPeople)
      .where(eq(taskPeople.taskId, input.id))
    return rows.map(r => r.personId)
  }),

  getTaskPeopleWithNames: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const rows = await ctx.db
      .select({ personId: taskPeople.personId, name: people.name })
      .from(taskPeople)
      .innerJoin(people, eq(taskPeople.personId, people.id))
      .where(eq(taskPeople.taskId, input.id))
    return rows.map(r => ({ id: r.personId, name: r.name }))
  }),

  setTaskPeople: protectedProcedure
    .input(z.object({ taskId: z.string().min(1), personIds: z.array(z.string().min(1)) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db.delete(taskPeople).where(eq(taskPeople.taskId, input.taskId))
      for (const personId of input.personIds) {
        await ctx.db.insert(taskPeople).values({ taskId: input.taskId, personId })
      }
      return { ok: true }
    }),

  /** האם מוגדר בסיס נתונים של משימות ב-Notion (לכפתור סנכרון) */
  notionConfigured: protectedProcedure.query(() => {
    return { configured: isNotionTasksConfigured() }
  }),

  /** סנכרון משימות + אנשים מ-Notion אל בסיס הנתונים (חלון 60 יום כברירת מחדל) */
  syncFromNotion: protectedProcedure
    .input(
      z
        .object({
          windowDays: z.number().int().min(1).max(365).default(60),
          dryRun: z.boolean().default(false),
        })
        .default({ windowDays: 60, dryRun: false }),
    )
    .mutation(async ({ ctx, input }) => {
      return syncNotionTasks({ windowDays: input.windowDays, dryRun: input.dryRun }, ctx.db)
    }),
})

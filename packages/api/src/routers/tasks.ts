import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { tasks, meetings, taskPeople, people, TASK_STATUSES, workspaceNotionDatabases } from '@ak-system/database'
import { eq, inArray, isNull, or } from 'drizzle-orm'
import { expandWorkspaceFilter } from '../services/workspace-scope'
import { assertSameWorld } from '../services/world-scope'
import {
  syncNotionTasks,
  isNotionTasksConfigured,
  resolveWorkspaceNotionTarget,
  type CanonicalStatus,
} from '../services/notion-tasks-sync'
import {
  pushTaskStatus,
  pushTaskProperties,
  pushTaskPeople,
  pushTaskMeeting,
  createNotionTask,
  type WriteBackResult,
  type CreateResult,
  type PeopleRelationResult,
} from '../services/notion-task-writeback'
import { pushMeetingTaskLinks } from '../services/notion-meeting-writeback'
import { ensureSelfPerson, isSelfPersonName } from '../services/self-person'

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
        const ids = await expandWorkspaceFilter(ctx.db, input.workspaceId)
        return ctx.db
          .select()
          .from(tasks)
          .where(or(inArray(tasks.workspaceId, ids), isNull(tasks.workspaceId)))
          .orderBy(tasks.createdAt)
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
    await assertSameWorld(ctx.db, { projectId, workspaceId: input.workspaceId ?? null, meetingId: input.meetingId ?? null }, 'המשימה')
    const status = input.status ?? (input.done ? 'done' : 'not_started')
    // Tasks opened through the app belong to the owner unless he says otherwise.
    // An omitted key means "not specified" and gets the default; an explicit
    // `null` is the user picking "ללא אחראי" and is left alone.
    const assigneeId =
      input.assigneeId === undefined ? (await ensureSelfPerson(ctx.db)).id : input.assigneeId
    await ctx.db.insert(tasks).values({
      id,
      title: input.title,
      meetingId: input.meetingId ?? null,
      projectId,
      workspaceId: input.workspaceId ?? null,
      assigneeId,
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
        // The assignee is what keeps the page visible in Notion's filtered views and stops the
        // next pull-sync from pruning it, so it travels with the page from the start.
        let assignee: { name: string; email: string | null } | null = null
        if (assigneeId) {
          const [person] = await ctx.db
            .select({ name: people.name, email: people.email })
            .from(people)
            .where(eq(people.id, assigneeId))
          if (person) assignee = { name: person.name, email: person.email }
        }
        notionSync = await createNotionTask({
          target,
          title: input.title,
          dueDate: input.dueDate ?? null,
          status: status as CanonicalStatus,
          priority: input.priority ?? 'medium',
          assignee,
        })
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
          
          // If task was created with a meetingId, write the Meeting relation
          if (input.meetingId && row) {
            const [meeting] = await ctx.db
              .select({ notionPageId: meetings.notionPageId })
              .from(meetings)
              .where(eq(meetings.id, input.meetingId))
            const meetingNotionPageId = meeting?.notionPageId ?? null
            
            if (meetingNotionPageId) {
              const meetingSync = await pushTaskMeeting({
                notionPageId: notionSync.pageId,
                notionAccount: notionSync.accountLabel,
                notionDb: notionSync.name,
                meetingNotionPageId,
              })
              if (!meetingSync.ok && meetingSync.reason !== 'no-meeting-relation') {
                console.warn(`[tasks.create] Meeting writeback failed for task ${id}:`, meetingSync)
              }
              
              // Also add this task to the meeting's Tasks relation
              const meetingTasksSync = await pushMeetingTaskLinks({
                meetingNotionPageId,
                taskNotionPageId: notionSync.pageId,
                action: 'add',
              })
              if (!meetingTasksSync.ok && meetingTasksSync.reason !== 'no-tasks-relation') {
                console.warn(`[tasks.create] Meeting Tasks relation writeback failed:`, meetingTasksSync)
              }
            }
          }
        }
      }
    }

    return { ...row!, notionSync }
  }),

  update: protectedProcedure.input(updateInput).mutation(async ({ ctx, input }) => {
    const { id, ...rest } = input
    
    // Read old row for change detection
    const [oldRow] = await ctx.db.select().from(tasks).where(eq(tasks.id, id))
    
    const nextProject = rest.projectId !== undefined ? rest.projectId : oldRow?.projectId
    const nextWorkspace = rest.workspaceId !== undefined ? rest.workspaceId : oldRow?.workspaceId
    if (nextProject && (rest.projectId !== undefined || rest.workspaceId !== undefined)) {
      await assertSameWorld(ctx.db, { projectId: nextProject, workspaceId: nextWorkspace ?? null, taskId: nextWorkspace ? null : id }, 'המשימה')
    }
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

    // Write back changed fields to Notion
    let notionSync: WriteBackResult | null = null
    if (row.source === 'notion' && row.notionPageId && oldRow) {
      const changedFields: Parameters<typeof pushTaskProperties>[0] = {
        notionPageId: row.notionPageId,
        notionAccount: row.notionAccount,
        notionDb: row.notionDb,
      }
      let hasChanges = false
      
      if (rest.title !== undefined && rest.title !== oldRow.title) {
        changedFields.title = rest.title
        hasChanges = true
      }
      if (rest.priority !== undefined && rest.priority !== oldRow.priority) {
        changedFields.priority = rest.priority
        hasChanges = true
      }
      if (rest.dueDate !== undefined && rest.dueDate !== oldRow.dueDate) {
        changedFields.dueDate = rest.dueDate
        hasChanges = true
      }
      if (rest.status !== undefined && rest.status !== oldRow.status) {
        changedFields.status = rest.status as CanonicalStatus
        hasChanges = true
      }
      
      if (hasChanges) {
        notionSync = await pushTaskProperties(changedFields)
        if (notionSync?.ok && notionSync.label) {
          await ctx.db
            .update(tasks)
            .set({ notionStatusRaw: notionSync.label })
            .where(eq(tasks.id, id))
          row.notionStatusRaw = notionSync.label
        }
      }
      
      // Meeting link changed: write to both Notion relations (task.Meeting + meeting.Tasks)
      if (rest.meetingId !== undefined && rest.meetingId !== oldRow.meetingId) {
        // Get new meeting's notionPageId
        let newMeetingNotionPageId: string | null = null
        if (rest.meetingId) {
          const [meeting] = await ctx.db
            .select({ notionPageId: meetings.notionPageId })
            .from(meetings)
            .where(eq(meetings.id, rest.meetingId))
          newMeetingNotionPageId = meeting?.notionPageId ?? null
        }
        
        // Get old meeting's notionPageId
        let oldMeetingNotionPageId: string | null = null
        if (oldRow.meetingId) {
          const [oldMeeting] = await ctx.db
            .select({ notionPageId: meetings.notionPageId })
            .from(meetings)
            .where(eq(meetings.id, oldRow.meetingId))
          oldMeetingNotionPageId = oldMeeting?.notionPageId ?? null
        }
        
        // Push task → meeting relation
        if (newMeetingNotionPageId || rest.meetingId === null) {
          const meetingSync = await pushTaskMeeting({
            notionPageId: row.notionPageId,
            notionAccount: row.notionAccount,
            notionDb: row.notionDb,
            meetingNotionPageId: newMeetingNotionPageId,
          })
          // Don't overwrite the main notionSync result, but log failures
          if (!meetingSync.ok && meetingSync.reason !== 'no-meeting-relation') {
            console.warn(`[tasks.update] Meeting writeback failed for task ${id}:`, meetingSync)
          }
        }
        
        // Update meeting Tasks relations: remove from old, add to new
        if (oldMeetingNotionPageId) {
          const removeSync = await pushMeetingTaskLinks({
            meetingNotionPageId: oldMeetingNotionPageId,
            taskNotionPageId: row.notionPageId,
            action: 'remove',
          })
          if (!removeSync.ok && removeSync.reason !== 'no-tasks-relation') {
            console.warn(`[tasks.update] Old meeting Tasks removal failed:`, removeSync)
          }
        }
        if (newMeetingNotionPageId) {
          const addSync = await pushMeetingTaskLinks({
            meetingNotionPageId: newMeetingNotionPageId,
            taskNotionPageId: row.notionPageId,
            action: 'add',
          })
          if (!addSync.ok && addSync.reason !== 'no-tasks-relation') {
            console.warn(`[tasks.update] New meeting Tasks addition failed:`, addSync)
          }
        }
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
      .select({ personId: taskPeople.personId, name: people.name })
      .from(taskPeople)
      .innerJoin(people, eq(taskPeople.personId, people.id))
      .where(eq(taskPeople.taskId, input.id))
    return rows.filter((row) => !isSelfPersonName(row.name)).map((row) => row.personId)
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
      const linked = input.personIds.length
        ? await ctx.db
            .select({ id: people.id, name: people.name })
            .from(people)
            .where(inArray(people.id, input.personIds))
        : []
      const kept = linked.filter((row) => !isSelfPersonName(row.name))
      const personIds = kept.map((row) => row.id)
      await ctx.db.delete(taskPeople).where(eq(taskPeople.taskId, input.taskId))
      for (const personId of personIds) {
        await ctx.db.insert(taskPeople).values({ taskId: input.taskId, personId })
      }

      // The clients call this right after `create`, so this is also the moment a brand-new task's
      // people reach Notion — `create` itself never sees them.
      const [task] = await ctx.db
        .select({
          notionPageId: tasks.notionPageId,
          notionAccount: tasks.notionAccount,
          notionDb: tasks.notionDb,
        })
        .from(tasks)
        .where(eq(tasks.id, input.taskId))

      let notionSync: PeopleRelationResult | null = null
      if (task?.notionPageId) {
        const names = kept.map((row) => row.name)
        notionSync = await pushTaskPeople({
          notionPageId: task.notionPageId,
          notionAccount: task.notionAccount,
          notionDb: task.notionDb,
          personNames: names,
        })
      }

      return { ok: true, notionSync }
    }),

  /** האם מוגדר בסיס נתונים של משימות ב-Notion (לכפתור סנכרון) */
  notionConfigured: protectedProcedure.query(async ({ ctx }) => {
    if (isNotionTasksConfigured()) return { configured: true }
    const links = await ctx.db
      .select({ accountLabel: workspaceNotionDatabases.accountLabel })
      .from(workspaceNotionDatabases)
    return { configured: links.some((l) => !!l.accountLabel?.trim()) }
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

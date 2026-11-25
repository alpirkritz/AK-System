import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import {
  commitments,
  meetings,
  people,
  projectPeople,
  slackMembers,
  tasks,
  whatsappDmMessages,
  whatsappMessages,
  COMMITMENT_STATUSES,
} from '@ak-system/database'
import { router, protectedProcedure, type Context } from '../trpc'
import { phoneFromWhatsappJid } from '../lib/phone'
import { linkWhatsappSender } from '../services/person-context'
import { commitmentSourceUrl } from '../services/commitments'
import { syncItemFromCommitment } from '../services/action-item-link'
import { attachSlackMemberToPerson } from '../services/slack-cache-ingest'
import { closeInsightsForCommitment } from '../services/harness-reasoner'
import { tasksRouter } from './tasks'
import { peopleRouter } from './people'

const withPerson = {
  id: commitments.id,
  personId: commitments.personId,
  personName: people.name,
  personColor: people.color,
  senderJid: commitments.senderJid,
  senderName: commitments.senderName,
  owner: commitments.owner,
  content: commitments.content,
  dueInferred: commitments.dueInferred,
  source: commitments.source,
  sourceId: commitments.sourceId,
  sourceSnippet: commitments.sourceSnippet,
  sourceTs: commitments.sourceTs,
  sourceChatName: commitments.sourceChatName,
  sourceReason: commitments.sourceReason,
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

export interface CommitmentContextMessage {
  id: string
  speaker: string
  text: string
  ts: number
  /** The message the commitment was derived from. */
  isSource: boolean
}

export interface CommitmentContext {
  chatName: string | null
  messages: CommitmentContextMessage[]
}

const CONTEXT_BEFORE = 5
const CONTEXT_AFTER = 2

/**
 * The few messages around the source one, time-ordered. When the source message is already gone
 * (retention, or a group row re-keyed), falls back to the tail of the chat so there is still
 * something to read.
 */
function windowAround(
  rows: { id: string; speaker: string; text: string; ts: number }[],
  sourceId: string | null,
): CommitmentContextMessage[] {
  const at = sourceId ? rows.findIndex((r) => r.id === sourceId) : -1
  const slice = at < 0
    ? rows.slice(-(CONTEXT_BEFORE + 1))
    : rows.slice(Math.max(0, at - CONTEXT_BEFORE), at + CONTEXT_AFTER + 1)
  return slice.map((r) => ({ ...r, isSource: at >= 0 && r.id === sourceId }))
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
        .leftJoin(people, eq(people.id, commitments.personId))
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
        .leftJoin(people, eq(people.id, commitments.personId))
        .where(where)
        .orderBy(desc(commitments.createdAt))
        .then(withSourceUrl)
    }),

  /**
   * The messages around the one a WhatsApp commitment came from, so the proposal can be read in
   * context instead of as a floating sentence. Empty for sources that have no message store.
   */
  sourceContext: protectedProcedure
    .input(z.object({ commitmentId: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<CommitmentContext> => {
      const [c] = await ctx.db.select().from(commitments).where(eq(commitments.id, input.commitmentId))
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Commitment not found' })
      const empty: CommitmentContext = { chatName: c.sourceChatName, messages: [] }
      if (c.sourceTs == null) return empty

      if (c.source === 'whatsapp_group' && c.sourceChatJid) {
        const rows = await ctx.db
          .select({
            id: whatsappMessages.waMessageId,
            speaker: whatsappMessages.senderName,
            text: whatsappMessages.text,
            ts: whatsappMessages.ts,
          })
          .from(whatsappMessages)
          .where(eq(whatsappMessages.groupJid, c.sourceChatJid))
          .orderBy(asc(whatsappMessages.ts))
        return { chatName: c.sourceChatName, messages: windowAround(rows, c.sourceId) }
      }

      if (c.source === 'whatsapp_dm' && c.personId) {
        const name = c.sourceChatName ?? 'הם'
        const rows = (
          await ctx.db
            .select({
              id: whatsappDmMessages.id,
              fromMe: whatsappDmMessages.fromMe,
              text: whatsappDmMessages.text,
              ts: whatsappDmMessages.ts,
            })
            .from(whatsappDmMessages)
            .where(eq(whatsappDmMessages.personId, c.personId))
            .orderBy(asc(whatsappDmMessages.ts))
        ).map((r) => ({ id: r.id, speaker: r.fromMe ? 'אני' : name, text: r.text, ts: r.ts }))
        return { chatName: c.sourceChatName, messages: windowAround(rows, c.sourceId) }
      }

      return empty
    }),

  /**
   * Builds prefill data for the TaskModal when accepting a commitment.
   * Returns the suggested field values plus a Hebrew explanation for each.
   */
  taskPrefill: protectedProcedure
    .input(z.object({ commitmentId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const [c] = await ctx.db
        .select({
          id: commitments.id,
          content: commitments.content,
          personId: commitments.personId,
          personName: people.name,
          owner: commitments.owner,
          dueInferred: commitments.dueInferred,
          source: commitments.source,
          sourceId: commitments.sourceId,
          sourceChatName: commitments.sourceChatName,
          sourceReason: commitments.sourceReason,
        })
        .from(commitments)
        .leftJoin(people, eq(people.id, commitments.personId))
        .where(eq(commitments.id, input.commitmentId))
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Commitment not found' })

      // Resolve project from person's primary project association
      let projectId: string | null = null
      let projectName: string | null = null
      if (c.personId) {
        const { projects } = await import('@ak-system/database')
        const [pp] = await ctx.db
          .select({ projectId: projectPeople.projectId })
          .from(projectPeople)
          .where(eq(projectPeople.personId, c.personId))
          .limit(1)
        if (pp?.projectId) {
          projectId = pp.projectId
          const [proj] = await ctx.db
            .select({ name: projects.name })
            .from(projects)
            .where(eq(projects.id, pp.projectId))
          projectName = proj?.name ?? null
        }
      }

      // Resolve meeting (for meeting_analysis / voice sources)
      let meetingId: string | null = null
      let meetingTitle: string | null = null
      if ((c.source === 'meeting_analysis' || c.source === 'voice') && c.sourceId) {
        const existing = await existingMeetingId(ctx.db, c.sourceId)
        if (existing) {
          meetingId = existing
          const [m] = await ctx.db
            .select({ title: meetings.title })
            .from(meetings)
            .where(eq(meetings.id, existing))
          meetingTitle = m?.title ?? null
        }
      }

      // Build Hebrew explanations for each suggested value
      const explanations: Record<string, string> = {}
      explanations.title = 'הכותרת לקוחה מתוכן ההתחייבות שזוהתה'
      if (c.dueInferred) {
        explanations.dueDate = 'תאריך היעד הוסק אוטומטית מהניסוח'
      }
      if (projectId) {
        explanations.projectId = `הפרויקט משויך כי ${c.personName ?? 'האיש קשר'} קשור/ה ל"${projectName}"`
      }
      if (c.owner === 'them' && c.personName) {
        explanations.assigneeId = `המשימה מיועדת ל${c.personName} כי זו התחייבות שלהם`
      }
      if (meetingId) {
        explanations.meetingId = `הפגישה "${meetingTitle}" היא מקור ההתחייבות`
      }

      return {
        title: c.content,
        dueDate: c.dueInferred ?? null,
        projectId,
        assigneeId: c.owner === 'them' ? (c.personId ?? null) : null,
        meetingId,
        explanations,
      }
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
      /**
       * When provided, the task was already created by the caller (via TaskModal).
       * Skip internal task creation and just link this task to the commitment.
       */
      taskId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const [c] = await ctx.db.select().from(commitments).where(eq(commitments.id, input.commitmentId))
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Commitment not found' })
      if (c.status !== 'proposed') throw new TRPCError({ code: 'BAD_REQUEST', message: `Commitment already ${c.status}` })
      if (!c.personId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'שייך איש קשר לפני אישור' })

      // Fast path: task was already created by the caller (TaskModal). Just link it.
      if (input.taskId) {
        await ctx.db
          .update(commitments)
          .set({ status: 'accepted', taskId: input.taskId, updatedAt: new Date().toISOString() })
          .where(eq(commitments.id, c.id))
        await syncItemFromCommitment(ctx.db, c.id)
        return { taskId: input.taskId, notionSynced: false }
      }

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
      await syncItemFromCommitment(ctx.db, c.id)
      return { taskId, notionSynced: created.notionSync?.ok ?? false }
    }),

  /**
   * Links a task (created by the caller through TaskModal) to an accepted `owner=them` commitment
   * that has none yet, so the waiting list shows the editable task instead of the bare commitment.
   * `accept` stays limited to proposed commitments on purpose.
   */
  linkTask: protectedProcedure
    .input(z.object({ commitmentId: z.string().min(1), taskId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const [c] = await ctx.db
        .select({ status: commitments.status, owner: commitments.owner, taskId: commitments.taskId })
        .from(commitments)
        .where(eq(commitments.id, input.commitmentId))
      if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'ההתחייבות לא נמצאה' })
      if (c.status !== 'accepted') throw new TRPCError({ code: 'BAD_REQUEST', message: 'אפשר לקשר משימה רק להתחייבות מאושרת' })
      if (c.owner !== 'them') throw new TRPCError({ code: 'BAD_REQUEST', message: 'אפשר לקשר משימה רק להתחייבות של מישהו אחר' })
      if (c.taskId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'להתחייבות כבר יש משימה' })
      const [task] = await ctx.db.select({ id: tasks.id }).from(tasks).where(eq(tasks.id, input.taskId))
      if (!task) throw new TRPCError({ code: 'NOT_FOUND', message: 'המשימה לא נמצאה' })
      await ctx.db
        .update(commitments)
        .set({ taskId: input.taskId, updatedAt: new Date().toISOString() })
        .where(and(eq(commitments.id, input.commitmentId), isNull(commitments.taskId)))
      await syncItemFromCommitment(ctx.db, input.commitmentId)
      return { ok: true as const, taskId: input.taskId }
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
      // Close any cross-domain insights that were built from this commitment.
      await closeInsightsForCommitment(ctx.db, input.commitmentId)
      await syncItemFromCommitment(ctx.db, input.commitmentId)
      return { dismissed: true }
    }),

  /** Creates a contact for an unknown group sender and attaches this commitment to them. */
  saveUnknownContact: protectedProcedure
    .input(z.object({ commitmentId: z.string().min(1), name: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const c = await proposedUnknown(ctx.db, input.commitmentId)
      if (c.source === 'slack_channel') {
        // A Slack sender: create from the member's profile and link the Slack identity.
        const [m] = await ctx.db.select().from(slackMembers).where(eq(slackMembers.userId, c.senderJid))
        const name = input.name?.trim() || m?.realName || m?.displayName || c.senderName?.trim() || 'איש קשר מסלאק'
        const person = await peopleRouter.createCaller(ctx).create({ name, ...(m?.email ? { email: m.email } : {}) })
        await attachSlackMemberToPerson(ctx.db, c.senderJid, person.id)
        await attachCommitmentPerson(ctx.db, c.id, person.id)
        return { personId: person.id }
      }
      const name = input.name?.trim() || c.senderName?.trim() || 'מספר לא מוכר'
      const phone = phoneFromWhatsappJid(c.senderJid)
      const person = await peopleRouter.createCaller(ctx).create({ name, ...(phone ? { phone } : {}) })
      await linkWhatsappSender(ctx.db, person.id, c.senderJid)
      await attachCommitmentPerson(ctx.db, c.id, person.id)
      return { personId: person.id }
    }),

  /** Links an unknown group sender to an existing person without changing that person's phone. */
  linkUnknownContact: protectedProcedure
    .input(z.object({ commitmentId: z.string().min(1), personId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const c = await proposedUnknown(ctx.db, input.commitmentId)
      const [person] = await ctx.db.select({ id: people.id }).from(people).where(eq(people.id, input.personId))
      if (!person) throw new TRPCError({ code: 'NOT_FOUND', message: 'Person not found' })
      if (c.source === 'slack_channel') await attachSlackMemberToPerson(ctx.db, c.senderJid, person.id)
      else await linkWhatsappSender(ctx.db, person.id, c.senderJid)
      await attachCommitmentPerson(ctx.db, c.id, person.id)
      return { personId: person.id }
    }),
})

async function proposedUnknown(db: Context['db'], commitmentId: string) {
  const [c] = await db.select().from(commitments).where(eq(commitments.id, commitmentId))
  if (!c) throw new TRPCError({ code: 'NOT_FOUND', message: 'Commitment not found' })
  if (c.status !== 'proposed') throw new TRPCError({ code: 'BAD_REQUEST', message: `Commitment already ${c.status}` })
  if (c.personId || !c.senderJid) throw new TRPCError({ code: 'BAD_REQUEST', message: 'ההתחייבות כבר משויכת לאיש קשר' })
  return { ...c, senderJid: c.senderJid }
}

async function attachCommitmentPerson(db: Context['db'], commitmentId: string, personId: string) {
  await db
    .update(commitments)
    .set({ personId, senderJid: null, senderName: null, updatedAt: new Date().toISOString() })
    .where(eq(commitments.id, commitmentId))
}

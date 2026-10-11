import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { and, asc, desc, eq } from 'drizzle-orm'
import {
  commitments,
  meetings,
  people,
  projectPeople,
  whatsappDmMessages,
  whatsappMessages,
  COMMITMENT_STATUSES,
} from '@ak-system/database'
import { router, protectedProcedure, type Context } from '../trpc'
import { phoneFromWhatsappJid } from '../lib/phone'
import { linkWhatsappSender } from '../services/person-context'
import { commitmentSourceUrl } from '../services/commitments'
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
      if (!c.personId) throw new TRPCError({ code: 'BAD_REQUEST', message: 'שייך איש קשר לפני אישור' })
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
      // Close any cross-domain insights that were built from this commitment.
      await closeInsightsForCommitment(ctx.db, input.commitmentId)
      return { dismissed: true }
    }),

  /** Creates a contact for an unknown group sender and attaches this commitment to them. */
  saveUnknownContact: protectedProcedure
    .input(z.object({ commitmentId: z.string().min(1), name: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const c = await proposedUnknown(ctx.db, input.commitmentId)
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
      await linkWhatsappSender(ctx.db, person.id, c.senderJid)
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

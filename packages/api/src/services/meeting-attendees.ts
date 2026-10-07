import { TRPCError } from '@trpc/server'
import { and, eq, sql } from 'drizzle-orm'
import { meetingAnalyses, meetingPeople, meetings, people } from '@ak-system/database'
import type { Context } from '../trpc'
import { ensureSelfPerson, isSelfPersonName, omitSelfParticipants } from './self-person'

type Db = Context['db']

export type StoredParticipant = {
  name: string
  confirmed: boolean
  personId?: string
}

export type ResolvedPerson = {
  id: string
  name: string
  created: boolean
}

function parseParticipants(raw: string | null): StoredParticipant[] {
  if (!raw) return []
  const parsed = JSON.parse(raw) as StoredParticipant[]
  return Array.isArray(parsed) ? omitSelfParticipants(parsed) : []
}

export async function resolvePersonForMeeting(
  db: Db,
  input: { personId?: string; name?: string },
): Promise<ResolvedPerson> {
  if (!input.personId && isSelfPersonName(input.name)) {
    const self = await ensureSelfPerson(db)
    return { id: self.id, name: self.name, created: false }
  }

  if (input.personId) {
    const [row] = await db.select().from(people).where(eq(people.id, input.personId)).limit(1)
    if (!row) {
      throw new TRPCError({ code: 'NOT_FOUND', message: 'איש הקשר לא נמצא' })
    }
    if (row.status !== 'confirmed') {
      await db.update(people).set({ status: 'confirmed' }).where(eq(people.id, row.id))
    }
    return { id: row.id, name: row.name, created: false }
  }

  const normalized = input.name?.trim() ?? ''
  if (!normalized) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'חסר שם או איש קשר' })
  }

  const rows = await db
    .select()
    .from(people)
    .where(sql`lower(trim(${people.name})) = lower(${normalized})`)
  const usable = rows.filter((row) => row.status !== 'ignored')
  if (usable.length > 1) {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'כמה אנשי קשר עם אותו שם. בחר אחד מהרשימה.',
    })
  }
  if (usable.length === 1) {
    const row = usable[0]!
    if (row.status !== 'confirmed') {
      await db.update(people).set({ status: 'confirmed' }).where(eq(people.id, row.id))
    }
    return { id: row.id, name: row.name, created: false }
  }

  const id = 'p' + Date.now() + Math.random().toString(36).slice(2, 6)
  await db.insert(people).values({
    id,
    name: normalized,
    status: 'confirmed',
    source: 'manual',
    color: '#2dd4bf',
    createdAt: new Date().toISOString(),
  })
  return { id, name: normalized, created: true }
}

export async function attachPersonToMeeting(db: Db, meetingId: string, personId: string) {
  const [meeting] = await db
    .select({ id: meetings.id })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
    .limit(1)
  if (!meeting) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'הפגישה לא נמצאה' })
  }
  const existing = await db
    .select({ personId: meetingPeople.personId })
    .from(meetingPeople)
    .where(and(eq(meetingPeople.meetingId, meetingId), eq(meetingPeople.personId, personId)))
    .limit(1)
  if (existing.length === 0) {
    await db.insert(meetingPeople).values({ meetingId, personId })
  }
}

export async function detachPersonFromMeeting(db: Db, meetingId: string, personId: string) {
  await db
    .delete(meetingPeople)
    .where(and(eq(meetingPeople.meetingId, meetingId), eq(meetingPeople.personId, personId)))
}

async function loadAnalysis(db: Db, analysisId: string) {
  const [analysis] = await db
    .select()
    .from(meetingAnalyses)
    .where(eq(meetingAnalyses.id, analysisId))
    .limit(1)
  if (!analysis) {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'הניתוח לא נמצא' })
  }
  return analysis
}

/** A Notion (or any) attendee already on this meeting, matched by name. Other attendees stay. */
async function personAlreadyOnMeeting(db: Db, meetingId: string, name: string): Promise<string | null> {
  const normalized = name.trim().toLowerCase()
  if (!normalized) return null
  const links = await db
    .select({ personId: meetingPeople.personId, name: people.name })
    .from(meetingPeople)
    .innerJoin(people, eq(people.id, meetingPeople.personId))
    .where(eq(meetingPeople.meetingId, meetingId))
  const hits = links.filter((link) => link.name.trim().toLowerCase() === normalized)
  return hits.length === 1 ? hits[0]!.personId : null
}

function participantAt(participants: StoredParticipant[], index: number): StoredParticipant {
  if (index < 0 || index >= participants.length || !participants[index]) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'המשתתף לא נמצא ברשימה' })
  }
  return participants[index]
}

export async function acceptAnalysisParticipant(
  db: Db,
  input: { analysisId: string; participantIndex: number; personId?: string; name?: string },
): Promise<ResolvedPerson> {
  const analysis = await loadAnalysis(db, input.analysisId)
  const participants = parseParticipants(analysis.participantsJson)
  const current = participantAt(participants, input.participantIndex)
  const resolved = await resolvePersonForMeeting(db, {
    personId: input.personId,
    name: input.personId ? undefined : (input.name?.trim() || current.name),
  })
  const previousId = current.personId ?? (await personAlreadyOnMeeting(db, analysis.meetingId, current.name))
  if (previousId && previousId !== resolved.id) {
    await detachPersonFromMeeting(db, analysis.meetingId, previousId)
  }
  participants[input.participantIndex] = {
    ...current,
    name: resolved.name,
    personId: resolved.id,
    confirmed: true,
  }
  await db
    .update(meetingAnalyses)
    .set({
      participantsJson: JSON.stringify(participants),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(meetingAnalyses.id, input.analysisId))
  await attachPersonToMeeting(db, analysis.meetingId, resolved.id)
  return resolved
}

export async function removeAnalysisParticipant(
  db: Db,
  input: { analysisId: string; participantIndex: number },
) {
  const analysis = await loadAnalysis(db, input.analysisId)
  const participants = parseParticipants(analysis.participantsJson)
  const current = participantAt(participants, input.participantIndex)
  const personId = current.personId ?? (await personAlreadyOnMeeting(db, analysis.meetingId, current.name))
  if (personId) {
    await detachPersonFromMeeting(db, analysis.meetingId, personId)
  }
  participants.splice(input.participantIndex, 1)
  await db
    .update(meetingAnalyses)
    .set({
      participantsJson: JSON.stringify(participants),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(meetingAnalyses.id, input.analysisId))
  return { ok: true as const }
}

export async function linkAnalysisParticipant(
  db: Db,
  input: { analysisId: string; participantIndex: number; personId: string },
) {
  const resolved = await resolvePersonForMeeting(db, { personId: input.personId })
  const analysis = await loadAnalysis(db, input.analysisId)
  const participants = parseParticipants(analysis.participantsJson)
  const current = participantAt(participants, input.participantIndex)
  participants[input.participantIndex] = {
    ...current,
    name: resolved.name,
    personId: resolved.id,
    confirmed: true,
  }
  await db
    .update(meetingAnalyses)
    .set({
      participantsJson: JSON.stringify(participants),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(meetingAnalyses.id, input.analysisId))
  await attachPersonToMeeting(db, analysis.meetingId, resolved.id)
  return { success: true as const, personId: resolved.id }
}

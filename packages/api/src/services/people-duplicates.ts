/**
 * Suspected duplicate people, ranked like Google Contacts: same email, same phone, then name similarity.
 * Pairs the owner marked "not the same person" are never suggested again.
 */
import { eq, inArray, ne, or, sql } from 'drizzle-orm'
import {
  duplicateReviews,
  meetingNotePeople,
  meetingPeople,
  meetings,
  people,
  personExternalIds,
  seriesRoster,
  taskPeople,
  tasks,
  userSettings,
  whatsappPersonLinks,
  type getDb,
} from '@ak-system/database'
import { normalizeParticipantName } from '../lib/calendar-participants'
import { normalizePhone } from '../lib/phone'

type Db = ReturnType<typeof getDb>

export interface DuplicatePerson {
  id: string
  name: string
  email: string | null
  phone: string | null
  company: string | null
  role: string | null
  status: string
  source: string
}

export interface DuplicatePair {
  personA: DuplicatePerson
  personB: DuplicatePerson
  confidence: number
  reasons: string[]
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[b.length]
}

function sameTokens(a: string, b: string): boolean {
  const ta = a.split(' ').filter(Boolean).sort().join(' ')
  const tb = b.split(' ').filter(Boolean).sort().join(' ')
  return ta.length > 0 && ta === tb
}

/** Scores one pair; null when nothing suggests they are the same person. */
export function scorePair(a: DuplicatePerson, b: DuplicatePerson): { confidence: number; reasons: string[] } | null {
  const reasons: string[] = []
  let confidence = 0
  const emailA = a.email?.trim().toLowerCase()
  const emailB = b.email?.trim().toLowerCase()
  if (emailA && emailA === emailB) {
    confidence = Math.max(confidence, 1)
    reasons.push('אותו אימייל')
  }
  const phoneA = normalizePhone(a.phone)
  const phoneB = normalizePhone(b.phone)
  if (phoneA && phoneA === phoneB) {
    confidence = Math.max(confidence, 0.95)
    reasons.push('אותו טלפון')
  }
  const nameA = normalizeParticipantName(a.name)
  const nameB = normalizeParticipantName(b.name)
  if (nameA.length >= 3 && nameB.length >= 3) {
    const companyA = a.company?.trim().toLowerCase()
    const sameCompany = !!companyA && companyA === b.company?.trim().toLowerCase()
    if (nameA === nameB || sameTokens(nameA, nameB)) {
      confidence = Math.max(confidence, sameCompany ? 0.9 : 0.85)
      reasons.push('אותו שם')
    } else if (Math.abs(nameA.length - nameB.length) <= 3) {
      const dist = levenshtein(nameA, nameB)
      const similarity = 1 - dist / Math.max(nameA.length, nameB.length)
      if (dist < 3 && sameCompany) {
        confidence = Math.max(confidence, 0.8)
        reasons.push('שם דומה · אותה חברה')
      } else if (similarity > 0.85) {
        confidence = Math.max(confidence, 0.7)
        reasons.push('שם דומה')
      }
    }
  }
  return confidence > 0 ? { confidence, reasons } : null
}

function canonical(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a]
}

export async function findDuplicatePairs(db: Db): Promise<DuplicatePair[]> {
  const rows: DuplicatePerson[] = await db
    .select({
      id: people.id,
      name: people.name,
      email: people.email,
      phone: people.phone,
      company: people.company,
      role: people.role,
      status: people.status,
      source: people.source,
    })
    .from(people)
    .where(ne(people.status, 'ignored'))
  const reviewed = new Set(
    (await db.select({ a: duplicateReviews.personIdA, b: duplicateReviews.personIdB }).from(duplicateReviews))
      .map((r) => `${r.a}|${r.b}`),
  )
  const pairs: DuplicatePair[] = []
  for (let i = 0; i < rows.length; i++) {
    for (let j = i + 1; j < rows.length; j++) {
      const [x, y] = canonical(rows[i].id, rows[j].id)
      if (reviewed.has(`${x}|${y}`)) continue
      const score = scorePair(rows[i], rows[j])
      if (!score) continue
      // Keep the confirmed/older-looking record on the left so "keep left" is the natural default.
      const leftFirst = rows[i].status === 'confirmed' || rows[j].status !== 'confirmed'
      pairs.push({
        personA: leftFirst ? rows[i] : rows[j],
        personB: leftFirst ? rows[j] : rows[i],
        ...score,
      })
    }
  }
  return pairs.sort((p, q) => q.confidence - p.confidence || p.personA.name.localeCompare(q.personA.name))
}

const SETTINGS_ID = 'default'

/**
 * Nightly: announce duplicate pairs not reported before, as one in-app notification.
 * Pairs already announced are remembered in `user_settings.duplicates_notified_pairs`.
 */
export async function notifyNewDuplicates(
  db: Db,
  notify: (n: { title: string; body: string; url: string }) => Promise<unknown>,
): Promise<{ total: number; fresh: number }> {
  const pairs = await findDuplicatePairs(db)
  const keys = pairs.map((p) => canonical(p.personA.id, p.personB.id).join('|'))
  const [settings] = await db
    .select({ id: userSettings.id, notified: userSettings.duplicatesNotifiedPairs })
    .from(userSettings)
    .where(eq(userSettings.id, SETTINGS_ID))
  let previous: string[] = []
  try {
    previous = settings?.notified ? JSON.parse(settings.notified) : []
  } catch {
    previous = []
  }
  const seen = new Set(previous)
  const fresh = pairs.filter((_, i) => !seen.has(keys[i]))
  if (fresh.length > 0) {
    const names = fresh.slice(0, 3).map((p) => `${p.personA.name} · ${p.personB.name}`).join('\n')
    await notify({
      title: `${pairs.length} כפילויות חשודות`,
      body: `${fresh.length} חדשות מאז הבדיקה הקודמת:\n${names}${fresh.length > 3 ? `\nועוד ${fresh.length - 3}` : ''}`,
      url: '/people/duplicates',
    })
  }
  const now = new Date().toISOString()
  const value = JSON.stringify(keys)
  if (settings) {
    await db.update(userSettings).set({ duplicatesNotifiedPairs: value, updatedAt: now }).where(eq(userSettings.id, SETTINGS_ID))
  } else {
    await db.insert(userSettings).values({ id: SETTINGS_ID, duplicatesNotifiedPairs: value, updatedAt: now })
  }
  return { total: pairs.length, fresh: fresh.length }
}

export async function markNotDuplicate(db: Db, idA: string, idB: string): Promise<void> {
  const [a, b] = canonical(idA, idB)
  await db
    .insert(duplicateReviews)
    .values({ id: `dr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, personIdA: a, personIdB: b, createdAt: new Date().toISOString() })
    .onConflictDoNothing()
}

async function personFootprint(db: Db, personId: string) {
  const [person] = await db.select().from(people).where(eq(people.id, personId)).limit(1)
  if (!person) return null
  const meetingRows = await db
    .select({ id: meetings.id, title: meetings.title, date: meetings.date })
    .from(meetingPeople)
    .innerJoin(meetings, eq(meetings.id, meetingPeople.meetingId))
    .where(eq(meetingPeople.personId, personId))
  const taskLinks = await db.select({ taskId: taskPeople.taskId }).from(taskPeople).where(eq(taskPeople.personId, personId))
  const taskIds = [...new Set(taskLinks.map((t) => t.taskId))]
  const taskRows = await db
    .select({ id: tasks.id, title: tasks.title, done: tasks.done })
    .from(tasks)
    .where(taskIds.length ? or(inArray(tasks.id, taskIds), eq(tasks.assigneeId, personId)) : eq(tasks.assigneeId, personId))
  const [{ notes }] = await db
    .select({ notes: sql<number>`count(*)` })
    .from(meetingNotePeople)
    .where(eq(meetingNotePeople.personId, personId))
  const externalIds = await db
    .select({ provider: personExternalIds.provider, externalId: personExternalIds.externalId, displayName: personExternalIds.displayName })
    .from(personExternalIds)
    .where(eq(personExternalIds.personId, personId))
  const whatsapp = await db
    .select({ jid: whatsappPersonLinks.whatsappJid })
    .from(whatsappPersonLinks)
    .where(eq(whatsappPersonLinks.personId, personId))
  const [{ circles }] = await db
    .select({ circles: sql<number>`count(*)` })
    .from(seriesRoster)
    .where(eq(seriesRoster.personId, personId))
  return {
    person,
    meetings: meetingRows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 10),
    meetingCount: meetingRows.length,
    tasks: taskRows.slice(0, 10),
    taskCount: taskRows.length,
    notionNoteCount: Number(notes),
    externalIds,
    whatsappJids: whatsapp.map((w) => w.jid),
    circleCount: Number(circles),
  }
}

export async function compareDuplicatePair(db: Db, idA: string, idB: string) {
  const [a, b] = await Promise.all([personFootprint(db, idA), personFootprint(db, idB)])
  if (!a || !b) return null
  const score = scorePair(a.person as DuplicatePerson, b.person as DuplicatePerson)
  return { a, b, confidence: score?.confidence ?? 0, reasons: score?.reasons ?? [] }
}

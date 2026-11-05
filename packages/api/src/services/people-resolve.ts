/**
 * Resolves a name from an analysis (a participant, an action-item owner) to one of a known set of
 * People records — the people chosen for a recording or confirmed on a meeting. Shared by the
 * analysis post-processing and commitments (docs/specs/recording-uses-chosen-people.md).
 */
import { inArray } from 'drizzle-orm'
import { people, personAliases, type getDb } from '@ak-system/database'
import { normalizeParticipantName } from '../lib/calendar-participants'
import { addAlias, normalizeAlias } from './person-resolution'
import type { AnalysisResult } from './meeting-analysis'

type Db = ReturnType<typeof getDb>

export interface PersonCandidate {
  id: string
  name: string
  aliases: string[]
  role?: string | null
  company?: string | null
}

/** Same person by name: equal after normalising, or `b`'s first name is one of `a`'s words. */
export function namesMatch(a: string, b: string): boolean {
  const x = normalizeParticipantName(a)
  const y = normalizeParticipantName(b)
  if (!x || !y) return false
  if (x === y) return true
  const first = y.split(' ')[0]
  return first.length >= 2 && x.split(' ').includes(first)
}

/**
 * The one candidate a name means, by exact name/alias first and then by `namesMatch`. Returns null
 * when nothing matches or when the name fits more than one candidate.
 */
export function resolveCandidate<T extends { id: string; name: string; aliases?: string[] }>(
  name: string | null | undefined,
  candidates: T[],
): T | null {
  const spoken = name?.trim()
  if (!spoken) return null
  const norm = normalizeAlias(spoken)
  if (!norm) return null
  const forms = (c: T) => [c.name, ...(c.aliases ?? [])]
  const exact = candidates.filter((c) => forms(c).some((form) => normalizeAlias(form) === norm))
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) return null
  const loose = candidates.filter((c) => forms(c).some((form) => namesMatch(spoken, form)))
  return loose.length === 1 ? loose[0] : null
}

/** People rows with their aliases, in the order of `personIds`. Unknown ids are dropped. */
export async function loadPersonCandidates(db: Db, personIds: string[]): Promise<PersonCandidate[]> {
  const ids = [...new Set(personIds)]
  if (ids.length === 0) return []
  const rows: { id: string; name: string; role: string | null; company: string | null }[] = await db
    .select({ id: people.id, name: people.name, role: people.role, company: people.company })
    .from(people)
    .where(inArray(people.id, ids))
  const aliases: { personId: string; alias: string }[] = await db
    .select({ personId: personAliases.personId, alias: personAliases.alias })
    .from(personAliases)
    .where(inArray(personAliases.personId, ids))
  const byId = new Map(rows.map((r) => [r.id, { ...r, aliases: [] as string[] }]))
  for (const a of aliases) byId.get(a.personId)?.aliases.push(a.alias)
  return ids.map((id) => byId.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c))
}

/** `personId` is present only when the item is linked, so unlinked items keep their old shape. */
export interface LinkedParticipant {
  name: string
  confirmed: boolean
  personId?: string
}

export interface LinkedActionItem {
  content: string
  owner?: string
  personId?: string
}

/**
 * Deterministic pass over the model's people: a `personId` outside the candidates is dropped, an
 * item without one is matched by name/alias, and a linked item takes the People name. When the
 * model linked a form the name/alias match would not have caught (e.g. "עומרי" → Omri Ben Simon),
 * that form is saved as an alias so the deterministic match catches it next time.
 */
export async function linkAnalysisPeople(
  db: Db,
  result: Pick<AnalysisResult, 'participants' | 'actionItems'>,
  candidates: PersonCandidate[],
): Promise<{ participants: LinkedParticipant[]; actionItems: LinkedActionItem[] }> {
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const learned = new Set<string>()

  const link = async (spoken: string, spokenAs: string | undefined, modelId: unknown): Promise<PersonCandidate | null> => {
    const fromModel = typeof modelId === 'string' ? byId.get(modelId) ?? null : null
    const said = spokenAs?.trim() || spoken
    if (!fromModel) return resolveCandidate(said, candidates) ?? resolveCandidate(spoken, candidates)
    const key = `${fromModel.id}|${normalizeAlias(said)}`
    if (said && !learned.has(key) && resolveCandidate(said, candidates)?.id !== fromModel.id) {
      learned.add(key)
      try {
        if (await addAlias(db, fromModel.id, said, 'sync', { origin: 'analysis' })) fromModel.aliases.push(said)
      } catch {
        // The form already means someone else — keep the link, don't teach a clashing alias.
      }
    }
    return fromModel
  }

  const participants: LinkedParticipant[] = []
  for (const raw of result.participants ?? []) {
    const p = raw as typeof raw & { personId?: unknown; spokenAs?: string }
    const name = typeof p.name === 'string' ? p.name.trim() : ''
    if (!name) continue
    const person = candidates.length ? await link(name, p.spokenAs, p.personId) : null
    participants.push(
      person ? { name: person.name, confirmed: Boolean(p.confirmed), personId: person.id } : { name, confirmed: Boolean(p.confirmed) },
    )
  }

  const actionItems: LinkedActionItem[] = []
  for (const raw of result.actionItems ?? []) {
    const a = raw as typeof raw & { personId?: unknown; ownerSpokenAs?: string }
    const owner = typeof a.owner === 'string' ? a.owner.trim() : ''
    const person = candidates.length && (owner || a.personId) ? await link(owner, a.ownerSpokenAs, a.personId) : null
    actionItems.push({
      content: a.content,
      ...(person ? { owner: person.name, personId: person.id } : owner ? { owner } : {}),
    })
  }
  return { participants, actionItems }
}

/**
 * Adds `personName` (the current People name) to analysis items linked by `personId`. Items whose
 * person no longer exists lose the link; unlinked items are returned as they are.
 */
export async function withPersonNames<T extends { personId?: unknown }>(
  db: Db,
  items: T[],
): Promise<(Omit<T, 'personId'> & { personId?: string; personName?: string })[]> {
  const ids = [...new Set(items.map((i) => i.personId).filter((id): id is string => typeof id === 'string' && id.length > 0))]
  const rows: { id: string; name: string }[] = ids.length
    ? await db.select({ id: people.id, name: people.name }).from(people).where(inArray(people.id, ids))
    : []
  const names = new Map(rows.map((p) => [p.id, p.name]))
  return items.map((item) => {
    const { personId, ...rest } = item
    const name = typeof personId === 'string' ? names.get(personId) : undefined
    return name ? { ...rest, personId: personId as string, personName: name } : rest
  })
}

/**
 * Resolves the `people` row that represents the app owner ("me").
 *
 * There is no `isSelf` column: the owner is identified by name, the convention
 * Notion sync established (`NOTION_USER_NAME`). Both Notion sync and the
 * default-assignee logic go through here so they converge on a single row
 * instead of creating duplicates.
 */

import { getDb, people, sql } from '@ak-system/database'
import { normalizeParticipantName } from '../lib/calendar-participants'

type Db = ReturnType<typeof getDb>

/** Names that mean the owner, besides whatever `NOTION_USER_NAME` is set to. */
const OWNER_ALIASES = ['Alpir Kritzler', 'אלפיר קריצלר', 'Alpir', 'אלפיר']

export interface SelfPerson {
  id: string
  name: string
  color: string | null
}

/** Display name of the owner's contact row. */
export function getSelfPersonName(): string {
  return process.env.NOTION_USER_NAME?.trim() || 'Alpir Kritzler'
}

/** True when `name` is the owner and not some other person. Whole-string match only. */
export function isSelfPersonName(name: string | null | undefined): boolean {
  const norm = normalizeParticipantName(name ?? '')
  if (!norm) return false
  const aliases = new Set(
    [getSelfPersonName(), ...OWNER_ALIASES].map((alias) => normalizeParticipantName(alias)).filter(Boolean),
  )
  return aliases.has(norm)
}

/**
 * Who a task belongs to. The owner's own items resolve to his canonical contact
 * id (shown as "אני"), never to a duplicate row that happens to share a first name.
 * Other names match the list exactly. Returns '' when nobody matches.
 */
export function matchTaskAssigneeId(
  ownerName: string | null | undefined,
  peopleList: { id: string; name: string }[],
): string {
  if (!ownerName?.trim()) return ''
  if (isSelfPersonName(ownerName)) {
    const canonical = getSelfPersonName().toLowerCase()
    return (
      peopleList.find((person) => person.name.toLowerCase() === canonical)?.id ??
      peopleList.find((person) => isSelfPersonName(person.name))?.id ??
      ''
    )
  }
  const normalized = ownerName.trim().toLowerCase()
  const match = peopleList.find((person) => person.name.toLowerCase() === normalized)
  return match && !isSelfPersonName(match.name) ? match.id : ''
}

/** Drop the owner from a suggested-participant list. He recorded the conversation. */
export function omitSelfParticipants<T extends { name: string }>(participants: T[]): T[] {
  return participants.filter((participant) => !isSelfPersonName(participant.name))
}

/**
 * Injected into every model prompt. The owner is Alpir Kritzler, he is who we
 * talk to, and every recording already includes him.
 */
export function ownerIdentityPrompt(): string {
  const name = getSelfPersonName()
  return [
    '## Principal',
    `The user is ${name} (אלפיר קריצלר / Alpir Kritzler). He is the owner of this system and the only principal.`,
    'Address him in the second person (אתה / you). Never talk about him as a third party, and never add him to people, contacts, or participant lists.',
    'Every recorded conversation was recorded by him and he is in it. When listing who else was there, omit him (Alpir, אלפיר, Alpir Kritzler, אלפיר קריצלר). An action that is his belongs to "אני", not to a new contact.',
  ].join('\n')
}

/** Find the owner's contact row, creating it on first use. */
export async function ensureSelfPerson(db: Db = getDb()): Promise<SelfPerson> {
  const name = getSelfPersonName()
  const [existing] = await db
    .select({ id: people.id, name: people.name, color: people.color })
    .from(people)
    .where(sql`lower(${people.name}) = ${name.toLowerCase()}`)
    .limit(1)
  if (existing) return existing

  const row = {
    id: 'p_me_' + Date.now() + Math.random().toString(36).slice(2, 7),
    name,
    color: '#e8c547',
  }
  await db.insert(people).values({
    id: row.id,
    name: row.name,
    email: null,
    role: null,
    color: row.color,
    status: 'confirmed',
    source: 'manual',
    notionPageId: null,
    createdAt: new Date().toISOString(),
  })
  return row
}

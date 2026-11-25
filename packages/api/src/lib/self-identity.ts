/**
 * Client-safe owner identity. No database or Node builtins — browser components
 * import this module directly so they do not pull the API barrel (and web-push) in.
 */

import { normalizeParticipantName } from './calendar-participants'

/** Names that mean the owner, besides whatever `NOTION_USER_NAME` is set to. */
const OWNER_ALIASES = ['Alpir Kritzler', 'אלפיר קריצלר', 'Alpir', 'אלפיר']

/** Display name of the owner's contact row. */
export function getSelfPersonName(): string {
  return process.env.NOTION_USER_NAME?.trim() || 'Alpir Kritzler'
}

const FIRST_NAMES = new Set(['alpir', 'אלפיר'])
const LAST_NAMES = new Set(['kritzler', 'kritzer', 'קריצלר', 'קריצלר'])

/** Emails that always mean the owner. Extend with `OWNER_EMAILS` (comma separated). */
const OWNER_EMAILS = ['alpirkritz@gmail.com', 'kritzler.alpir@dragontailsystems.com', 'alpir@daz.guru']

export function getOwnerEmails(): Set<string> {
  const extra = (process.env.OWNER_EMAILS ?? '').split(',')
  return new Set([...OWNER_EMAILS, ...extra].map((e) => e.trim().toLowerCase()).filter(Boolean))
}

export function isSelfEmail(email: string | null | undefined): boolean {
  const e = email?.trim().toLowerCase()
  return !!e && getOwnerEmails().has(e)
}

/**
 * True when `name` is the owner and not some other person. Accepts first name alone,
 * first + last in either order ("Kritzler, Alpir"), "Alpir K.", and a trailing
 * "(Dragontail)" / "[EXT]" decoration. "Rom Kritzler" and "Alpir Consulting" are not him.
 */
export function isSelfPersonName(name: string | null | undefined): boolean {
  const stripped = (name ?? '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
  const norm = normalizeParticipantName(stripped)
  if (!norm) return false
  const exact = new Set(
    [getSelfPersonName(), ...OWNER_ALIASES].map((alias) => normalizeParticipantName(alias)).filter(Boolean),
  )
  if (exact.has(norm)) return true
  const tokens = norm.split(' ')
  if (tokens.length !== 2) return false
  const [x, y] = tokens as [string, string]
  const isLast = (t: string) => LAST_NAMES.has(t) || t === 'k'
  return (FIRST_NAMES.has(x) && isLast(y)) || (FIRST_NAMES.has(y) && LAST_NAMES.has(x))
}

/** The owner by name or by any of his emails. */
export function isSelfIdentity(who: { name?: string | null; email?: string | null }): boolean {
  return isSelfEmail(who.email) || isSelfPersonName(who.name)
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

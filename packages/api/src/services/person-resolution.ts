/**
 * One place that answers "which person is this?" for every source (meetings, WhatsApp, Notion,
 * email, voice, analysis). Order: email, phone, WhatsApp link, exact alias or name, then fuzzy.
 * Fuzzy never links on its own; it returns candidates for the identity queue.
 */
import { and, eq, ne } from 'drizzle-orm'
import {
  identityQueue,
  people,
  personAliases,
  whatsappPersonLinks,
  type getDb,
} from '@ak-system/database'
import { normalizePhone, phoneFromWhatsappJid } from '../lib/phone'
import { levenshtein } from './people-duplicates'

type Db = ReturnType<typeof getDb>

export type ResolveInput = { name?: string | null; email?: string | null; phone?: string | null; jid?: string | null }

export type Resolution =
  | { kind: 'match'; personId: string; via: 'email' | 'phone' | 'jid' | 'alias' | 'name' }
  | { kind: 'suggestion'; candidates: { id: string; name: string }[] }
  | { kind: 'none' }

const NIQQUD = /[֑-ׇ]/g
const GERESH = /[׳'’`´]/g

/**
 * Match key for a name: lowercase, no niqqud or geresh (ג׳ורדן = גורדן), "Last, First" and any
 * other word order collapse to the same sorted tokens.
 */
export function normalizeAlias(name: string): string {
  const flipped = /^[^,]+,[^,]+$/.test(name) ? name.split(',').reverse().join(' ') : name
  const tokens = flipped
    .normalize('NFKC')
    .toLowerCase()
    .replace(NIQQUD, '')
    .replace(GERESH, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean)
    .sort()
  return tokens.join(' ')
}

type PersonRow = { id: string; name: string; email: string | null; phone: string | null }

async function loadUsablePeople(db: Db): Promise<PersonRow[]> {
  return db
    .select({ id: people.id, name: people.name, email: people.email, phone: people.phone })
    .from(people)
    .where(ne(people.status, 'ignored'))
}

/** Ids of every person a normalised name could mean by exact name or alias. */
function exactHits(norm: string, rows: PersonRow[], aliases: { personId: string; aliasNorm: string }[]) {
  const byAlias = new Set(aliases.filter((a) => a.aliasNorm === norm).map((a) => a.personId))
  const byName = new Set(rows.filter((r) => normalizeAlias(r.name) === norm).map((r) => r.id))
  return { byAlias, byName }
}

/** People whose name or alias is a near miss, or shares the whole of a short name ("ירדן"). */
function fuzzyCandidates(
  norm: string,
  rows: PersonRow[],
  aliases: { personId: string; aliasNorm: string }[],
): { id: string; name: string }[] {
  if (norm.length < 3) return []
  const tokens = norm.split(' ')
  const keysFor = (id: string, name: string) => [normalizeAlias(name), ...aliases.filter((a) => a.personId === id).map((a) => a.aliasNorm)]
  const out: { id: string; name: string }[] = []
  for (const row of rows) {
    const hit = keysFor(row.id, row.name).some((key) => {
      const keyTokens = key.split(' ')
      // A single first name that equals one token of a fuller name, or the reverse.
      const subset =
        (tokens.length === 1 && keyTokens.includes(tokens[0]!)) ||
        (keyTokens.length === 1 && tokens.includes(keyTokens[0]!))
      if (subset) return true
      if (Math.abs(key.length - norm.length) > 2 || Math.min(key.length, norm.length) < 5) return false
      return levenshtein(key, norm) <= 1
    })
    if (hit) out.push({ id: row.id, name: row.name })
  }
  return out
}

export async function resolvePerson(db: Db, input: ResolveInput): Promise<Resolution> {
  const rows = await loadUsablePeople(db)

  const email = input.email?.trim().toLowerCase()
  if (email) {
    const hits = rows.filter((r) => r.email?.trim().toLowerCase() === email)
    if (hits.length === 1) return { kind: 'match', personId: hits[0]!.id, via: 'email' }
  }

  const phone = normalizePhone(input.phone) ?? phoneFromWhatsappJid(input.jid)
  if (input.jid) {
    const [link] = await db
      .select({ personId: whatsappPersonLinks.personId })
      .from(whatsappPersonLinks)
      .where(eq(whatsappPersonLinks.whatsappJid, input.jid))
      .limit(1)
    if (link && rows.some((r) => r.id === link.personId)) return { kind: 'match', personId: link.personId, via: 'jid' }
  }
  if (phone) {
    const hits = rows.filter((r) => normalizePhone(r.phone) === phone)
    if (hits.length === 1) return { kind: 'match', personId: hits[0]!.id, via: 'phone' }
  }

  const norm = input.name ? normalizeAlias(input.name) : ''
  if (!norm) return { kind: 'none' }

  const aliases = await db.select({ personId: personAliases.personId, aliasNorm: personAliases.aliasNorm }).from(personAliases)
  const { byAlias, byName } = exactHits(norm, rows, aliases)
  const usable = new Set(rows.map((r) => r.id))
  const aliasIds = [...byAlias].filter((id) => usable.has(id))
  if (aliasIds.length === 1) return { kind: 'match', personId: aliasIds[0]!, via: 'alias' }
  const nameIds = [...byName]
  if (nameIds.length === 1 && aliasIds.length === 0) return { kind: 'match', personId: nameIds[0]!, via: 'name' }
  if (nameIds.length > 1 || aliasIds.length > 1) {
    const ids = new Set([...aliasIds, ...nameIds])
    return { kind: 'suggestion', candidates: rows.filter((r) => ids.has(r.id)).map((r) => ({ id: r.id, name: r.name })) }
  }

  const candidates = fuzzyCandidates(norm, rows, aliases)
  return candidates.length > 0 ? { kind: 'suggestion', candidates } : { kind: 'none' }
}

export class AliasConflictError extends Error {
  constructor(public readonly ownerId: string, public readonly ownerName: string) {
    super(`השם כבר שייך ל${ownerName}`)
  }
}

/**
 * Teaches the system that `alias` means `personId`. Idempotent for the same person; throws
 * `AliasConflictError` when it already belongs to someone else. Returns false for an alias that
 * adds nothing (empty, or the person's own name).
 */
export async function addAlias(
  db: Db,
  personId: string,
  alias: string,
  source: 'manual' | 'merge' | 'queue' | 'sync' | 'backfill',
  opts: {
    /** A person about to be deleted (a merge source) whose own name must not count as a clash. */
    ignorePersonId?: string
    /** Channel the name was seen in (slack, whatsapp, …). */
    origin?: string
  } = {},
): Promise<boolean> {
  const { ignorePersonId, origin } = opts
  const display = alias.trim()
  const aliasNorm = normalizeAlias(display)
  if (!aliasNorm) return false
  const [person] = await db.select({ name: people.name }).from(people).where(eq(people.id, personId)).limit(1)
  if (!person) return false
  if (normalizeAlias(person.name) === aliasNorm) return false

  const [existing] = await db.select().from(personAliases).where(eq(personAliases.aliasNorm, aliasNorm)).limit(1)
  if (existing) {
    if (existing.personId === personId) return false
    const [owner] = await db.select({ name: people.name }).from(people).where(eq(people.id, existing.personId)).limit(1)
    throw new AliasConflictError(existing.personId, owner?.name ?? '')
  }
  // Another person already carries this as their primary name.
  const others = await db.select({ id: people.id, name: people.name }).from(people).where(ne(people.id, personId))
  const clash = others.find((o) => o.id !== ignorePersonId && normalizeAlias(o.name) === aliasNorm)
  if (clash) throw new AliasConflictError(clash.id, clash.name)

  await db.insert(personAliases).values({
    id: 'pal' + Date.now() + Math.random().toString(36).slice(2, 7),
    personId,
    alias: display,
    aliasNorm,
    source,
    origin: origin ?? null,
    createdAt: new Date().toISOString(),
  })
  return true
}

export async function removeAlias(db: Db, id: string) {
  await db.delete(personAliases).where(eq(personAliases.id, id))
}

export async function listAliases(db: Db, personId: string) {
  return db
    .select({ id: personAliases.id, alias: personAliases.alias, source: personAliases.source, origin: personAliases.origin })
    .from(personAliases)
    .where(eq(personAliases.personId, personId))
}

/** Like `addAlias` for names a source reported itself: a clash or a duplicate is simply skipped. */
export async function learnAlias(db: Db, personId: string, name: string, origin: string): Promise<void> {
  try {
    await addAlias(db, personId, name, 'sync', { origin })
  } catch (err) {
    if (!(err instanceof AliasConflictError)) throw err
  }
}

/** On merge: the source's name and aliases become the target's, so the duplicate cannot return. */
export async function moveAliasesOnMerge(db: Db, fromId: string, toId: string) {
  const [from] = await db.select({ name: people.name }).from(people).where(eq(people.id, fromId)).limit(1)
  const moving = await db.select().from(personAliases).where(eq(personAliases.personId, fromId))
  await db.delete(personAliases).where(eq(personAliases.personId, fromId))
  const names = [...(from ? [from.name] : []), ...moving.map((m) => m.alias)]
  for (const name of names) {
    try {
      await addAlias(db, toId, name, 'merge', { ignorePersonId: fromId, origin: moving.find((m) => m.alias === name)?.origin ?? undefined })
    } catch (err) {
      if (!(err instanceof AliasConflictError)) throw err
    }
  }
}

/**
 * Resolves a name seen by a sync or analysis path. A match returns the person; anything else
 * (a near miss, or nothing) returns null so the caller keeps its own create-or-skip behaviour,
 * and a near miss is parked in the identity queue once per name.
 */
export async function resolveOrQueue(
  db: Db,
  input: ResolveInput & { source: string; context?: string },
): Promise<string | null> {
  const res = await resolvePerson(db, input)
  if (res.kind === 'match') {
    // Matched on something certain (email, phone, WhatsApp link) under a different name:
    // remember that name for this channel, so the next source that only has the name finds them.
    if (input.name && res.via !== 'alias' && res.via !== 'name') {
      await learnAlias(db, res.personId, input.name, input.source)
    }
    return res.personId
  }
  if (res.kind === 'suggestion' && input.name) {
    const nameNorm = normalizeAlias(input.name)
    const [open] = await db
      .select({ id: identityQueue.id })
      .from(identityQueue)
      .where(and(eq(identityQueue.nameNorm, nameNorm), eq(identityQueue.status, 'pending')))
      .limit(1)
    if (!open) {
      await db.insert(identityQueue).values({
        id: 'iq' + Date.now() + Math.random().toString(36).slice(2, 7),
        name: input.name.trim(),
        nameNorm,
        source: input.source,
        context: input.context ?? null,
        candidatePersonId: res.candidates.length === 1 ? res.candidates[0]!.id : null,
        status: 'pending',
        createdAt: new Date().toISOString(),
      })
    }
  }
  return null
}

/**
 * Heuristic: is this an automated/bulk sender we should never surface as a person?
 * Matches common no-reply / system / newsletter patterns on the local-part or display name.
 */
export function isAutomatedSender(address: string | null | undefined, name?: string | null): boolean {
  const addr = (address ?? '').toLowerCase().trim()
  if (!addr || !addr.includes('@')) return true
  const local = addr.split('@')[0] ?? ''
  const hay = `${local} ${(name ?? '').toLowerCase()}`.trim()
  const PATTERNS = [
    /no[\s-]?reply/, /do[\s-]?not[\s-]?reply/, /mailer[\s-]?daemon/, /postmaster/, /\bbounce/, /bounces?[-.]/,
    /\bnotifications?\b/, /newsletter/, /\bdigest\b/, /\bmailer\b/,
    /automated/, /\balerts?\b/, /^info\b/, /^support\b/, /@.*\.mailgun\b/,
    /\bmarketing\b/, /\bcampaign/, /sendgrid|mailchimp|hubspot|salesforce/,
  ]
  return PATTERNS.some((re) => re.test(hay))
}

/** "shani.asaraf@…" → "shani asaraf"; null when the local part isn't two or more name words. */
export function nameFromEmailLocalPart(address: string): string | null {
  const local = address.toLowerCase().split('@')[0] ?? ''
  const words = local.split(/[._-]+/).map((w) => w.replace(/\d+/g, '')).filter((w) => w.length > 1)
  return words.length >= 2 ? words.join(' ') : null
}

export type EmailMatchPerson = { id: string; name: string }

/**
 * The one existing person an unknown address most likely belongs to, by its display name or
 * `first.last` local part: exact name/alias first, then every word of the name found in a
 * fuller one ("David Kotin" ⊂ "Tinko (David Kotin)"). Null when nothing or several match —
 * the caller only ever suggests; it never links on this.
 */
export function matchEmailCandidate(
  input: { name?: string | null; address: string },
  rows: EmailMatchPerson[],
  aliases: { personId: string; aliasNorm: string }[],
): string | null {
  const display = input.name && !input.name.includes('@') ? normalizeAlias(input.name) : ''
  const local = nameFromEmailLocalPart(input.address)
  const keys = [...new Set([display, local ? normalizeAlias(local) : ''].filter(Boolean))]
  const keysFor = (r: EmailMatchPerson) => [normalizeAlias(r.name), ...aliases.filter((a) => a.personId === r.id).map((a) => a.aliasNorm)]
  for (const norm of keys) {
    const exact = rows.filter((r) => keysFor(r).includes(norm))
    if (exact.length === 1) return exact[0]!.id
    if (exact.length > 1) return null
  }
  for (const norm of keys) {
    const tokens = norm.split(' ')
    if (tokens.length < 2) continue
    const within = rows.filter((r) => keysFor(r).some((k) => tokens.every((t) => k.split(' ').includes(t))))
    if (within.length === 1) return within[0]!.id
    if (within.length > 1) return null
  }
  return null
}

/** Confirmed people and every alias, the pool `matchEmailCandidate` picks from. */
export async function loadEmailMatchPool(db: Db): Promise<{ rows: EmailMatchPerson[]; aliases: { personId: string; aliasNorm: string }[] }> {
  const rows = await db.select({ id: people.id, name: people.name }).from(people).where(eq(people.status, 'confirmed'))
  const aliases = await db.select({ personId: personAliases.personId, aliasNorm: personAliases.aliasNorm }).from(personAliases)
  return { rows, aliases }
}

/**
 * Queue an unknown email address (sender or recipient) for review so the user can add them to
 * People, or attach the address to `candidatePersonId` when a name match was found. Unlike
 * resolveOrQueue, this handles the `none` case and carries the email. Deduped by email; a
 * pending row with no candidate gains one when a later run finds it.
 */
export async function queueUnknownEmailSender(
  db: Db,
  input: { name: string; email: string; context?: string; candidatePersonId?: string | null },
): Promise<boolean> {
  const email = input.email.toLowerCase().trim()
  if (!email || isAutomatedSender(email, input.name)) return false
  const existing = await db
    .select({ id: identityQueue.id, status: identityQueue.status, candidatePersonId: identityQueue.candidatePersonId })
    .from(identityQueue)
    .where(eq(identityQueue.email, email))
  // Skip if already queued (pending) or already decided (linked/new/dismissed).
  if (existing.length > 0) {
    const open = existing.find((r) => r.status === 'pending' && !r.candidatePersonId)
    if (open && input.candidatePersonId) {
      await db.update(identityQueue).set({ candidatePersonId: input.candidatePersonId }).where(eq(identityQueue.id, open.id))
    }
    return false
  }
  await db.insert(identityQueue).values({
    id: 'iq' + Date.now() + Math.random().toString(36).slice(2, 7),
    name: (input.name || email).trim(),
    nameNorm: normalizeAlias(input.name || email),
    source: 'email',
    context: input.context ?? null,
    email,
    candidatePersonId: input.candidatePersonId ?? null,
    status: 'pending',
    createdAt: new Date().toISOString(),
  })
  return true
}

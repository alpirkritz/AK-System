/**
 * A person's email addresses as one channel: the `people.email` field ("primary") plus every
 * `person_external_ids` row with provider `email` ("linked"). Mirrors how WhatsApp senders are
 * listed and unlinked on the person card.
 */
import { and, eq, inArray } from 'drizzle-orm'
import { people, personExternalIds, type getDb } from '@ak-system/database'
import { extractAddresses } from './email-sync'
import { upsertPersonExternalId } from './person-external-ids'

type Db = ReturnType<typeof getDb>

export interface PersonEmailAddress {
  address: string
  source: 'primary' | 'linked'
  /** Where a linked address came from: `work-mail`, `manual`, a Google account… */
  accountKey: string | null
}

export class EmailOwnedElsewhereError extends Error {
  constructor(public ownerName: string) {
    super(`הכתובת כבר משויכת ל-${ownerName}`)
    this.name = 'EmailOwnedElsewhereError'
  }
}

export async function listPersonEmails(db: Db, personId: string): Promise<PersonEmailAddress[]> {
  const [person] = await db.select({ email: people.email }).from(people).where(eq(people.id, personId)).limit(1)
  if (!person) return []
  const out = new Map<string, PersonEmailAddress>()
  for (const a of extractAddresses(person.email ?? '')) out.set(a, { address: a, source: 'primary', accountKey: null })
  const linked = await db
    .select({ externalId: personExternalIds.externalId, accountKey: personExternalIds.accountKey })
    .from(personExternalIds)
    .where(and(eq(personExternalIds.personId, personId), eq(personExternalIds.provider, 'email')))
  for (const l of linked) {
    for (const a of extractAddresses(l.externalId)) {
      if (!out.has(a)) out.set(a, { address: a, source: 'linked', accountKey: l.accountKey })
    }
  }
  return [...out.values()]
}

/** The other person (if any) who already owns this address, via either store. */
async function ownerOf(db: Db, address: string, exceptPersonId: string): Promise<{ id: string; name: string } | null> {
  const rows = await db.select({ id: people.id, name: people.name, email: people.email }).from(people)
  const primary = rows.find((p) => p.id !== exceptPersonId && extractAddresses(p.email ?? '').includes(address))
  if (primary) return { id: primary.id, name: primary.name }
  const linked = await db
    .select({ personId: personExternalIds.personId, externalId: personExternalIds.externalId })
    .from(personExternalIds)
    .where(eq(personExternalIds.provider, 'email'))
  const hit = linked.find((l) => l.personId !== exceptPersonId && extractAddresses(l.externalId).includes(address))
  if (!hit) return null
  return { id: hit.personId, name: rows.find((p) => p.id === hit.personId)?.name ?? hit.personId }
}

/**
 * Attach an address to a person. Fills `people.email` when it's empty (so the primary field
 * stays meaningful), otherwise stores it as a linked address. Throws when another person owns it.
 */
export async function addPersonEmail(db: Db, personId: string, raw: string): Promise<{ added: boolean }> {
  const [address] = extractAddresses(raw)
  if (!address) throw new Error('כתובת מייל לא תקינה')
  const owner = await ownerOf(db, address, personId)
  if (owner) throw new EmailOwnedElsewhereError(owner.name)
  const current = await listPersonEmails(db, personId)
  if (current.some((e) => e.address === address)) return { added: false }
  const [person] = await db.select({ email: people.email }).from(people).where(eq(people.id, personId)).limit(1)
  if (!person) throw new Error('איש הקשר לא נמצא')
  if (!person.email?.trim()) {
    await db.update(people).set({ email: address }).where(eq(people.id, personId))
  } else {
    await upsertPersonExternalId(db, { personId, provider: 'email', accountKey: 'manual', externalId: address })
  }
  return { added: true }
}

/** Detach an address from a person, from whichever store holds it. */
export async function removePersonEmail(db: Db, personId: string, raw: string): Promise<{ removed: boolean }> {
  const [address] = extractAddresses(raw)
  if (!address) return { removed: false }
  let removed = false
  const [person] = await db.select({ email: people.email }).from(people).where(eq(people.id, personId)).limit(1)
  if (person && extractAddresses(person.email ?? '').includes(address)) {
    const rest = extractAddresses(person.email ?? '').filter((a) => a !== address)
    await db.update(people).set({ email: rest.length ? rest.join(', ') : null }).where(eq(people.id, personId))
    removed = true
  }
  const linked = await db
    .select({ id: personExternalIds.id, externalId: personExternalIds.externalId })
    .from(personExternalIds)
    .where(and(eq(personExternalIds.personId, personId), eq(personExternalIds.provider, 'email')))
  const ids = linked.filter((l) => extractAddresses(l.externalId).includes(address)).map((l) => l.id)
  if (ids.length) {
    await db.delete(personExternalIds).where(inArray(personExternalIds.id, ids))
    removed = true
  }
  return { removed }
}

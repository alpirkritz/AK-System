import { normalizePhone } from '../lib/phone'

export type PhonePerson = {
  id: string
  name: string
  email: string | null
  phone: string | null
  status: string
}

export type GooglePhoneContact = {
  resourceName: string
  displayName: string
  emails: string[]
  /** Already chosen display value; must survive normalizePhone */
  phone: string
}

export type PhoneMatchBy = 'email' | 'name'

export type PhoneProposal = {
  personId: string
  personName: string
  phone: string
  googleName: string
  matchedBy: PhoneMatchBy
}

export type PhoneSkipReason = 'ambiguous_email' | 'ambiguous_name' | 'conflicting_phones'

export type PhoneSkip = {
  reason: PhoneSkipReason
  googleName: string
  personName?: string
}

export type GooglePhoneNumber = {
  value?: string
  canonicalForm?: string
  type?: string
}

export function hasPhone(phone: string | null | undefined): boolean {
  return !!phone && phone.trim().length > 0
}

export function normalizePersonName(name: string): string {
  return name.trim().replace(/\s+/g, ' ').toLowerCase()
}

/** Prefer a mobile number. Returns the raw string we store, or null when nothing normalizes. */
export function pickGooglePhone(phones: GooglePhoneNumber[]): string | null {
  const ranked = [...phones].sort((a, b) => (a.type === 'mobile' ? 0 : 1) - (b.type === 'mobile' ? 0 : 1))
  for (const p of ranked) {
    const raw = (p.canonicalForm || p.value || '').trim()
    if (raw && normalizePhone(raw)) return raw
  }
  return null
}

function normEmail(email: string | null | undefined): string | null {
  const v = email?.trim().toLowerCase()
  return v || null
}

/**
 * Match Google contacts onto existing people with an empty phone.
 * Never invents a person. Email wins over name. A contact whose email belongs to
 * someone who already has a phone is consumed and not reused as a name match.
 */
export function matchGooglePhones(
  rows: PhonePerson[],
  contacts: GooglePhoneContact[],
): { proposals: PhoneProposal[]; skipped: PhoneSkip[]; unmatched: number } {
  const eligible = rows.filter((p) => p.status !== 'ignored' && !hasPhone(p.phone))
  const byEmail = new Map<string, PhonePerson[]>()
  for (const p of rows) {
    const email = normEmail(p.email)
    if (!email) continue
    const list = byEmail.get(email) ?? []
    list.push(p)
    byEmail.set(email, list)
  }

  const proposals = new Map<string, PhoneProposal>()
  const blocked = new Set<string>()
  const skipped: PhoneSkip[] = []
  const consumed = new Set<string>()
  let unmatched = 0

  const claim = (person: PhonePerson, contact: GooglePhoneContact, matchedBy: PhoneMatchBy) => {
    if (blocked.has(person.id)) return
    const phone = contact.phone.trim()
    const existing = proposals.get(person.id)
    if (!existing) {
      proposals.set(person.id, {
        personId: person.id,
        personName: person.name,
        phone,
        googleName: contact.displayName,
        matchedBy,
      })
      return
    }
    if (existing.matchedBy === 'email' && matchedBy === 'name') return
    if (normalizePhone(existing.phone) === normalizePhone(phone)) {
      if (matchedBy === 'email') existing.matchedBy = 'email'
      return
    }
    proposals.delete(person.id)
    blocked.add(person.id)
    skipped.push({ reason: 'conflicting_phones', googleName: contact.displayName, personName: person.name })
  }

  for (const contact of contacts) {
    if (!normalizePhone(contact.phone)) continue
    const emails = [...new Set(contact.emails.map((e) => normEmail(e)).filter((e): e is string => !!e))]
    const owners = new Map<string, PhonePerson>()
    for (const email of emails) {
      for (const person of byEmail.get(email) ?? []) owners.set(person.id, person)
    }
    if (owners.size === 0) continue
    consumed.add(contact.resourceName)
    const open = [...owners.values()].filter((p) => eligible.some((e) => e.id === p.id) && !blocked.has(p.id))
    if (open.length === 1) claim(open[0]!, contact, 'email')
    else if (open.length > 1) {
      skipped.push({ reason: 'ambiguous_email', googleName: contact.displayName })
    }
  }

  const nameBuckets = new Map<string, PhonePerson[]>()
  for (const p of eligible) {
    if (blocked.has(p.id)) continue
    const key = normalizePersonName(p.name)
    if (key.length < 2) continue
    const list = nameBuckets.get(key) ?? []
    list.push(p)
    nameBuckets.set(key, list)
  }

  for (const contact of contacts) {
    if (consumed.has(contact.resourceName) || !normalizePhone(contact.phone)) continue
    const key = normalizePersonName(contact.displayName)
    if (key.length < 2) {
      unmatched++
      continue
    }
    const raw = (nameBuckets.get(key) ?? []).filter((p) => !blocked.has(p.id))
    if (raw.length === 1) claim(raw[0]!, contact, 'name')
    else if (raw.length > 1) skipped.push({ reason: 'ambiguous_name', googleName: contact.displayName })
    else unmatched++
  }

  return { proposals: [...proposals.values()], skipped, unmatched }
}

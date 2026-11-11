/**
 * Fill empty people.company / jobTitle / notes from Google Contacts. Additive only: a field
 * the owner already filled in the app is never overwritten. Matches existing people only —
 * never inserts a person.
 *
 * Matching order: an existing google_contact identity link, then a unique email match.
 */
import { eq, getDb, people, personExternalIds } from '@ak-system/database'
import { inArray } from 'drizzle-orm'
import { listGoogleConnections, getAccessTokenForConnection } from './google-connections'
import { describePeopleApiError } from './google-phone-fill'

type Db = ReturnType<typeof getDb>

export const PROFILE_FIELDS = ['company', 'jobTitle', 'notes'] as const
export type ProfileField = (typeof PROFILE_FIELDS)[number]

export interface GoogleProfileContact {
  resourceName: string
  displayName: string
  emails: string[]
  company: string | null
  jobTitle: string | null
  /** The contact's Notes field — `biographies` in the People API */
  notes: string | null
}

export interface ProfilePersonRow {
  id: string
  name: string
  email: string | null
  company: string | null
  jobTitle: string | null
  notes: string | null
}

export interface ProfileProposal {
  personId: string
  personName: string
  googleName: string
  fields: Partial<Record<ProfileField, string>>
}

export interface GoogleProfilePreview {
  proposals: ProfileProposal[]
  unmatched: number
  errors: string[]
}

const PERSON_FIELDS = 'names,emailAddresses,organizations,biographies'

function blank(value: string | null | undefined): boolean {
  return !value || value.trim() === ''
}

function clean(value: string | null | undefined): string | null {
  const v = value?.trim()
  return v ? v : null
}

/**
 * Pure matcher. `links` maps a Google resourceName to the person it is already linked to.
 * Emails shared by more than one person are ignored rather than guessed.
 */
export function matchGoogleProfiles(
  rows: ProfilePersonRow[],
  contacts: GoogleProfileContact[],
  links: Map<string, string>,
): { proposals: ProfileProposal[]; unmatched: number } {
  const byId = new Map(rows.map((r) => [r.id, r]))
  const emailOwners = new Map<string, string[]>()
  for (const r of rows) {
    const email = r.email?.trim().toLowerCase()
    if (!email) continue
    emailOwners.set(email, [...(emailOwners.get(email) ?? []), r.id])
  }

  const proposals = new Map<string, ProfileProposal>()
  let unmatched = 0

  for (const c of contacts) {
    let personId = links.get(c.resourceName)
    if (!personId || !byId.has(personId)) {
      personId = undefined
      for (const email of c.emails) {
        const owners = emailOwners.get(email)
        if (owners?.length === 1) {
          personId = owners[0]
          break
        }
      }
    }
    if (!personId) {
      unmatched++
      continue
    }

    const person = byId.get(personId)!
    const prior = proposals.get(personId)
    const fields: Partial<Record<ProfileField, string>> = { ...prior?.fields }
    for (const field of PROFILE_FIELDS) {
      const incoming = clean(c[field])
      if (incoming && blank(person[field]) && !fields[field]) fields[field] = incoming
    }
    if (Object.keys(fields).length === 0) continue
    proposals.set(personId, {
      personId,
      personName: person.name,
      googleName: prior?.googleName ?? c.displayName,
      fields,
    })
  }

  return {
    proposals: [...proposals.values()].sort((a, b) => a.personName.localeCompare(b.personName)),
    unmatched,
  }
}

interface GooglePerson {
  resourceName?: string
  names?: Array<{ displayName?: string }>
  emailAddresses?: Array<{ value?: string }>
  organizations?: Array<{ name?: string; title?: string }>
  biographies?: Array<{ value?: string }>
}

async function fetchProfileContacts(accessToken: string): Promise<GoogleProfileContact[]> {
  const out: GoogleProfileContact[] = []
  let pageToken: string | undefined
  do {
    const url = new URL('https://people.googleapis.com/v1/people/me/connections')
    url.searchParams.set('personFields', PERSON_FIELDS)
    url.searchParams.set('pageSize', '200')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const res = await fetch(url.toString(), { headers: { Authorization: `Bearer ${accessToken}` } })
    if (!res.ok) {
      const body = await res.text()
      const described = describePeopleApiError(res.status, body)
      if (described) throw new Error(described)
      throw new Error(`Google People API ${res.status}: ${body.slice(0, 180)}`)
    }
    const data = (await res.json()) as { connections?: GooglePerson[]; nextPageToken?: string }
    for (const c of data.connections ?? []) {
      const resourceName = c.resourceName?.trim()
      if (!resourceName) continue
      const org = c.organizations?.[0]
      out.push({
        resourceName,
        displayName: c.names?.[0]?.displayName?.trim() || resourceName,
        emails: (c.emailAddresses ?? []).map((e) => e.value?.trim().toLowerCase() || '').filter(Boolean),
        company: clean(org?.name),
        jobTitle: clean(org?.title),
        notes: clean(c.biographies?.[0]?.value),
      })
    }
    pageToken = data.nextPageToken
  } while (pageToken)
  return out
}

async function loadRowsAndLinks(db: Db): Promise<{ rows: ProfilePersonRow[]; links: Map<string, string> }> {
  const rows = await db
    .select({
      id: people.id,
      name: people.name,
      email: people.email,
      company: people.company,
      jobTitle: people.jobTitle,
      notes: people.notes,
    })
    .from(people)
    .where(eq(people.status, 'confirmed'))
  const linkRows = await db
    .select({ externalId: personExternalIds.externalId, personId: personExternalIds.personId })
    .from(personExternalIds)
    .where(eq(personExternalIds.provider, 'google_contact'))
  return { rows, links: new Map(linkRows.map((l) => [l.externalId, l.personId])) }
}

export async function previewGoogleProfiles(db: Db = getDb()): Promise<GoogleProfilePreview> {
  const connections = await listGoogleConnections()
  if (connections.length === 0) {
    return { proposals: [], unmatched: 0, errors: ['אין חיבור Google מחובר'] }
  }

  const contacts: GoogleProfileContact[] = []
  const errors: string[] = []
  for (const conn of connections) {
    const accountKey = conn.calendarEmail || conn.id
    try {
      const accessToken = await getAccessTokenForConnection(conn)
      contacts.push(...(await fetchProfileContacts(accessToken)))
    } catch (err) {
      errors.push(`${accountKey}: ${err instanceof Error ? err.message : 'טעינת אנשי הקשר נכשלה'}`)
    }
  }

  const { rows, links } = await loadRowsAndLinks(db)
  return { ...matchGoogleProfiles(rows, contacts, links), errors }
}

/** Writes the selected proposals, re-checking each field is still blank at write time. */
export async function applyProfileProposals(
  db: Db,
  personIds: string[],
  proposals: ProfileProposal[],
): Promise<{ updated: number; fieldsFilled: number }> {
  const selected = new Set(personIds)
  const chosen = proposals.filter((p) => selected.has(p.personId))
  if (chosen.length === 0) return { updated: 0, fieldsFilled: 0 }

  const current = await db
    .select({ id: people.id, company: people.company, jobTitle: people.jobTitle, notes: people.notes })
    .from(people)
    .where(inArray(people.id, chosen.map((p) => p.personId)))
  const byId = new Map(current.map((r) => [r.id, r]))

  let updated = 0
  let fieldsFilled = 0
  for (const proposal of chosen) {
    const row = byId.get(proposal.personId)
    if (!row) continue
    const set: Partial<Record<ProfileField, string>> = {}
    for (const field of PROFILE_FIELDS) {
      const value = proposal.fields[field]
      if (value && blank(row[field])) set[field] = value
    }
    const count = Object.keys(set).length
    if (count === 0) continue
    await db.update(people).set(set).where(eq(people.id, proposal.personId))
    updated++
    fieldsFilled += count
  }
  return { updated, fieldsFilled }
}

export async function applyGoogleProfiles(
  db: Db,
  personIds: string[],
): Promise<{ updated: number; fieldsFilled: number; errors: string[] }> {
  if (personIds.length === 0) return { updated: 0, fieldsFilled: 0, errors: [] }
  const preview = await previewGoogleProfiles(db)
  const applied = await applyProfileProposals(db, personIds, preview.proposals)
  return { ...applied, errors: preview.errors }
}

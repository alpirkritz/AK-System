/**
 * Fill empty people.phone from Google Contacts. Matches existing people only —
 * never inserts a person. See google-phone-match.ts.
 */
import { and, eq, getDb, or, people, sql } from '@ak-system/database'
import { listGoogleConnections, getAccessTokenForConnection } from './google-connections'
import { pushDmAllowlist, setCaptureWhatsapp } from './whatsapp-dm'
import {
  matchGooglePhones,
  pickGooglePhone,
  type GooglePhoneContact,
  type GooglePhoneNumber,
  type PhoneProposal,
  type PhoneSkip,
} from './google-phone-match'

type Db = ReturnType<typeof getDb>

const SCOPE_ERROR = 'אין הרשאה לאנשי הקשר. חבר מחדש את החשבון הזה מההגדרות כדי לאשר קריאת אנשי קשר.'

/** DAZ Google does not store phone numbers. Calendar and Gmail still use it; phone sync does not. */
const PHONE_SYNC_EXCLUDED_EMAILS = new Set(['alpir@daz.guru'])

export function includeInPhoneSync(calendarEmail: string | null | undefined): boolean {
  const email = calendarEmail?.trim().toLowerCase()
  if (!email) return true
  return !PHONE_SYNC_EXCLUDED_EMAILS.has(email)
}

/** Maps a People API failure to Hebrew. Null when the caller should surface the raw status. */
export function describePeopleApiError(status: number, body: string): string | null {
  if (/has not been used in project|is disabled/i.test(body)) {
    const url = body.match(/https:\/\/console\.developers\.google\.com\/apis\/api\/people\.googleapis\.com\/overview\?project=\d+/)?.[0]
    return url
      ? `People API כבוי בפרויקט גוגל. הפעל אותו ואז נסה שוב: ${url}`
      : 'People API כבוי בפרויקט גוגל. הפעל אותו ב-Google Cloud ואז נסה שוב.'
  }
  if (status === 403 || /insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT/i.test(body)) {
    return SCOPE_ERROR
  }
  return null
}

export interface GooglePhonePreview {
  proposals: PhoneProposal[]
  skipped: PhoneSkip[]
  unmatched: number
  errors: string[]
}

interface GooglePerson {
  resourceName?: string
  names?: Array<{ displayName?: string }>
  emailAddresses?: Array<{ value?: string }>
  phoneNumbers?: GooglePhoneNumber[]
}

async function fetchPhoneContacts(accessToken: string): Promise<GooglePhoneContact[]> {
  const out: GooglePhoneContact[] = []
  let pageToken: string | undefined
  do {
    const url = new URL('https://people.googleapis.com/v1/people/me/connections')
    url.searchParams.set('personFields', 'names,emailAddresses,phoneNumbers')
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
      const phone = pickGooglePhone(c.phoneNumbers ?? [])
      if (!resourceName || !phone) continue
      out.push({
        resourceName,
        displayName: c.names?.[0]?.displayName?.trim() || resourceName,
        emails: (c.emailAddresses ?? []).map((e) => e.value?.trim().toLowerCase() || '').filter(Boolean),
        phone,
      })
    }
    pageToken = data.nextPageToken
  } while (pageToken)
  return out
}

export async function previewGooglePhones(db: Db = getDb()): Promise<GooglePhonePreview> {
  const connections = await listGoogleConnections()
  if (connections.length === 0) {
    return { proposals: [], skipped: [], unmatched: 0, errors: ['אין חיבור Google מחובר'] }
  }

  const contacts: GooglePhoneContact[] = []
  const errors: string[] = []
  for (const conn of connections) {
    if (!includeInPhoneSync(conn.calendarEmail)) continue
    const accountKey = conn.calendarEmail || conn.id
    try {
      const accessToken = await getAccessTokenForConnection(conn)
      contacts.push(...(await fetchPhoneContacts(accessToken)))
    } catch (err) {
      errors.push(`${accountKey}: ${err instanceof Error ? err.message : 'טעינת אנשי הקשר נכשלה'}`)
    }
  }

  const rows = await db
    .select({
      id: people.id,
      name: people.name,
      email: people.email,
      phone: people.phone,
      status: people.status,
    })
    .from(people)

  const matched = matchGooglePhones(rows, contacts)
  return { ...matched, errors }
}

export type PhoneFill = { personId: string; name: string }

/** Writes preview phones onto still-empty people, renames them, and turns WhatsApp capture on. */
export async function applyMatchedPhones(
  db: Db,
  fills: PhoneFill[],
  proposals: PhoneProposal[],
): Promise<{ updated: number; skipped: number }> {
  const names = new Map(fills.map((f) => [f.personId, f.name]))
  const selected = proposals.filter((p) => names.has(p.personId))
  let updated = 0
  let skipped = 0

  for (const proposal of selected) {
    const [row] = await db
      .select({ phone: people.phone, name: people.name })
      .from(people)
      .where(eq(people.id, proposal.personId))
    const blank = !row?.phone || row.phone.trim() === ''
    if (!row || !blank) {
      skipped++
      continue
    }
    const edited = (names.get(proposal.personId) ?? '').trim()
    const name = edited || proposal.googleName.trim() || row.name
    await db
      .update(people)
      .set({ phone: proposal.phone, name })
      .where(and(
        eq(people.id, proposal.personId),
        or(sql`${people.phone} IS NULL`, eq(people.phone, ''), sql`trim(${people.phone}) = ''`),
      ))
    await setCaptureWhatsapp(db, proposal.personId, true)
    updated++
  }

  if (updated > 0) await pushDmAllowlist(db)
  return { updated, skipped }
}

export async function applyGooglePhones(
  db: Db,
  fills: PhoneFill[],
): Promise<{ updated: number; skipped: number; errors: string[] }> {
  if (fills.length === 0) return { updated: 0, skipped: 0, errors: [] }
  const preview = await previewGooglePhones(db)
  if (preview.proposals.length === 0) {
    return { updated: 0, skipped: 0, errors: preview.errors }
  }
  const applied = await applyMatchedPhones(db, fills, preview.proposals)
  return { ...applied, errors: preview.errors }
}

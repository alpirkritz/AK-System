/**
 * Sync Google Contacts into person_external_ids (provider=google_contact).
 * Soft-matches by email; creates unconfirmed people when no safe match.
 *
 * Requires the connected Google OAuth token to include Contacts readonly scope.
 * When the scope is missing, the API error is recorded and sync continues.
 */

import { getDb, people, personExternalIds, eq, and } from '@ak-system/database'
import { listGoogleConnections, getAccessTokenForConnection } from './google-connections'
import { upsertPersonExternalId } from './person-external-ids'

type Db = ReturnType<typeof getDb>

export interface GoogleContactsSyncResult {
  identitiesUpserted: number
  peopleCreated: number
  unmatched: number
  errors: string[]
}

function newId(prefix: string): string {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 7)
}

interface GooglePerson {
  resourceName?: string
  names?: Array<{ displayName?: string }>
  emailAddresses?: Array<{ value?: string }>
}

async function fetchConnections(accessToken: string): Promise<GooglePerson[]> {
  const out: GooglePerson[] = []
  let pageToken: string | undefined
  do {
    const url = new URL('https://people.googleapis.com/v1/people/me/connections')
    url.searchParams.set('personFields', 'names,emailAddresses')
    url.searchParams.set('pageSize', '100')
    if (pageToken) url.searchParams.set('pageToken', pageToken)
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${accessToken}` },
    })
    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Google People API ${res.status}: ${body.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      connections?: GooglePerson[]
      nextPageToken?: string
    }
    out.push(...(data.connections ?? []))
    pageToken = data.nextPageToken
  } while (pageToken)
  return out
}

export async function syncGoogleContacts(
  opts: { dryRun?: boolean } = {},
  db: Db = getDb(),
): Promise<GoogleContactsSyncResult> {
  const dryRun = opts.dryRun ?? false
  const result: GoogleContactsSyncResult = {
    identitiesUpserted: 0,
    peopleCreated: 0,
    unmatched: 0,
    errors: [],
  }

  const connections = await listGoogleConnections()
  if (connections.length === 0) {
    result.errors.push('אין חיבור Google מחובר')
    return result
  }

  const existing = await db
    .select({ id: people.id, email: people.email, name: people.name, status: people.status })
    .from(people)
  const byEmail = new Map<string, (typeof existing)[0]>()
  for (const p of existing) {
    if (p.email) byEmail.set(p.email.toLowerCase(), p)
  }

  const now = new Date().toISOString()

  for (const conn of connections) {
    const accountKey = conn.calendarEmail || conn.id
    let accessToken: string
    try {
      accessToken = await getAccessTokenForConnection(conn)
    } catch (err) {
      result.errors.push(`${accountKey}: ${err instanceof Error ? err.message : 'token failed'}`)
      continue
    }

    let contacts: GooglePerson[]
    try {
      contacts = await fetchConnections(accessToken)
    } catch (err) {
      result.errors.push(`${accountKey}: ${err instanceof Error ? err.message : 'contacts fetch failed'}`)
      continue
    }

    for (const c of contacts) {
      const resourceName = c.resourceName?.trim()
      if (!resourceName) continue
      const displayName = c.names?.[0]?.displayName?.trim() || resourceName
      const email = c.emailAddresses?.[0]?.value?.trim().toLowerCase() || null

      const existingIdentity = await db
        .select({ personId: personExternalIds.personId })
        .from(personExternalIds)
        .where(
          and(
            eq(personExternalIds.provider, 'google_contact'),
            eq(personExternalIds.accountKey, accountKey),
            eq(personExternalIds.externalId, resourceName),
          ),
        )
        .limit(1)

      let person = existingIdentity[0]
        ? existing.find((p) => p.id === existingIdentity[0]!.personId)
        : email
          ? byEmail.get(email)
          : undefined

      if (!person) {
        // No safe match → create unconfirmed for review
        const id = newId('p_gcon_')
        if (!dryRun) {
          await db.insert(people).values({
            id,
            name: displayName,
            email: email,
            role: null,
            color: '#e8c547',
            status: 'unconfirmed',
            source: 'calendar',
            createdAt: now,
          })
        }
        person = { id, email, name: displayName, status: 'unconfirmed' }
        existing.push(person)
        if (email) byEmail.set(email, person)
        result.peopleCreated++
        result.unmatched++
      }

      if (!dryRun) {
        await upsertPersonExternalId(db, {
          personId: person.id,
          provider: 'google_contact',
          accountKey,
          externalId: resourceName,
          displayName,
        })
        if (email) {
          await upsertPersonExternalId(db, {
            personId: person.id,
            provider: 'email',
            accountKey,
            externalId: email,
            displayName,
          })
        }
      }
      result.identitiesUpserted++
    }
  }

  return result
}

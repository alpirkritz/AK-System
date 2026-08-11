/**
 * Outlook Web (OWA) calendar source for the Dragontail bridge.
 *
 * Why this exists: Pizza Hut's Conditional Access blocks every *application* path
 * into the Exchange calendar — Apple Internet Accounts (AADSTS50105), device-code
 * public clients, ROPC (MFA required) and EWS basic auth. A signed-in browser is
 * still permitted, so we drive one.
 *
 * OWA mints its own access token for `aud=https://outlook.office.com` to reach its
 * backend. We reuse that token against the documented Outlook REST v2.0
 * calendarview endpoint, so the read is real JSON over a supported API rather than
 * DOM scraping — the browser only exists to hold the session.
 *
 * The session lives in a persistent Chromium profile; create it once with
 * scripts/owa-login.ts. Playwright is imported lazily so the pure mapping helpers
 * below stay cheap to import from tests.
 */

import { homedir } from 'os'
import { join } from 'path'
import type { SourceAttendee, SourceEvent } from './outlook-to-google-sync'

const PROFILE_DIR = process.env.OWA_PROFILE_DIR || join(homedir(), '.ak-owa-profile')
const CALENDAR_URL = 'https://outlook.office.com/calendar/view/workweek'
const TOKEN_AUDIENCE = 'https://outlook.office.com'
const TOKEN_TIMEOUT_MS = Number(process.env.OWA_TOKEN_TIMEOUT_MS || 60_000)
const PAGE_SIZE = 250

const SELECT_FIELDS = [
  'Subject',
  'Start',
  'End',
  'IsAllDay',
  'IsCancelled',
  'Location',
  'BodyPreview',
  'Attendees',
  'Organizer',
  'iCalUId',
  'Type',
].join(',')

export interface OwaDateTime {
  DateTime: string
  TimeZone?: string
}

export interface OwaAttendee {
  Type?: string
  Status?: { Response?: string }
  EmailAddress?: { Name?: string; Address?: string }
}

export interface OwaRawEvent {
  Id: string
  iCalUId?: string
  Subject?: string
  Start?: OwaDateTime
  End?: OwaDateTime
  IsAllDay?: boolean
  IsCancelled?: boolean
  Location?: { DisplayName?: string }
  BodyPreview?: string
  Attendees?: OwaAttendee[]
  Organizer?: { EmailAddress?: { Name?: string; Address?: string } }
  Type?: string
}

/** SourceEvent minus the signature, which the bridge computes with its own hasher. */
export type UnsignedSourceEvent = Omit<SourceEvent, 'sig'>

export class OwaSessionError extends Error {
  constructor(message: string) {
    super(`${message}\nRe-authenticate with: pnpm exec tsx scripts/owa-login.ts`)
    this.name = 'OwaSessionError'
  }
}

/**
 * OWA returns a naive timestamp ("2026-08-04T14:30:00.0000000") alongside a separate
 * TimeZone field. We ask for UTC so we can attach the offset ourselves and hand the
 * rest of the bridge a real instant.
 */
export function owaDateToIso(value: OwaDateTime | undefined): string | null {
  if (!value?.DateTime) return null
  const trimmed = value.DateTime.replace(/(\.\d{3})\d+$/, '$1')
  const withZone = /[Zz]|[+-]\d{2}:\d{2}$/.test(trimmed) ? trimmed : `${trimmed}Z`
  const parsed = new Date(withZone)
  if (Number.isNaN(parsed.getTime())) return null
  return parsed.toISOString()
}

/** Exchange response values → the Google-style vocabulary the bridge already uses. */
export function mapOwaResponse(response: string | undefined): string | undefined {
  switch (response) {
    case 'Accepted':
    case 'Organizer':
      return 'accepted'
    case 'Declined':
      return 'declined'
    case 'TentativelyAccepted':
      return 'tentative'
    case 'NotResponded':
    case 'None':
      return 'needsAction'
    default:
      return undefined
  }
}

function toAttendees(raw: OwaRawEvent): SourceAttendee[] {
  if (!Array.isArray(raw.Attendees)) return []
  return raw.Attendees.map((a) => ({
    email: a.EmailAddress?.Address?.trim() || null,
    name: a.EmailAddress?.Name?.trim() || null,
    responseStatus: mapOwaResponse(a.Status?.Response),
  }))
}

/**
 * iCalUId is stable across edits, while Id embeds a change key that churns. Pairing it
 * with the occurrence start keeps recurring instances distinct without breaking the
 * uid match on every meeting update.
 */
export function owaUid(raw: OwaRawEvent, startIso: string): string {
  const base = raw.iCalUId?.trim() || raw.Id
  return `${base}_${startIso}`
}

/** Pure: OWA REST payload → the bridge's source shape (signature added by the caller). */
export function owaToSourceEvents(raw: OwaRawEvent[]): UnsignedSourceEvent[] {
  const out: UnsignedSourceEvent[] = []
  for (const e of raw) {
    if (e.IsCancelled) continue
    const title = e.Subject?.trim()
    if (!title) continue
    const start = owaDateToIso(e.Start)
    const end = owaDateToIso(e.End)
    if (!start || !end) continue

    out.push({
      uid: owaUid(e, start),
      title,
      start,
      end,
      allDay: Boolean(e.IsAllDay),
      location: e.Location?.DisplayName?.trim() || null,
      description: e.BodyPreview?.trim() || null,
      attendees: toAttendees(e),
    })
  }
  return out
}

function isTokenForOutlook(token: string): boolean {
  try {
    const payload = token.split('.')[1]
    if (!payload) return false
    const json = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'))
    return json.aud === TOKEN_AUDIENCE
  } catch {
    return false
  }
}

/**
 * Read the Exchange calendar for [timeMin, timeMax). Recurring series come back already
 * expanded into occurrences, matching what the EventKit helper used to return.
 */
export async function fetchOwaCalendarView(
  timeMin: Date,
  timeMax: Date,
): Promise<OwaRawEvent[]> {
  const { chromium } = await import('playwright')

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  })

  try {
    const page = context.pages()[0] ?? (await context.newPage())

    let token: string | null = null
    let resolveToken: () => void = () => {}
    const gotToken = new Promise<void>((resolve) => {
      resolveToken = resolve
    })

    page.on('request', (request) => {
      if (token) return
      const auth = request.headers()['authorization']
      if (!auth?.startsWith('Bearer ')) return
      const candidate = auth.slice(7)
      if (!isTokenForOutlook(candidate)) return
      token = candidate
      resolveToken()
    })

    await page.goto(CALENDAR_URL, { waitUntil: 'networkidle', timeout: 45000 })
    await Promise.race([gotToken, page.waitForTimeout(TOKEN_TIMEOUT_MS)])

    if (!token) {
      const url = page.url()
      if (!url.includes('outlook.office.com/calendar')) {
        throw new OwaSessionError(`OWA redirected away from the calendar (${url}) — session expired.`)
      }
      throw new OwaSessionError('OWA never issued an access token within the timeout.')
    }

    const events: OwaRawEvent[] = []
    let url =
      `${TOKEN_AUDIENCE}/api/v2.0/me/calendarview` +
      `?startDateTime=${timeMin.toISOString()}` +
      `&endDateTime=${timeMax.toISOString()}` +
      `&$select=${SELECT_FIELDS}` +
      `&$top=${PAGE_SIZE}`

    while (url) {
      const res = await context.request.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Prefer: 'outlook.timezone="UTC"',
          Accept: 'application/json',
        },
      })

      if (res.status() === 401 || res.status() === 403) {
        throw new OwaSessionError(`Outlook REST rejected the OWA token (${res.status()}).`)
      }
      if (!res.ok()) {
        throw new Error(
          `Outlook REST calendarview failed: ${res.status()} ${(await res.text()).slice(0, 300)}`,
        )
      }

      const body = (await res.json()) as {
        value?: OwaRawEvent[]
        '@odata.nextLink'?: string
      }
      if (Array.isArray(body.value)) events.push(...body.value)
      url = body['@odata.nextLink'] ?? ''
    }

    return events
  } finally {
    await context.close()
  }
}

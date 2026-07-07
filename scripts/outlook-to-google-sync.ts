/**
 * Outlook → Google Dragontail bridge (macOS-only).
 *
 * Reads the local Outlook/Exchange calendar via the EventKit Swift helper and
 * mirrors it into the Google "Dragontail" calendar. One-way, idempotent:
 * only events tagged `akSource=outlook-exchange` are ever created/updated/deleted,
 * so the real Dragontail events are never touched.
 *
 * Run:  pnpm exec tsx scripts/outlook-to-google-sync.ts
 * (usually via scripts/outlook-bridge-run.sh from launchd)
 *
 * Required env (loaded from apps/web/.env.local by the runner):
 *   GOOGLE_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_ID
 *   GOOGLE_CLIENT_SECRET / GOOGLE_CALENDAR_CLIENT_SECRET
 *   DATABASE_PATH          — local SQLite holding the write-scoped connection
 * Optional env:
 *   DRAGONTAIL_GCAL_ID     — target Google calendar id
 *   OUTLOOK_BRIDGE_ACCOUNT — Google account that owns Dragontail (default alpirkritz@gmail.com)
 *   OUTLOOK_SOURCE_CALENDAR— local Exchange calendar name (default "Calendar")
 *   OUTLOOK_BRIDGE_DAYS_BACK / OUTLOOK_BRIDGE_DAYS_FWD (default 7 / 60)
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  listGoogleConnections,
  getAccessTokenForConnection,
  type GoogleConnection,
} from '../packages/api/src/services/google-connections'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')

const DRAGONTAIL_GCAL_ID =
  process.env.DRAGONTAIL_GCAL_ID ||
  'bfa8306ecf5f05d42d22b2349ddbec44d5bd4746dc12940d79e8b3e235add13b@group.calendar.google.com'
const ACCOUNT = (process.env.OUTLOOK_BRIDGE_ACCOUNT || 'alpirkritz@gmail.com').toLowerCase()
const SOURCE_CALENDAR = process.env.OUTLOOK_SOURCE_CALENDAR || 'Calendar'
const DAYS_BACK = Number(process.env.OUTLOOK_BRIDGE_DAYS_BACK || 7)
const DAYS_FWD = Number(process.env.OUTLOOK_BRIDGE_DAYS_FWD || 60)
const TIME_ZONE = process.env.TIMEZONE || 'Asia/Jerusalem'

export const AK_SOURCE = 'outlook-exchange'
const HELPER_TIMEOUT_MS = Number(process.env.OUTLOOK_BRIDGE_HELPER_TIMEOUT_MS || 60_000)
const WRITE_DELAY_MS = Number(process.env.OUTLOOK_BRIDGE_WRITE_DELAY_MS || 300)
const DRY_RUN = process.argv.includes('--dry-run')

export interface SourceAttendee {
  email: string | null
  name: string | null
  responseStatus?: string
}

interface RawEvent {
  id: string
  title: string
  start: string
  end: string
  allDay: boolean
  calendar: string
  calendarId: string
  calSource: string
  calType: number
  location?: string | null
  notes?: string | null
  url?: string | null
  status: string
  organizer?: string | null
  attendeeStatus?: string
  attendees?: SourceAttendee[]
}

export interface SourceEvent {
  uid: string
  sig: string
  title: string
  start: string
  end: string
  allDay: boolean
  location: string | null
  description: string | null
  attendees: SourceAttendee[]
}

export interface GoogleEvent {
  id: string
  summary?: string
  start?: { date?: string; dateTime?: string }
  end?: { date?: string; dateTime?: string }
  attendees?: Array<{ email?: string; self?: boolean }>
  extendedProperties?: { private?: Record<string, string> }
}

/** Bump when attendee storage strategy changes (forces one-time cleanup PATCH). */
export const ATTENDEES_CLEARED_VERSION = '1'

function log(...args: unknown[]): void {
  console.log('[outlook-bridge]', ...args)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function resolveHelperPath(): string {
  if (process.env.CALENDAR_HELPER_PATH) return process.env.CALENDAR_HELPER_PATH
  return path.join(ROOT, 'packages/api/src/services/calendar-helper/calendar-helper')
}

function runHelper(timeMin: Date, timeMax: Date): Promise<RawEvent[]> {
  const helperPath = resolveHelperPath()
  if (!existsSync(helperPath)) {
    throw new Error(`calendar-helper binary missing at ${helperPath}`)
  }
  return new Promise<RawEvent[]>((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    const proc = spawn(
      helperPath,
      ['--start', timeMin.toISOString(), '--end', timeMax.toISOString()],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    )
    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL') } catch { /* ignore */ }
      reject(new Error('calendar-helper timed out'))
    }, HELPER_TIMEOUT_MS)

    proc.stdout.on('data', (c: Buffer) => { stdout += c.toString() })
    proc.stderr.on('data', (c: Buffer) => { stderr += c.toString() })
    proc.on('error', (err) => { clearTimeout(timer); reject(err) })
    proc.on('close', (code) => {
      clearTimeout(timer)
      if (stderr) log('helper stderr:', stderr.slice(0, 200))
      if (code !== 0 && !stdout) {
        reject(new Error(`calendar-helper exited ${code}`))
        return
      }
      try {
        const parsed = JSON.parse(stdout)
        if (!Array.isArray(parsed)) {
          reject(new Error(`helper error: ${JSON.stringify(parsed).slice(0, 200)}`))
          return
        }
        resolve(parsed as RawEvent[])
      } catch (err) {
        reject(new Error(`helper JSON parse failed: ${(err as Error).message}`))
      }
    })
  })
}

export function normalizeStart(start: string, allDay: boolean): string {
  if (allDay) return start.slice(0, 10)
  return new Date(start).toISOString()
}

export function matchKey(e: { title: string; start: string; allDay: boolean }): string {
  const title = e.title.trim().replace(/\s+/g, ' ').toLowerCase()
  const start = normalizeStart(e.start, e.allDay)
  return `${title}|${start}`
}

function attendeesSig(attendees: SourceAttendee[]): string {
  return attendees
    .filter((a) => a.email)
    .map((a) => `${a.email}|${a.responseStatus ?? ''}`)
    .sort()
    .join(',')
}

export function signature(e: {
  title: string
  start: string
  end: string
  location: string | null
  description: string | null
  allDay: boolean
  attendees: SourceAttendee[]
}): string {
  return createHash('sha1')
    .update([
      e.title,
      e.start,
      e.end,
      e.location ?? '',
      e.description ?? '',
      e.allDay ? '1' : '0',
      attendeesSig(e.attendees),
    ].join('|'))
    .digest('hex')
    .slice(0, 16)
}

function parseAttendees(raw: RawEvent): SourceAttendee[] {
  if (!Array.isArray(raw.attendees)) return []
  return raw.attendees.map((a) => ({
    email: a.email ?? null,
    name: a.name ?? null,
    responseStatus: a.responseStatus,
  }))
}

export function toSourceEvents(raw: RawEvent[], sourceCalendar = SOURCE_CALENDAR): SourceEvent[] {
  const out: SourceEvent[] = []
  for (const e of raw) {
    if (e.calSource !== 'Exchange') continue
    if (e.calendar !== sourceCalendar) continue
    if (e.status === 'cancelled') continue
    if (!e.title) continue
    const location = e.location && e.location.length > 0 ? e.location : null
    const description = e.notes && e.notes.length > 0 ? e.notes : null
    const attendees = parseAttendees(e)
    const base = {
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      location,
      description,
      attendees,
    }
    out.push({
      uid: `${e.id}_${e.start}`,
      sig: signature(base),
      ...base,
    })
  }
  return out
}

/** All-day: Google needs date (YYYY-MM-DD) with an exclusive end date. */
function allDayDates(startIso: string, endIso: string): { start: string; end: string } {
  const startDate = startIso.slice(0, 10)
  const endMs = new Date(endIso).getTime()
  // Exclusive end: the day after the last covered day.
  const lastDay = new Date(endMs - 1000)
  lastDay.setDate(lastDay.getDate() + 1)
  const endDate = lastDay.toISOString().slice(0, 10)
  return { start: startDate, end: endDate <= startDate ? isoDatePlusOne(startDate) : endDate }
}

function isoDatePlusOne(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function mapRsvp(status?: string): string | undefined {
  if (
    status === 'accepted' ||
    status === 'declined' ||
    status === 'tentative' ||
    status === 'needsAction'
  ) {
    return status
  }
  return undefined
}

export function eventBody(
  e: SourceEvent,
  opts: { akSource?: string; timeZone?: string } = {},
): Record<string, unknown> {
  const akSource = opts.akSource ?? AK_SOURCE
  const timeZone = opts.timeZone ?? TIME_ZONE
  const start = e.allDay
    ? { date: allDayDates(e.start, e.end).start }
    : { dateTime: e.start, timeZone }
  const end = e.allDay
    ? { date: allDayDates(e.start, e.end).end }
    : { dateTime: e.end, timeZone }

  let description = e.description ?? undefined
  if (e.attendees.length > 0) {
    const attendeeList = e.attendees
      .map((a) => (a.email ? `${a.name ?? a.email} <${a.email}>` : (a.name ?? '')))
      .filter(Boolean)
      .join(', ')
    const note = `משתתפים: ${attendeeList}`
    description = description ? `${description}\n\n${note}` : note
  }

  return {
    summary: e.title,
    location: e.location ?? undefined,
    description,
    start,
    end,
    // Explicitly clear any attendees previously written to Google Calendar.
    // Never set real attendees — Google would send invitation emails on their behalf.
    attendees: [],
    extendedProperties: {
      private: {
        akSource,
        akSourceUid: e.uid,
        akSig: e.sig,
        akAttendeesCleared: ATTENDEES_CLEARED_VERSION,
      },
    },
  }
}

export function isBridgeCopy(ev: GoogleEvent, akSource = AK_SOURCE): boolean {
  return ev.extendedProperties?.private?.akSource === akSource
}

export function googleEventMatchFields(
  ev: GoogleEvent,
): { title: string; start: string; allDay: boolean } | null {
  const title = ev.summary?.trim()
  if (!title) return null
  if (ev.start?.date) {
    return { title, start: ev.start.date, allDay: true }
  }
  if (ev.start?.dateTime) {
    return { title, start: ev.start.dateTime, allDay: false }
  }
  return null
}

export interface SyncAction {
  action: 'create' | 'update' | 'adopt' | 'unchanged'
  source: SourceEvent
  match?: GoogleEvent
}

export function needsAttendeeCleanup(
  match: GoogleEvent,
  akSource = AK_SOURCE,
): boolean {
  if (!isBridgeCopy(match, akSource)) return false
  return match.extendedProperties?.private?.akAttendeesCleared !== ATTENDEES_CLEARED_VERSION
}

export function planSyncActions(
  sources: SourceEvent[],
  existingCopies: GoogleEvent[],
  allInWindow: GoogleEvent[],
  akSource = AK_SOURCE,
): SyncAction[] {
  const existingByUid = new Map<string, GoogleEvent>()
  for (const ev of existingCopies) {
    const uid = ev.extendedProperties?.private?.akSourceUid
    if (uid) existingByUid.set(uid, ev)
  }

  const existingByMatchKey = new Map<string, GoogleEvent>()
  for (const ev of allInWindow) {
    const fields = googleEventMatchFields(ev)
    if (!fields) continue
    const key = matchKey(fields)
    if (!existingByMatchKey.has(key)) {
      existingByMatchKey.set(key, ev)
    }
  }

  const actions: SyncAction[] = []
  for (const s of sources) {
    let match = existingByUid.get(s.uid)
    let adopted = false

    if (!match) {
      match = existingByMatchKey.get(matchKey(s))
      if (match && !isBridgeCopy(match, akSource)) {
        adopted = true
      }
    }

    if (!match) {
      actions.push({ action: 'create', source: s })
      continue
    }

    const tagged = isBridgeCopy(match, akSource)
    const sameUid = match.extendedProperties?.private?.akSourceUid === s.uid
    const sameSig = match.extendedProperties?.private?.akSig === s.sig

    if (tagged && sameUid && sameSig) {
      if (match && needsAttendeeCleanup(match, akSource)) {
        actions.push({ action: 'update', source: s, match })
        continue
      }
      actions.push({ action: 'unchanged', source: s, match })
      continue
    }

    if (adopted) {
      actions.push({ action: 'adopt', source: s, match })
    } else {
      actions.push({ action: 'update', source: s, match })
    }
  }

  return actions
}

async function gcalFetch(
  accessToken: string,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<Response> {
  return fetch(`https://www.googleapis.com/calendar/v3/${urlPath}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: body != null ? JSON.stringify(body) : undefined,
  })
}

async function listDragontailEvents(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
  opts: { taggedOnly?: boolean } = {},
): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = []
  let pageToken: string | undefined
  const calId = encodeURIComponent(DRAGONTAIL_GCAL_ID)
  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      showDeleted: 'false',
      maxResults: '2500',
    })
    if (opts.taggedOnly) {
      params.set('privateExtendedProperty', `akSource=${AK_SOURCE}`)
    }
    if (pageToken) params.set('pageToken', pageToken)
    const res = await gcalFetch(accessToken, 'GET', `calendars/${calId}/events?${params}`)
    if (!res.ok) {
      throw new Error(`list events failed: ${res.status} ${await res.text()}`)
    }
    const data = (await res.json()) as { items?: GoogleEvent[]; nextPageToken?: string }
    if (data.items) events.push(...data.items)
    pageToken = data.nextPageToken
  } while (pageToken)
  return events
}

async function main(): Promise<void> {
  if (process.platform !== 'darwin') {
    throw new Error('Outlook bridge only runs on macOS (EventKit required)')
  }

  const connections = await listGoogleConnections()
  const conn: GoogleConnection | undefined = connections.find(
    (c) => c.calendarEmail.toLowerCase() === ACCOUNT,
  )
  if (!conn) {
    throw new Error(
      `no Google connection for ${ACCOUNT}. Connect it (with write scope) from Settings first.`,
    )
  }

  const accessToken = await getAccessTokenForConnection(conn)

  const now = new Date()
  const timeMin = new Date(now.getTime() - DAYS_BACK * 86400000)
  const timeMax = new Date(now.getTime() + DAYS_FWD * 86400000)

  const raw = await runHelper(timeMin, timeMax)
  const sources = toSourceEvents(raw)
  const attendeesWithEmail = sources.reduce(
    (n, s) => n + s.attendees.filter((a) => a.email).length,
    0,
  )
  const attendeesSkipped = sources.reduce(
    (n, s) => n + s.attendees.filter((a) => !a.email && a.name).length,
    0,
  )
  log(
    `source: ${sources.length} Outlook events (calendar "${SOURCE_CALENDAR}"), ` +
    `${attendeesWithEmail} attendees with email, ${attendeesSkipped} name-only`,
  )

  const [existingCopies, allInWindow] = await Promise.all([
    listDragontailEvents(accessToken, timeMin, timeMax, { taggedOnly: true }),
    listDragontailEvents(accessToken, timeMin, timeMax),
  ])
  log(`existing copies in Dragontail: ${existingCopies.length}, all in window: ${allInWindow.length}`)

  const actions = planSyncActions(sources, existingCopies, allInWindow)
  const sourceUids = new Set(sources.map((s) => s.uid))
  const calId = encodeURIComponent(DRAGONTAIL_GCAL_ID)
  let created = 0
  let updated = 0
  let adopted = 0
  let deleted = 0
  let unchanged = 0

  for (const { action, source: s, match } of actions) {
    if (action === 'unchanged') {
      unchanged++
      continue
    }
    if (action === 'create') {
      if (DRY_RUN) { created++; continue }
      const res = await gcalFetch(
        accessToken,
        'POST',
        `calendars/${calId}/events?sendUpdates=none`,
        eventBody(s),
      )
      if (res.ok) created++
      else log('insert failed:', s.title, res.status, (await res.text()).slice(0, 160))
      if (WRITE_DELAY_MS > 0) await sleep(WRITE_DELAY_MS)
      continue
    }
    if (!match) continue
    if (DRY_RUN) {
      if (action === 'adopt') adopted++
      else updated++
      continue
    }
    const res = await gcalFetch(
      accessToken,
      'PATCH',
      `calendars/${calId}/events/${encodeURIComponent(match.id)}?sendUpdates=none`,
      eventBody(s),
    )
    if (res.ok) {
      if (action === 'adopt') adopted++
      else updated++
    } else {
      log('patch failed:', s.title, res.status, (await res.text()).slice(0, 160))
    }
    if (WRITE_DELAY_MS > 0) await sleep(WRITE_DELAY_MS)
  }

  for (const ev of existingCopies) {
    const uid = ev.extendedProperties?.private?.akSourceUid
    if (uid && sourceUids.has(uid)) continue
    if (DRY_RUN) { deleted++; continue }
    const res = await gcalFetch(
      accessToken,
      'DELETE',
      `calendars/${calId}/events/${encodeURIComponent(ev.id)}?sendUpdates=none`,
    )
    if (res.ok || res.status === 410) deleted++
    else log('delete failed:', ev.id, res.status)
  }

  log(
    `${DRY_RUN ? '[dry-run] ' : ''}done — created ${created}, adopted ${adopted}, ` +
    `updated ${updated}, deleted ${deleted}, unchanged ${unchanged}`,
  )
}

const isMain =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)

if (isMain) {
  main().catch((err) => {
    console.error('[outlook-bridge] FATAL:', err instanceof Error ? err.message : err)
    process.exit(1)
  })
}

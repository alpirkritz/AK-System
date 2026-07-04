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

const AK_SOURCE = 'outlook-exchange'
const HELPER_TIMEOUT_MS = 20_000
const DRY_RUN = process.argv.includes('--dry-run')

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
}

interface SourceEvent {
  uid: string
  sig: string
  title: string
  start: string
  end: string
  allDay: boolean
  location: string | null
  description: string | null
}

interface GoogleEvent {
  id: string
  extendedProperties?: { private?: Record<string, string> }
}

function log(...args: unknown[]): void {
  console.log('[outlook-bridge]', ...args)
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

function signature(e: {
  title: string; start: string; end: string; location: string | null; description: string | null; allDay: boolean
}): string {
  return createHash('sha1')
    .update([e.title, e.start, e.end, e.location ?? '', e.description ?? '', e.allDay ? '1' : '0'].join('|'))
    .digest('hex')
    .slice(0, 16)
}

function toSourceEvents(raw: RawEvent[]): SourceEvent[] {
  const out: SourceEvent[] = []
  for (const e of raw) {
    if (e.calSource !== 'Exchange') continue
    if (e.calendar !== SOURCE_CALENDAR) continue
    if (e.status === 'cancelled') continue
    if (!e.title) continue
    const location = e.location && e.location.length > 0 ? e.location : null
    const description = e.notes && e.notes.length > 0 ? e.notes : null
    const base = {
      title: e.title,
      start: e.start,
      end: e.end,
      allDay: e.allDay,
      location,
      description,
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

function eventBody(e: SourceEvent): Record<string, unknown> {
  const start = e.allDay
    ? { date: allDayDates(e.start, e.end).start }
    : { dateTime: e.start, timeZone: TIME_ZONE }
  const end = e.allDay
    ? { date: allDayDates(e.start, e.end).end }
    : { dateTime: e.end, timeZone: TIME_ZONE }
  return {
    summary: e.title,
    location: e.location ?? undefined,
    description: e.description ?? undefined,
    start,
    end,
    extendedProperties: {
      private: { akSource: AK_SOURCE, akSourceUid: e.uid, akSig: e.sig },
    },
  }
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

async function listExistingCopies(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
): Promise<GoogleEvent[]> {
  const events: GoogleEvent[] = []
  let pageToken: string | undefined
  const calId = encodeURIComponent(DRAGONTAIL_GCAL_ID)
  do {
    const params = new URLSearchParams({
      privateExtendedProperty: `akSource=${AK_SOURCE}`,
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: 'true',
      showDeleted: 'false',
      maxResults: '2500',
    })
    if (pageToken) params.set('pageToken', pageToken)
    const res = await gcalFetch(accessToken, 'GET', `calendars/${calId}/events?${params}`)
    if (!res.ok) {
      throw new Error(`list existing failed: ${res.status} ${await res.text()}`)
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
  log(`source: ${sources.length} Outlook events (calendar "${SOURCE_CALENDAR}")`)

  const existing = await listExistingCopies(accessToken, timeMin, timeMax)
  log(`existing copies in Dragontail: ${existing.length}`)

  const existingByUid = new Map<string, GoogleEvent>()
  for (const ev of existing) {
    const uid = ev.extendedProperties?.private?.akSourceUid
    if (uid) existingByUid.set(uid, ev)
  }

  const sourceUids = new Set(sources.map((s) => s.uid))
  const calId = encodeURIComponent(DRAGONTAIL_GCAL_ID)
  let created = 0
  let updated = 0
  let deleted = 0
  let unchanged = 0

  for (const s of sources) {
    const match = existingByUid.get(s.uid)
    if (!match) {
      if (DRY_RUN) { created++; continue }
      const res = await gcalFetch(accessToken, 'POST', `calendars/${calId}/events`, eventBody(s))
      if (res.ok) created++
      else log('insert failed:', s.title, res.status, (await res.text()).slice(0, 160))
      continue
    }
    if (match.extendedProperties?.private?.akSig === s.sig) {
      unchanged++
      continue
    }
    if (DRY_RUN) { updated++; continue }
    const res = await gcalFetch(
      accessToken,
      'PATCH',
      `calendars/${calId}/events/${encodeURIComponent(match.id)}`,
      eventBody(s),
    )
    if (res.ok) updated++
    else log('patch failed:', s.title, res.status, (await res.text()).slice(0, 160))
  }

  for (const ev of existing) {
    const uid = ev.extendedProperties?.private?.akSourceUid
    if (uid && sourceUids.has(uid)) continue
    if (DRY_RUN) { deleted++; continue }
    const res = await gcalFetch(
      accessToken,
      'DELETE',
      `calendars/${calId}/events/${encodeURIComponent(ev.id)}`,
    )
    if (res.ok || res.status === 410) deleted++
    else log('delete failed:', ev.id, res.status)
  }

  log(
    `${DRY_RUN ? '[dry-run] ' : ''}done — created ${created}, updated ${updated}, ` +
    `deleted ${deleted}, unchanged ${unchanged}`,
  )
}

main().catch((err) => {
  console.error('[outlook-bridge] FATAL:', err instanceof Error ? err.message : err)
  process.exit(1)
})

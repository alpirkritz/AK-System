/**
 * Apple Calendar Bridge – reads local macOS Calendar events via a compiled
 * Swift EventKit helper binary (`calendar-helper`).
 *
 * EventKit reads directly from the macOS CalendarStore cache, so it returns
 * results instantly (< 2s) without triggering Exchange server sync.
 *
 * The helper binary lives at:
 *   packages/api/src/services/calendar-helper/calendar-helper
 *
 * To build the binary:
 *   swiftc packages/api/src/services/calendar-helper/main.swift \
 *          -o packages/api/src/services/calendar-helper/calendar-helper
 *
 * On first run, macOS will ask for Calendar access for the binary.
 */

const EXEC_TIMEOUT_MS = 15_000 // 15 s – EventKit reads from local cache, should be fast

export interface AppleCalendarEvent {
  id: string
  title: string
  start: string
  end: string
  isAllDay: boolean
  location: string | null
  description: string | null
  status: string | null
  rsvp?: 'accepted' | 'declined' | 'tentative' | 'needsAction'
  calendarId: string
  calendarName: string
  calendarColor: string | null
  source: 'apple'
}

/** Returns true when running on macOS */
export function isAppleCalendarAvailable(): boolean {
  return process.platform === 'darwin'
}

// ── Binary path resolution ────────────────────────────────────────────────────

/** Locate the calendar-helper binary by walking up from cwd to find the monorepo root */
async function resolveHelperPath(): Promise<string> {
  // Allow explicit override via environment variable
  if (process.env.CALENDAR_HELPER_PATH) return process.env.CALENDAR_HELPER_PATH

  // Dynamic imports with webpackIgnore so webpack does not bundle these Node builtins
  const { join, dirname, resolve } = await import(/* webpackIgnore: true */ 'path' as string) as typeof import('path')
  const { existsSync }             = await import(/* webpackIgnore: true */ 'fs' as string)   as typeof import('fs')

  let dir = process.cwd()
  while (true) {
    if (existsSync(join(dir, 'pnpm-workspace.yaml'))) {
      return join(dir, 'packages/api/src/services/calendar-helper/calendar-helper')
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  // Fallback: assume cwd is apps/web
  return resolve(process.cwd(), '../../packages/api/src/services/calendar-helper/calendar-helper')
}

// ── EventKit helper invocation ────────────────────────────────────────────────

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
  location?: string
  notes?: string
  url?: string
  status: string
  organizer?: string
  attendeeStatus?: string
}

async function runHelper(timeMin: Date, timeMax: Date): Promise<AppleCalendarEvent[]> {
  const { spawn } = await import(/* webpackIgnore: true */ 'child_process' as string) as typeof import('child_process')

  const helperPath = await resolveHelperPath()
  const fmt = (d: Date) => d.toISOString()

  return new Promise<AppleCalendarEvent[]>((resolve) => {
    let stdout = ''
    let stderr = ''

    const proc = spawn(
      helperPath,
      ['--start', fmt(timeMin), '--end', fmt(timeMax)],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )

    const timer = setTimeout(() => {
      try { proc.kill('SIGKILL') } catch (_) {}
      console.warn('[Apple Calendar] helper timed out')
      resolve([])
    }, EXEC_TIMEOUT_MS)

    proc.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    proc.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (stderr) console.warn('[Apple Calendar] helper stderr:', stderr.slice(0, 200))

      if (code !== 0 && !stdout) {
        console.warn('[Apple Calendar] helper exited with code', code)
        resolve([])
        return
      }

      try {
        const raw: RawEvent[] = JSON.parse(stdout)

        if (!Array.isArray(raw)) {
          const err = (raw as { error?: string })
          console.warn('[Apple Calendar] helper error:', err)
          resolve([])
          return
        }

        // Exclude Google-sourced events (fetched via Google Calendar API separately)
        // and skip noise calendars (birthdays, holidays already in Google)
        const SKIP_SOURCE = /^(Google|alpirkritz@gmail\.com)/i
        const SKIP_CAL    = /^(Birthdays|United States holidays|Holidays in Israel|Siri Suggestions|Scheduled Reminders|חגים בישראל|Jewish Holidays)/i

        // The same Exchange event can appear as two local calendar copies with different
        // EventKit IDs. Prefer the Exchange-sourced copy; fall back to any other.
        const dedupMap = new Map<string, RawEvent>()
        for (const e of raw) {
          if (SKIP_SOURCE.test(e.calSource) || SKIP_CAL.test(e.calendar)) continue
          const key = `${e.title}|${e.start}`
          const existing = dedupMap.get(key)
          if (!existing || (existing.calSource !== 'Exchange' && e.calSource === 'Exchange')) {
            dedupMap.set(key, e)
          }
        }

        const events: AppleCalendarEvent[] = Array.from(dedupMap.values())
          .sort((a, b) => a.start.localeCompare(b.start))
          .map(e => {
            const rawRsvp = e.attendeeStatus
            const rsvp = (rawRsvp === 'accepted' || rawRsvp === 'declined' ||
                          rawRsvp === 'tentative' || rawRsvp === 'needsAction')
              ? rawRsvp as 'accepted' | 'declined' | 'tentative' | 'needsAction'
              : undefined
            return {
              id:            `apple:${e.id}`,
              title:         e.title,
              start:         e.start,
              end:           e.end,
              isAllDay:      e.allDay,
              location:      e.location ?? null,
              description:   e.notes   ?? null,
              status:        e.status  ?? 'confirmed',
              rsvp,
              calendarId:    `apple:${e.calendarId}`,
              calendarName:  e.calendar,
              calendarColor: null,
              source:        'apple' as const,
            }
          })

        console.log(`[Apple Calendar] ${events.length} events (${raw.length} raw, filtered from local cache)`)
        resolve(events)
      } catch (err) {
        console.warn('[Apple Calendar] JSON parse error:', (err as Error).message)
        resolve([])
      }
    })

    proc.on('error', (err) => {
      clearTimeout(timer)
      console.warn('[Apple Calendar] failed to spawn helper:', err.message)
      resolve([])
    })
  })
}

// ── In-process cache ──────────────────────────────────────────────────────────

const CACHE_TTL_MS = 20 * 60 * 1000  // 20 minutes

// Single global cache covering a wide date window (~6 weeks).
// All per-request calls filter from this one cache, so the Swift binary is only
// invoked once (or once every 10 min). Any requested range within the window
// is served from memory in microseconds.
interface GlobalCache {
  events: AppleCalendarEvent[]
  rangeStart: Date
  rangeEnd: Date
  fetchedAt: number
}

// Store on `global` so the cache survives Next.js HMR module reloads.
// Without this, every hot-reload resets the module variables and the
// Swift binary would be re-invoked on every request.
declare global {
  // eslint-disable-next-line no-var
  var __appleCalCache: GlobalCache | null | undefined
  // eslint-disable-next-line no-var
  var __appleCalInflight: Promise<AppleCalendarEvent[]> | null | undefined
}
if (global.__appleCalCache === undefined) global.__appleCalCache = null
if (global.__appleCalInflight === undefined) global.__appleCalInflight = null

function wideRange(): { start: Date; end: Date } {
  const start = new Date()
  start.setDate(start.getDate() - 1)    // yesterday
  start.setHours(0, 0, 0, 0)
  const end = new Date(start)
  end.setDate(end.getDate() + 42)        // 6 weeks ahead
  return { start, end }
}

function isCacheValid(): boolean {
  return (
    global.__appleCalCache !== null &&
    global.__appleCalCache !== undefined &&
    Date.now() - global.__appleCalCache.fetchedAt < CACHE_TTL_MS
  )
}

function filterFromCache(timeMin: Date, timeMax: Date): AppleCalendarEvent[] {
  if (!global.__appleCalCache) return []
  return global.__appleCalCache.events.filter((e) => {
    const s = new Date(e.start)
    return s >= timeMin && s < timeMax
  })
}

async function ensureCacheLoaded(): Promise<void> {
  if (isCacheValid()) return

  if (!global.__appleCalInflight) {
    const { start, end } = wideRange()
    global.__appleCalInflight = runHelper(start, end).then((events) => {
      global.__appleCalCache = { events, rangeStart: start, rangeEnd: end, fetchedAt: Date.now() }
      global.__appleCalInflight = null
      console.log(`[Apple Calendar] cache loaded – ${events.length} events`)
      return events
    })
  }

  await global.__appleCalInflight!
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fetches events from Apple Calendar for the given date range.
 *
 * Uses a single global cache (6-week window, 10-min TTL) backed by the Swift
 * EventKit helper binary. The helper reads from the local CalendarStore cache
 * so it completes in < 2 seconds.
 */
export async function fetchAppleCalendarEvents(
  timeMin: Date,
  timeMax: Date,
): Promise<AppleCalendarEvent[]> {
  if (!isAppleCalendarAvailable()) return []
  await ensureCacheLoaded()
  return filterFromCache(timeMin, timeMax)
}

/** Clears the in-memory cache so the next fetch reads fresh data from EventKit. */
export function invalidateAppleCalendarCache(): void {
  global.__appleCalCache = null
}

/** Kicks off a background cache load (non-blocking). */
export function warmAppleCalendarCache(): void {
  if (!isAppleCalendarAvailable()) return
  if (isCacheValid() || global.__appleCalInflight) return
  console.log('[Apple Calendar] pre-warming cache...')
  ensureCacheLoaded().catch((e) => console.warn('[Apple Calendar] warm error:', e))
}

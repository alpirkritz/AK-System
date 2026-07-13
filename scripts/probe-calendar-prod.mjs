import Database from 'better-sqlite3'
import { google } from 'googleapis'

const db = new Database(process.env.DATABASE_PATH || '/data/ak_system.sqlite')

const rows = db.prepare(
  "SELECT id, calendar_email, length(refresh_token) as rt_len, token_expires_at FROM google_connections WHERE provider='google' AND is_active=1"
).all()
console.log('google_connections:', rows)

const scopeRow = db.prepare("SELECT agent_calendar_ids FROM user_settings WHERE id='default'").get()
console.log('agent_calendar_ids:', scopeRow?.agent_calendar_ids ?? null)

if (!rows[0]?.calendar_email) {
  console.log('NO GOOGLE CONNECTION ON SERVER — user must reconnect via production URL')
  process.exit(0)
}

const conn = db.prepare(
  "SELECT calendar_email, access_token, refresh_token FROM google_connections WHERE provider='google' AND is_active=1 LIMIT 1"
).get()

const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID || process.env.GOOGLE_CLIENT_ID
const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET
const oauth2 = new google.auth.OAuth2(clientId, clientSecret)
oauth2.setCredentials({ refresh_token: conn.refresh_token })
const { credentials } = await oauth2.refreshAccessToken()
oauth2.setCredentials(credentials)
const cal = google.calendar({ version: 'v3', auth: oauth2 })

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
const [y, m, d] = today.split('-').map(Number)
const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0))
let timeMin, timeMax
for (let h = -16; h <= 16; h++) {
  const c = new Date(probe.getTime() + h * 3600000)
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(c)
  if (day === today) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
    }).formatToParts(c)
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
    const second = Number(parts.find((p) => p.type === 'second')?.value ?? 0)
    timeMin = new Date(c.getTime() - ((hour * 60 + minute) * 60 + second) * 1000)
    break
  }
}
const nextDay = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
const [ny, nm, nd] = nextDay.split('-').map(Number)
const probe2 = new Date(Date.UTC(ny, nm - 1, nd, 12, 0, 0))
for (let h = -16; h <= 16; h++) {
  const c = new Date(probe2.getTime() + h * 3600000)
  const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(c)
  if (day === nextDay) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Jerusalem', hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: false,
    }).formatToParts(c)
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? 0)
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? 0)
    const second = Number(parts.find((p) => p.type === 'second')?.value ?? 0)
    timeMax = new Date(c.getTime() - ((hour * 60 + minute) * 60 + second) * 1000)
    break
  }
}

console.log('today IL:', today, 'range:', timeMin?.toISOString(), '->', timeMax?.toISOString())

const calList = await cal.calendarList.list({ minAccessRole: 'reader' })
const calendars = (calList.data.items || []).filter((c) => c.id && !c.id.endsWith('@import.calendar.google.com'))
console.log('calendars:', calendars.map((c) => ({ id: c.id, summary: c.summary })))

const dragontail = calendars.find((c) => /dragontail/i.test(c.summary || ''))
if (!dragontail) {
  console.log('NO DRAGONTAIL CALENDAR IN LIST')
} else {
  const res = await cal.events.list({
    calendarId: dragontail.id,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    orderBy: 'startTime',
    maxResults: 50,
  })
  const evs = res.data.items || []
  console.log(`dragontail events today (${dragontail.summary}):`, evs.length)
  evs.slice(0, 8).forEach((e) => console.log(' -', e.start?.dateTime || e.start?.date, e.summary))
}

let total = 0
for (const c of calendars) {
  const res = await cal.events.list({
    calendarId: c.id,
    timeMin: timeMin.toISOString(),
    timeMax: timeMax.toISOString(),
    singleEvents: true,
    maxResults: 250,
  })
  const n = (res.data.items || []).length
  if (n > 0) console.log(`  ${c.summary}: ${n}`)
  total += n
}
console.log('total events all calendars:', total)

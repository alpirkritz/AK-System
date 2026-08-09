#!/usr/bin/env node
/**
 * local-cron — in-process scheduler for running AK System from the Mac.
 *
 * Problem it solves: the cron endpoints (/api/cron/*) are only ever invoked by
 * the EC2 crontab (scripts/install-server-cron.sh). When serving locally via
 * scripts/serve.sh, NOTHING triggers them — so morning briefing, meeting prep,
 * agent triggers (email assistant), task reminders etc. never run and no push
 * is ever sent. This script replicates deploy/crontab.example against localhost.
 *
 * Started automatically by scripts/serve.sh (skip with SKIP_CRON=1), or run
 * standalone: node scripts/local-cron.mjs
 */
const PORT = process.env.PORT || 3000
const BASE = process.env.CRON_BASE_URL || `http://localhost:${PORT}`
const SECRET = process.env.CRON_SECRET || ''

// [route, interval in minutes] — mirrors deploy/crontab.example
const JOBS = [
  ['task-reminder', 1],
  ['pre-meeting-briefing', 5],
  ['morning-briefing', 15],
  ['calendar-sync', 15],
  ['daily-meeting-summary', 15],
  ['scheduled-agents', 15],
  ['whatsapp-group-summary', 15],
  ['notion-sync', 30],
  ['feed-sync', 360],
  ['whatsapp-message-retention', 1440],
]

const headers = SECRET ? { Authorization: `Bearer ${SECRET}` } : {}
const ts = () => new Date().toLocaleTimeString('he-IL', { hour12: false })

async function hit(route) {
  try {
    const res = await fetch(`${BASE}/api/cron/${route}`, { method: 'POST', headers, signal: AbortSignal.timeout(120000) })
    let info = ''
    try {
      const j = await res.json()
      info = JSON.stringify(j).slice(0, 160)
    } catch { /* non-JSON */ }
    // task-reminder every minute is noisy — only log it on failure
    if (!res.ok || route !== 'task-reminder') console.log(`[local-cron ${ts()}] ${route} → ${res.status} ${info}`)
  } catch (e) {
    console.log(`[local-cron ${ts()}] ${route} → FAILED: ${e.message}`)
  }
}

console.log(`[local-cron] scheduling ${JOBS.length} jobs against ${BASE} (Ctrl-C to stop)`)
let minute = 0
setInterval(() => {
  minute++
  for (const [route, every] of JOBS) if (minute % every === 0) hit(route)
}, 60_000)
// fire the sync-ish jobs once on boot so the day starts consistent
for (const route of ['calendar-sync', 'morning-briefing', 'pre-meeting-briefing', 'scheduled-agents']) hit(route)

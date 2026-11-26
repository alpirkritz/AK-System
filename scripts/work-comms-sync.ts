/**
 * Local work-comms bridge entry point.
 *
 * Pulls the enabled read-only sources from the signed-in sessions on this Mac (the sessions
 * are device-bound, so the pull must run here) and either:
 *   - forwards the rows to the production app on EC2 over HTTP (WORK_COMMS_TARGET_URL set) —
 *     the server persists and runs the commitment scan, same split as the WhatsApp bridge; or
 *   - writes straight into the local SQLite (no target URL) for local dev.
 *
 * Each source is independent: a failure (expired session, network) is logged and never
 * aborts the others. Session expiry fails with the re-auth command.
 *
 *   WORK_BRIDGE_SOURCES=outlook-mail,slack-cache   (default)
 *     slack-cache — reads the Slack desktop app's local cache (no Slack API call; the API is
 *                   Enterprise-Grid-restricted). docs/specs/local-chat-cache-ingest.md
 *     slack / teams — the old token-based pulls, blocked by IT; opt-in only
 *   WORK_COMMS_TARGET_URL=https://<app>      (prod ingest base; omit for local)
 *   WORK_COMMS_BRIDGE_SECRET=<shared secret> (required when WORK_COMMS_TARGET_URL is set)
 *
 * Run:  pnpm exec tsx scripts/work-comms-sync.ts  (usually via scripts/work-comms-bridge-run.sh)
 */
import { getDb } from '@ak-system/database'
import { ingestWorkMail, ingestWorkTeams, type WorkTeamsIngestPayload } from '../packages/api/src/services/work-comms-ingest'
import { fetchOwaMailHeaders } from './owa-mail-source'
import { fetchChatMessages, fetchTeamsChats, graphChatToInfo, graphMessageToRow, withTeamsGraph } from './teams-chat-source'
import { ingestSlackCache } from '../packages/api/src/services/slack-cache-ingest'
import { loadSentState, onlyNewMessages, readSlackCache, saveSentState } from './slack-cache-source'

type Db = ReturnType<typeof getDb>

// Slack comes from the desktop app's local cache. The API-based Slack and Teams pulls are
// blocked at the Yum/Pizza Hut org level and stay opt-in only.
const SOURCES = (process.env.WORK_BRIDGE_SOURCES || 'outlook-mail,slack-cache')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean)

const TARGET_URL = process.env.WORK_COMMS_TARGET_URL?.replace(/\/$/, '') || ''
const SECRET = process.env.WORK_COMMS_BRIDGE_SECRET || ''
const REMOTE = Boolean(TARGET_URL)
const OUTLOOK_MAIL_DAYS = Number(process.env.OUTLOOK_MAIL_DAYS_BACK || 30)
const TEAMS_LOOKBACK_DAYS = Number(process.env.TEAMS_LOOKBACK_DAYS || 30)

async function postJson(path: string, body: unknown): Promise<Record<string, unknown>> {
  if (!SECRET) throw new Error('WORK_COMMS_TARGET_URL is set but WORK_COMMS_BRIDGE_SECRET is missing')
  const res = await fetch(`${TARGET_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${SECRET}` },
    body: JSON.stringify(body),
  })
  const text = await res.text()
  if (!res.ok) throw new Error(`POST ${path} → ${res.status} ${text.slice(0, 300)}`)
  return (text ? JSON.parse(text) : {}) as Record<string, unknown>
}

async function runOutlookMail(db: Db): Promise<void> {
  // The session pull happens here on the Mac; the EmailFetcher ignores its addresses arg.
  const fetched = await fetchOwaMailHeaders([], OUTLOOK_MAIL_DAYS)
  if (fetched.accountErrors.length > 0) {
    throw new Error(`outlook-mail: ${fetched.accountErrors.map((e) => `${e.account}: ${e.error}`).join('; ')}`)
  }
  if (REMOTE) {
    const r = await postJson('/api/work-comms/mail/ingest', { messages: fetched.messages })
    console.log(`[work-comms] outlook-mail → EC2 — sent ${fetched.messages.length}, created ${r.created}, updated ${r.updated}`)
  } else {
    const r = await ingestWorkMail(db, fetched.messages)
    console.log(`[work-comms] outlook-mail (local) — ${fetched.messages.length} messages, created ${r.created}, updated ${r.updated}`)
  }
}

async function runTeams(db: Db): Promise<void> {
  const floor = Date.now() - TEAMS_LOOKBACK_DAYS * 86_400_000
  const payload = await withTeamsGraph(async (rest): Promise<WorkTeamsIngestPayload> => {
    const chats = await fetchTeamsChats(rest)
    const out: WorkTeamsIngestPayload = { chats: [], messages: [] }
    for (const chat of chats) {
      const info = graphChatToInfo(chat)
      out.chats.push({ chatId: info.chatId, topic: info.topic, chatType: info.chatType, memberNames: info.memberNames })
      const messages = await fetchChatMessages(rest, info.chatId)
      for (const msg of messages) {
        const row = graphMessageToRow(msg, info.emailByName)
        if (!row || row.ts < floor) continue
        out.messages.push({ chatId: info.chatId, ...row })
      }
    }
    return out
  })
  if (REMOTE) {
    const r = await postJson('/api/work-comms/teams/ingest', payload)
    console.log(`[work-comms] teams → EC2 — ${payload.chats.length} chats, sent ${payload.messages.length} messages, stored ${r.stored}`)
  } else {
    const r = await ingestWorkTeams(db, payload)
    console.log(`[work-comms] teams (local) — ${payload.chats.length} chats, ${r.stored} stored, ${r.scan.commitments} commitments`)
  }
}

async function runSlackCache(db: Db): Promise<void> {
  const full = readSlackCache()
  const sent = loadSentState()
  const payload = onlyNewMessages(full, sent)
  const summary = `${full.conversations.length} conversations, ${full.members.length} members, ${payload.messages.length}/${full.messages.length} new messages`
  if (REMOTE) {
    const r = await postJson('/api/work-comms/slack/ingest', payload)
    console.log(`[work-comms] slack-cache → EC2 — ${summary}; stored ${r.stored}, linked ${r.linked}, commitment scan running on the server`)
  } else {
    const r = await ingestSlackCache(db, payload)
    console.log(`[work-comms] slack-cache (local) — ${summary}; stored ${r.stored}, linked ${r.linked}, commitments ${r.scan.commitments}`)
  }
  // Only after the server accepted them, so a failed post is retried next run.
  saveSentState(payload, sent)
}

async function main(): Promise<void> {
  // In remote mode the server owns the DB; don't touch the local SQLite at all.
  const db = REMOTE ? (null as unknown as Db) : getDb()
  console.log(`[work-comms] mode: ${REMOTE ? `remote → ${TARGET_URL}` : 'local DB'} · sources: ${SOURCES.join(', ')}`)
  const failures: string[] = []
  for (const source of SOURCES) {
    try {
      if (source === 'outlook-mail') await runOutlookMail(db)
      else if (source === 'teams') await runTeams(db)
      else if (source === 'slack-cache') await runSlackCache(db)
      else if (source === 'slack') {
        // Slack on the Yum Enterprise Grid returns enterprise_is_restricted for the client
        // conversation APIs even with a valid web token — blocked at the org admin level.
        console.warn('[work-comms] slack skipped — Enterprise Grid API is admin-restricted on this workspace')
      } else console.warn(`[work-comms] unknown source "${source}" — skipped`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`[work-comms] ${source} FAILED: ${msg}`)
      failures.push(source)
    }
  }
  if (failures.length > 0) {
    console.error(`[work-comms] done with failures: ${failures.join(', ')}`)
    process.exit(1)
  }
  console.log('[work-comms] done — all sources ok')
}

main().catch((err) => {
  console.error('[work-comms] fatal:', err)
  process.exit(1)
})

/**
 * Slack local-session source for the work-comms bridge.
 *
 * The shipped Slack integration (packages/api/src/services/slack.ts) is built on OAuth
 * install + an Events webhook — both require IT to approve a Slack app and expose a public
 * HTTPS endpoint, which Conditional Access / IT policy blocks. This module adds the local
 * path: it harvests the token the signed-in Slack *web* session already holds (same trick
 * as the OWA bridge), pulls channel history over the web API, and feeds it into the exact
 * same storage (`ingestSlackMessage`) and commitment scan (`scanSlackCommitments`). No new
 * table, no OAuth, no webhook.
 *
 * Create the session once with scripts/slack-login.ts. Read-only: no chat:write, no posts.
 */
import { homedir } from 'os'
import { join } from 'path'

export const SLACK_PROFILE_DIR = process.env.SLACK_PROFILE_DIR || join(homedir(), '.ak-slack-profile')
const SLACK_WEB_URL = 'https://app.slack.com/client'
const SLACK_API = 'https://slack.com/api'
const HISTORY_PAGE = 200
const MAX_HISTORY_PER_CHANNEL = Number(process.env.SLACK_LOCAL_MAX_PER_CHANNEL || 400)

export interface SlackLocalTeam {
  teamId: string
  teamName: string
  token: string
}

/**
 * Pure: pull the per-team xoxc tokens out of Slack web's `localConfig_v2` blob.
 * Shape: { teams: { T0..: { id, name, token } }, lastActiveTeamId }. Defensive against
 * missing fields and config-version drift.
 */
export function parseSlackLocalConfig(raw: string | null | undefined): SlackLocalTeam[] {
  if (!raw) return []
  let cfg: unknown
  try {
    cfg = JSON.parse(raw)
  } catch {
    return []
  }
  const teams = (cfg as { teams?: Record<string, unknown> })?.teams
  if (!teams || typeof teams !== 'object') return []
  const out: SlackLocalTeam[] = []
  for (const entry of Object.values(teams)) {
    const t = entry as { id?: unknown; name?: unknown; token?: unknown }
    if (typeof t.token === 'string' && t.token.startsWith('xoxc-') && typeof t.id === 'string') {
      out.push({ teamId: t.id, teamName: typeof t.name === 'string' ? t.name : t.id, token: t.token })
    }
  }
  return out
}

export interface SlackHistoryMessage {
  type?: string
  subtype?: string
  user?: string
  text?: string
  ts?: string
  thread_ts?: string
  edited?: { ts: string }
  bot_id?: string
}

/** Pure: a conversations.history message → the event shape ingestSlackMessage expects. */
export function historyToEvent(
  msg: SlackHistoryMessage,
  channelId: string,
): Parameters<typeof import('../packages/api/src/services/slack').ingestSlackMessage>[1] | null {
  if (!msg.ts) return null
  return {
    type: 'message',
    channel: channelId,
    user: msg.user,
    text: msg.text,
    ts: msg.ts,
    thread_ts: msg.thread_ts,
    edited: msg.edited,
    subtype: msg.bot_id ? 'bot_message' : msg.subtype,
  }
}

// ─── Impure: the live harvest + pull. Imported lazily so the pure helpers stay cheap. ───

interface SlackSession {
  team: SlackLocalTeam
  /** context.request-style poster that carries the profile's cookies. */
  post: (method: string, form: Record<string, string>) => Promise<Record<string, unknown>>
  close: () => Promise<void>
}

/** Open the Slack web profile and return the active team's token + an authed poster. */
export async function openSlackSession(): Promise<SlackSession> {
  const { chromium } = await import('playwright')
  const context = await chromium.launchPersistentContext(SLACK_PROFILE_DIR, {
    headless: true,
    viewport: { width: 1440, height: 900 },
  })
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(SLACK_WEB_URL, { waitUntil: 'networkidle', timeout: 60000 })

  // Read the token blob, retrying through any late navigation that destroys the context.
  const readConfig = async (): Promise<string | null> => {
    try {
      return await page.evaluate(() => {
        try {
          return window.localStorage.getItem('localConfig_v2')
        } catch {
          return null
        }
      })
    } catch {
      return null
    }
  }
  let raw = await readConfig()
  let teams = parseSlackLocalConfig(raw)
  for (let attempt = 0; attempt < 3 && teams.length === 0; attempt++) {
    await page.waitForTimeout(2000)
    raw = await readConfig()
    teams = parseSlackLocalConfig(raw)
  }
  if (teams.length === 0) {
    await context.close()
    throw new Error(
      'No signed-in Slack team found in the web session. Re-authenticate with: pnpm exec tsx scripts/slack-login.ts',
    )
  }
  const preferred = process.env.SLACK_TEAM_ID
  const team = (preferred && teams.find((t) => t.teamId === preferred)) || teams[0]

  return {
    team,
    post: async (method, form) => {
      const res = await context.request.post(`${SLACK_API}/${method}`, {
        form: { token: team.token, ...form },
      })
      return (await res.json()) as Record<string, unknown>
    },
    close: () => context.close(),
  }
}

/** List channels the user is in and upsert them into slack_channels (disabled by default). */
export async function syncChannelsLocal(
  session: SlackSession,
  upsert: (ch: { channelId: string; name: string; isPrivate: boolean }, team: SlackLocalTeam) => Promise<void>,
): Promise<number> {
  let cursor = ''
  let count = 0
  do {
    const data = await session.post('users.conversations', {
      types: 'public_channel,private_channel',
      exclude_archived: 'true',
      limit: '200',
      ...(cursor ? { cursor } : {}),
    })
    if (!data.ok) break
    for (const ch of (data.channels as { id: string; name: string; is_private?: boolean }[]) ?? []) {
      await upsert({ channelId: ch.id, name: ch.name, isPrivate: Boolean(ch.is_private) }, session.team)
      count++
    }
    cursor = (data.response_metadata as { next_cursor?: string })?.next_cursor || ''
  } while (cursor)
  return count
}

/** Pull history for one channel since `oldestMs` (0 = all, bounded by MAX_HISTORY_PER_CHANNEL). */
export async function fetchChannelHistory(
  session: SlackSession,
  channelId: string,
  oldestMs: number,
): Promise<SlackHistoryMessage[]> {
  const oldest = oldestMs > 0 ? (oldestMs / 1000).toFixed(6) : '0'
  const out: SlackHistoryMessage[] = []
  let cursor = ''
  do {
    const data = await session.post('conversations.history', {
      channel: channelId,
      oldest,
      limit: String(HISTORY_PAGE),
      ...(cursor ? { cursor } : {}),
    })
    if (!data.ok) break
    out.push(...((data.messages as SlackHistoryMessage[]) ?? []))
    cursor = (data.response_metadata as { next_cursor?: string })?.next_cursor || ''
  } while (cursor && out.length < MAX_HISTORY_PER_CHANNEL)
  return out.slice(0, MAX_HISTORY_PER_CHANNEL)
}

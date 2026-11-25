/**
 * Slack from the desktop app's local cache (docs/specs/local-chat-cache-ingest.md).
 *
 * The Slack desktop app persists its whole client state (members, channels, recently loaded
 * messages) into one IndexedDB blob under
 *   ~/Library/Application Support/Slack/IndexedDB/https_app.slack.com_0.indexeddb.blob/1/<xx>/<id>
 * Layout: 3-byte Chromium IDB header → Snappy → Blink envelope (ff <ver> + padding) → V8
 * serialized object. Nothing here calls Slack: it only reads a copy of that file.
 */
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import * as v8 from 'v8'
import type { SlackCachePayload } from '../packages/api/src/services/slack-cache-ingest'

export const SLACK_BLOB_DIR = path.join(
  os.homedir(),
  'Library/Application Support/Slack/IndexedDB/https_app.slack.com_0.indexeddb.blob/1',
)

/** Newest blob file (the live redux snapshot is the one Slack rewrites). */
export function findSlackBlob(dir = SLACK_BLOB_DIR): string {
  if (!fs.existsSync(dir)) throw new Error(`Slack desktop cache not found at ${dir} — is the Slack app installed and signed in?`)
  let best: { file: string; mtime: number; size: number } | null = null
  for (const sub of fs.readdirSync(dir)) {
    const subDir = path.join(dir, sub)
    if (!fs.statSync(subDir).isDirectory()) continue
    for (const name of fs.readdirSync(subDir)) {
      const file = path.join(subDir, name)
      const st = fs.statSync(file)
      if (!st.isFile()) continue
      if (!best || st.mtimeMs > best.mtime) best = { file, mtime: st.mtimeMs, size: st.size }
    }
  }
  if (!best) throw new Error(`No Slack cache blob under ${dir}`)
  return best.file
}

function readVarint(b: Uint8Array, i: number): [number, number] {
  let result = 0
  let shift = 0
  for (;;) {
    const c = b[i++]
    result += (c & 0x7f) * 2 ** shift
    shift += 7
    if (c < 0x80) return [result, i]
  }
}

/** Raw Snappy block decompression (no framing). */
export function unsnappy(b: Uint8Array): Buffer {
  const [length, start] = readVarint(b, 0)
  const out = Buffer.allocUnsafe(length)
  let o = 0
  let i = start
  while (i < b.length) {
    const tag = b[i++]
    const kind = tag & 3
    if (kind === 0) {
      let len = tag >> 2
      if (len >= 60) {
        const n = len - 59
        len = 0
        for (let k = 0; k < n; k++) len += b[i + k] * 2 ** (8 * k)
        i += n
      }
      len += 1
      out.set(b.subarray(i, i + len), o)
      o += len
      i += len
      continue
    }
    let len: number
    let offset: number
    if (kind === 1) {
      len = ((tag >> 2) & 7) + 4
      offset = ((tag >> 5) << 8) | b[i++]
    } else if (kind === 2) {
      len = (tag >> 2) + 1
      offset = b[i] | (b[i + 1] << 8)
      i += 2
    } else {
      len = (tag >> 2) + 1
      offset = (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16)) + b[i + 3] * 2 ** 24
      i += 4
    }
    if (offset <= 0 || offset > o) throw new Error('Snappy: bad back-reference')
    for (let k = 0; k < len; k++) out[o + k] = out[o + k - offset]
    o += len
  }
  if (o !== length) throw new Error(`Snappy: expected ${length} bytes, got ${o}`)
  return out
}

/** Highest V8 serializer version this Node can read. */
const NODE_V8_VERSION = v8.serialize(null)[1]

/**
 * Decodes the blob into the persisted redux object. Electron's V8 may write a newer serializer
 * version than Node reads; plain objects/strings/numbers are unchanged across those, so the
 * version byte is lowered. If that ever stops working, deserialize throws and the run fails
 * loudly (never a silent zero).
 */
export function decodeSlackBlob(raw: Buffer): Record<string, unknown> {
  // Chromium IDB value wrapper: ff 11 02 → Snappy-compressed payload follows.
  const body = raw[0] === 0xff && raw[2] === 0x02 ? unsnappy(raw.subarray(3)) : raw
  // Blink envelope: ff <blink ver>, then padding (fe 00 …), then the V8 header ff <v8 ver>.
  let i = 0
  if (body[0] === 0xff) i = 2
  while (i < body.length && (body[i] === 0xfe || body[i] === 0x00)) i++
  if (body[i] !== 0xff) throw new Error('Slack cache: V8 header not found — the cache format changed')
  const v8Bytes = Buffer.from(body.subarray(i))
  if (v8Bytes[1] > NODE_V8_VERSION) v8Bytes[1] = NODE_V8_VERSION
  const state = v8.deserialize(v8Bytes) as Record<string, unknown>
  if (!state || typeof state !== 'object' || !state.messages || !state.members) {
    throw new Error('Slack cache: decoded state has no messages/members — the cache format changed')
  }
  return state
}

const SKIP_SUBTYPES = new Set([
  'channel_join', 'channel_leave', 'channel_topic', 'channel_purpose', 'channel_name', 'channel_archive',
  'channel_unarchive', 'group_join', 'group_leave', 'bot_message', 'bot_add', 'bot_remove', 'tombstone',
  'pinned_item', 'reminder_add', 'joiner_notification', 'huddle_thread',
])

type Rec = Record<string, unknown>
const str = (v: unknown): string => (typeof v === 'string' ? v : '')

function memberName(m: Rec | undefined): string {
  if (!m) return ''
  const profile = (m.profile as Rec | undefined) ?? {}
  return str(profile.real_name) || str(m.real_name) || str(profile.display_name) || str(m.name)
}

/** Slack mrkdwn → plain text: mentions to names, links to labels, entities decoded. */
export function plainSlackText(text: string, nameOf: (userId: string) => string): string {
  return text
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (_, id: string) => `@${nameOf(id) || id}`)
    .replace(/<#[CG][A-Z0-9]+\|([^>]*)>/g, (_, name: string) => `#${name}`)
    .replace(/<!(here|channel|everyone)[^>]*>/g, '@$1')
    .replace(/<(https?:[^|>]+)\|([^>]+)>/g, '$2')
    .replace(/<(https?:[^>]+)>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .trim()
}

/** Turns the decoded redux state into the ingest payload. Pure — unit tested on a fixture. */
export function extractSlackSnapshot(state: Rec): SlackCachePayload {
  const members = (state.members as Record<string, Rec>) ?? {}
  const channels = (state.channels as Record<string, Rec>) ?? {}
  const messages = (state.messages as Record<string, Record<string, Rec>>) ?? {}
  const boot = (state.bootData as Rec) ?? {}

  const selfUserId = str(boot.user_id) || Object.values(members).find((m) => m.is_self === true)?.id
  if (typeof selfUserId !== 'string' || !selfUserId) throw new Error('Slack cache: own user id not found')
  const selfMember = members[selfUserId]
  const teamId = str(boot.enterprise_id) || str(selfMember?.enterprise_id) || str(selfMember?.team_id) || 'slack'
  const nameOf = (id: string) => memberName(members[id])

  const out: SlackCachePayload = { teamId, selfUserId, members: [], conversations: [], messages: [] }
  const usedMembers = new Set<string>([selfUserId])

  for (const [channelId, byTs] of Object.entries(messages)) {
    const conv = channels[channelId]
    for (const msg of Object.values(byTs ?? {})) {
      const subtype = str(msg.subtype)
      if (subtype && SKIP_SUBTYPES.has(subtype)) continue
      const userId = str(msg.user)
      const ts = str(msg.ts)
      if (!userId || !ts || msg.no_display === true) continue
      if (members[userId]?.is_bot === true) continue
      const text = plainSlackText(str(msg.text), nameOf)
      if (!text) continue
      usedMembers.add(userId)
      for (const m of str(msg.text).matchAll(/<@([UW][A-Z0-9]+)/g)) usedMembers.add(m[1])
      out.messages.push({ channelId, slackTs: ts, userId, text, threadTs: str(msg.thread_ts) || null })
    }
    if (!conv) continue
    const isIm = conv.is_im === true
    const isMpim = conv.is_mpim === true
    let memberIds: string[] = []
    if (isIm && str(conv.user)) memberIds = [str(conv.user)]
    else if (isMpim) memberIds = [...new Set(Object.values(byTs ?? {}).map((m) => str(m.user)).filter((u) => u && u !== selfUserId))]
    for (const id of memberIds) usedMembers.add(id)
    const memberNames = memberIds.map((id) => nameOf(id) || id)
    out.conversations.push({
      channelId,
      kind: isIm ? 'dm' : isMpim ? 'group_dm' : 'channel',
      name: isIm ? memberNames[0] || str(conv.name) || channelId : isMpim ? memberNames.join(', ') || str(conv.name) : str(conv.name) || channelId,
      isPrivate: isIm || isMpim || conv.is_private === true,
      memberIds,
      memberNames,
    })
  }

  for (const id of usedMembers) {
    const m = members[id]
    if (!m) continue
    const profile = (m.profile as Rec | undefined) ?? {}
    out.members.push({
      userId: id,
      realName: str(profile.real_name) || str(m.real_name) || null,
      displayName: str(profile.display_name) || null,
      email: str(profile.email) || null,
      title: str(profile.title) || null,
      isSelf: id === selfUserId,
    })
  }
  return out
}

/** Copies the live blob aside (never reads it in place) and decodes it. */
export function readSlackCache(dir = SLACK_BLOB_DIR): SlackCachePayload {
  const blob = findSlackBlob(dir)
  const tmp = path.join(os.tmpdir(), `ak-slack-cache-${process.pid}.bin`)
  fs.copyFileSync(blob, tmp)
  try {
    return extractSlackSnapshot(decodeSlackBlob(fs.readFileSync(tmp)))
  } finally {
    fs.rmSync(tmp, { force: true })
  }
}

const STATE_FILE = path.join(os.homedir(), '.ak-system', 'slack-cache-state.json')

/** Keeps only messages newer than what earlier runs already sent, per conversation. */
export function onlyNewMessages(payload: SlackCachePayload, sent: Record<string, string>): SlackCachePayload {
  const messages = payload.messages.filter((m) => !sent[m.channelId] || parseFloat(m.slackTs) > parseFloat(sent[m.channelId]))
  return { ...payload, messages }
}

export function loadSentState(file = STATE_FILE): Record<string, string> {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>
  } catch {
    return {}
  }
}

export function saveSentState(payload: SlackCachePayload, sent: Record<string, string>, file = STATE_FILE): void {
  const next = { ...sent }
  for (const m of payload.messages) {
    if (!next[m.channelId] || parseFloat(m.slackTs) > parseFloat(next[m.channelId])) next[m.channelId] = m.slackTs
  }
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(next))
}

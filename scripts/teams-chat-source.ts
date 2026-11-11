/**
 * Microsoft Teams chat source for the local work-comms bridge.
 *
 * Reads the signed-in Teams web session's own Graph token (same capture trick as the OWA
 * bridge) and pulls `/me/chats` + each chat's `/messages` over Microsoft Graph, then feeds
 * them into the Teams service (ingestTeamsMessage / scanTeamsCommitments). Conditional
 * Access blocks the application Graph path, so we ride the browser session. Read-only.
 *
 * Create the session once with scripts/teams-login.ts.
 *
 * NOTE (open question in the spec): the audience of the token Teams web mints needs a live
 * confirmation — it may be graph.microsoft.com or a Teams-internal resource. withOwaRest
 * matches the audience by host, and TEAMS_AUDIENCE can be overridden via env if the probe
 * shows a different resource.
 */
import { homedir } from 'os'
import { join } from 'path'
import { withOwaRest, type OwaRestGetter } from './owa-session'

export const TEAMS_PROFILE_DIR = process.env.TEAMS_PROFILE_DIR || join(homedir(), '.ak-teams-profile')
// Teams web now serves from teams.cloud.microsoft (older teams.microsoft.com still redirects here).
const TEAMS_WEB_URL = process.env.TEAMS_WEB_URL || 'https://teams.cloud.microsoft/'
const GRAPH = 'https://graph.microsoft.com'
const TEAMS_AUDIENCE = process.env.TEAMS_TOKEN_AUDIENCE || GRAPH
const CHAT_PAGE = 50
const MSG_PAGE = 50
const MAX_MSGS_PER_CHAT = Number(process.env.TEAMS_MAX_PER_CHAT || 200)

interface GraphIdentity {
  user?: { displayName?: string; id?: string; email?: string }
}
export interface GraphMember {
  displayName?: string
  email?: string
  userId?: string
}
export interface GraphChat {
  id: string
  topic?: string | null
  chatType?: string
  members?: GraphMember[]
}
export interface GraphMessage {
  id: string
  createdDateTime?: string
  lastModifiedDateTime?: string
  deletedDateTime?: string | null
  messageType?: string
  from?: GraphIdentity
  body?: { contentType?: string; content?: string }
}

/** Pure: strip HTML tags/entities from a Graph message body to plain text. */
export function stripHtml(html: string | undefined): string {
  if (!html) return ''
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface TeamsChatInfo {
  chatId: string
  topic: string | null
  chatType: string
  memberNames: string[]
  /** display name (lowercased) → email, for resolving message senders */
  emailByName: Map<string, string>
}

/** Pure: a Graph chat (with expanded members) → the chat info the bridge stores. */
export function graphChatToInfo(chat: GraphChat): TeamsChatInfo {
  const members = chat.members ?? []
  const memberNames = members.map((m) => m.displayName?.trim()).filter((n): n is string => !!n)
  const emailByName = new Map<string, string>()
  for (const m of members) {
    const name = m.displayName?.trim().toLowerCase()
    if (name && m.email) emailByName.set(name, m.email.toLowerCase())
  }
  return {
    chatId: chat.id,
    topic: chat.topic?.trim() || null,
    chatType: chat.chatType || 'group',
    memberNames,
    emailByName,
  }
}

export interface TeamsMessageRow {
  messageId: string
  fromName: string
  fromEmail: string | null
  text: string
  ts: number
}

/** Pure: a Graph chat message → a storable row, or null for system/empty/deleted messages. */
export function graphMessageToRow(msg: GraphMessage, emailByName: Map<string, string>): TeamsMessageRow | null {
  if (!msg.id) return null
  if (msg.deletedDateTime) return null
  // System messages (joins, renames, calls) have no user author or a non-message type.
  if (msg.messageType && msg.messageType !== 'message') return null
  const fromName = msg.from?.user?.displayName?.trim()
  if (!fromName) return null
  const text = stripHtml(msg.body?.content)
  if (!text) return null
  const ts = Date.parse(msg.createdDateTime ?? '') || Date.now()
  const fromEmail = msg.from?.user?.email?.toLowerCase() || emailByName.get(fromName.toLowerCase()) || null
  return { messageId: msg.id, fromName, fromEmail, text, ts }
}

// ─── Impure: live pull. ─────────────────────────────────────────────────────────

export async function fetchTeamsChats(rest: OwaRestGetter): Promise<GraphChat[]> {
  const out: GraphChat[] = []
  let url = `${GRAPH}/v1.0/me/chats?$expand=members&$top=${CHAT_PAGE}`
  while (url) {
    const body = await rest.get<{ value?: GraphChat[]; '@odata.nextLink'?: string }>(url)
    if (Array.isArray(body.value)) out.push(...body.value)
    url = body['@odata.nextLink'] ?? ''
  }
  return out
}

export async function fetchChatMessages(rest: OwaRestGetter, chatId: string): Promise<GraphMessage[]> {
  const out: GraphMessage[] = []
  let url = `${GRAPH}/v1.0/me/chats/${encodeURIComponent(chatId)}/messages?$top=${MSG_PAGE}`
  while (url && out.length < MAX_MSGS_PER_CHAT) {
    const body = await rest.get<{ value?: GraphMessage[]; '@odata.nextLink'?: string }>(url)
    if (Array.isArray(body.value)) out.push(...body.value)
    url = body['@odata.nextLink'] ?? ''
  }
  return out.slice(0, MAX_MSGS_PER_CHAT)
}

/** Open the Teams web session and run `fn` with a Graph REST getter. */
export async function withTeamsGraph<T>(fn: (rest: OwaRestGetter) => Promise<T>): Promise<T> {
  return withOwaRest(
    {
      warmupUrl: TEAMS_WEB_URL,
      audience: TEAMS_AUDIENCE,
      guardSubstr: 'teams.', // matches teams.microsoft.com and teams.cloud.microsoft; not the login host
      profileDir: TEAMS_PROFILE_DIR,
      reauthCmd: 'pnpm exec tsx scripts/teams-login.ts',
      waitUntil: 'domcontentloaded', // Teams keeps live sockets open; networkidle never fires
    },
    fn,
  )
}

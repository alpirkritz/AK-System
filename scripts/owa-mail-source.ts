/**
 * Outlook (Microsoft 365) mail source for the local work-comms bridge.
 *
 * Reads the signed-in work mailbox over the Outlook REST v2.0 `/me/messages` endpoint,
 * reusing the OWA session (same profile and token mechanism as the calendar bridge).
 * Returns the metadata + BodyPreview snippet in the shape the shared email archive
 * (`syncEmailThreads`) already consumes, so Outlook mail flows into the same
 * person_email_threads store and commitment/reply-need pipeline as Gmail — no new table.
 *
 * Only the mailbox owner's own mail is read; nothing is written back. Downstream,
 * syncEmailThreads keeps only threads that touch a known person.
 */
import { withOwaRest, accountFromToken, type OwaRestGetter } from './owa-session'
import type { EmailFetcher, EmailHeaderMessage } from '../packages/api/src/services/email-sync'

const OUTLOOK_REST = 'https://outlook.office.com'
const MAIL_URL = 'https://outlook.office.com/mail/'
const PAGE_SIZE = 50
const MAX_MESSAGES = Number(process.env.OUTLOOK_MAIL_MAX || 400)

const SELECT_FIELDS = [
  'Subject',
  'From',
  'ToRecipients',
  'CcRecipients',
  'ReceivedDateTime',
  'BodyPreview',
  'ConversationId',
].join(',')

interface OwaRecipient {
  EmailAddress?: { Name?: string; Address?: string }
}
export interface OwaMessage {
  Id: string
  ConversationId?: string
  Subject?: string
  BodyPreview?: string
  ReceivedDateTime?: string
  From?: OwaRecipient
  ToRecipients?: OwaRecipient[]
  CcRecipients?: OwaRecipient[]
}

/** Render a recipient list as a mail header string ("Name <addr>, Name2 <addr2>"). */
export function formatRecipients(list: OwaRecipient[] | undefined): string {
  if (!Array.isArray(list)) return ''
  return list
    .map((r) => {
      const name = r.EmailAddress?.Name?.trim()
      const addr = r.EmailAddress?.Address?.trim()
      if (!addr) return name ?? ''
      return name && name !== addr ? `${name} <${addr}>` : addr
    })
    .filter(Boolean)
    .join(', ')
}

/** Pure: an Outlook REST message → the archive's EmailHeaderMessage. */
export function owaMessageToHeader(msg: OwaMessage, accountEmail: string): EmailHeaderMessage | null {
  const messageId = msg.Id
  if (!messageId) return null
  const ms = Date.parse(msg.ReceivedDateTime ?? '') || Date.now()
  return {
    accountEmail,
    messageId,
    // Outlook's ConversationId is the thread; fall back to the message id for singletons.
    threadId: msg.ConversationId?.trim() || messageId,
    subject: msg.Subject?.trim() ?? '',
    from: formatRecipients(msg.From ? [msg.From] : []),
    to: formatRecipients(msg.ToRecipients),
    cc: formatRecipients(msg.CcRecipients),
    date: new Date(ms).toISOString(),
    // BodyPreview is already plain text; matches Gmail's snippet-only policy.
    snippet: msg.BodyPreview?.trim() ?? '',
  }
}

/** Page through /me/messages newest-first within the window, bounded by MAX_MESSAGES. */
export async function fetchOwaMessages(rest: OwaRestGetter, days: number): Promise<OwaMessage[]> {
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const out: OwaMessage[] = []
  let url =
    `${OUTLOOK_REST}/api/v2.0/me/messages` +
    `?$select=${SELECT_FIELDS}` +
    `&$filter=${encodeURIComponent(`ReceivedDateTime ge ${since}`)}` +
    `&$orderby=${encodeURIComponent('ReceivedDateTime desc')}` +
    `&$top=${PAGE_SIZE}`
  while (url && out.length < MAX_MESSAGES) {
    const body = await rest.get<{ value?: OwaMessage[]; '@odata.nextLink'?: string }>(url, {
      Prefer: 'outlook.timezone="UTC"',
    })
    if (Array.isArray(body.value)) out.push(...body.value)
    url = body['@odata.nextLink'] ?? ''
  }
  return out.slice(0, MAX_MESSAGES)
}

/**
 * EmailFetcher over the OWA mailbox. The `addresses` arg (known-people filter used by
 * the Gmail query) is ignored: we pull the whole recent mailbox and let syncEmailThreads
 * keep only threads touching a known person, which avoids an unwieldy server-side OR.
 */
export const fetchOwaMailHeaders: EmailFetcher = async (_addresses, days) => {
  return withOwaRest(
    { warmupUrl: MAIL_URL, audience: OUTLOOK_REST, guardSubstr: 'outlook.office.com' },
    async (rest) => {
      const account = accountFromToken(rest.token) || process.env.OUTLOOK_MAIL_ACCOUNT?.toLowerCase() || 'outlook-work'
      try {
        const messages = await fetchOwaMessages(rest, days)
        return {
          messages: messages
            .map((m) => owaMessageToHeader(m, account))
            .filter((m): m is EmailHeaderMessage => m !== null),
          accountErrors: [],
        }
      } catch (err) {
        return { messages: [], accountErrors: [{ account, error: err instanceof Error ? err.message : String(err) }] }
      }
    },
  )
}

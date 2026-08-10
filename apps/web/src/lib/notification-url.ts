/** Real deep-link target — not empty and not the notifications inbox itself. */
export function isNavigableNotificationUrl(url: string): boolean {
  const raw = url.trim()
  if (!raw) return false
  const path = raw.split('?')[0]?.replace(/\/+$/, '') || ''
  if (!path || path === '/notifications') return false
  return path.startsWith('/')
}

/**
 * Flatten a stored body into a dense one-line summary for the list row.
 * The row clamps to two lines, so collapsing newlines is what makes those two
 * lines carry content instead of a heading followed by a blank line. Agent
 * briefs arrive as markdown, whose leading `#`/`*` markers read as noise once
 * flattened, so they are stripped and the surviving lines joined with a middot.
 * The detail view renders the raw body, markdown and line breaks intact.
 */
export function notificationPreview(body: string, maxChars = 300): string {
  const flat = body
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/^#{1,6}\s+/, '')
        .replace(/^[-*+]\s+/, '')
        .replace(/^\d+[.)]\s+/, '')
        .replace(/^>\s*/, '')
        .replace(/\*\*|__|`/g, '')
        .trim(),
    )
    .filter(Boolean)
    .join(' · ')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat.length <= maxChars) return flat
  return flat.slice(0, maxChars - 1) + '…'
}

/**
 * Point a chat-bound link at the exact message this notification came from, so
 * opening it lands on that brief instead of the bottom of the conversation.
 * Non-chat destinations (WhatsApp settings, agents) are left untouched.
 */
export function withChatMessageId(url: string, messageId: string): string {
  const [path = '', query = ''] = url.split('?')
  if (path.replace(/\/+$/, '') !== '/chat') return url
  const params = new URLSearchParams(query)
  if (params.get('message')) return url
  params.set('message', messageId)
  return `/chat?${params.toString()}`
}

/** Chat message id carried by a `/chat?message=<id>` deep link, if any. */
export function chatMessageIdFromUrl(url: string): string | null {
  const query = url.split('?')[1]
  if (!query) return null
  const id = new URLSearchParams(query).get('message')
  return id?.trim() || null
}

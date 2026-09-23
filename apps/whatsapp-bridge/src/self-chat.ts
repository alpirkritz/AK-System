/** `9725:18@s.whatsapp.net` and `123:4@lid` → user@server, device stripped. */
export function bareUserJid(jid: string): string {
  const trimmed = jid.trim()
  const at = trimmed.lastIndexOf('@')
  const user = (at === -1 ? trimmed : trimmed.slice(0, at)).split(':')[0] ?? ''
  const server = at === -1 ? '' : trimmed.slice(at)
  return `${user}${server}`
}

/**
 * Phone JIDs for this account are rewritten to the LID.
 * Message Yourself lives on `@lid`; a send to `@s.whatsapp.net` shows up on
 * WhatsApp Web and stays "Waiting for this message" on the phone.
 */
export function routeSelfChatJid(requested: string, selfJid: string, selfLid: string): string {
  const dest = (requested || selfLid || selfJid).trim()
  if (!selfLid) return dest
  const bare = bareUserJid(dest)
  if (bare.endsWith('@lid')) return bare
  const ownPn = selfJid ? bareUserJid(selfJid) : ''
  if (ownPn && bare === ownPn) return bareUserJid(selfLid)
  return dest
}

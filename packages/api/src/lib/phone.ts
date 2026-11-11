/** Digits in international form (Israeli local `05x…` becomes `9725x…`); null when too short to trust. */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null
  let digits = raw.replace(/\D/g, '')
  if (digits.startsWith('00')) digits = digits.slice(2)
  if (digits.startsWith('0') && digits.length === 10) digits = '972' + digits.slice(1)
  return digits.length >= 9 ? digits : null
}

/** Phone behind a WhatsApp user JID (`972501234567@s.whatsapp.net`); LID and group JIDs carry none. */
export function phoneFromWhatsappJid(jid: string | null | undefined): string | null {
  if (!jid) return null
  const match = jid.match(/^(\d+)(?::\d+)?@s\.whatsapp\.net$/)
  return match ? normalizePhone(match[1]) : null
}

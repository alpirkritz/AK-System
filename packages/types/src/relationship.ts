/** Relationship attention labels, shared by the web relationships page, the person card and the people list. */

export type AttentionStatus = 'needs_1on1' | 'steady' | 'good'
export type AttentionReason = 'tone_drop' | 'low_1on1' | 'quiet'
export type ContactChannel = 'meeting' | 'whatsapp' | 'email' | 'manual'

export const ATTENTION_STATUS_LABELS: Record<AttentionStatus, string> = {
  needs_1on1: 'צריך 1:1',
  steady: 'יציב',
  good: 'במצב טוב',
}

export const ATTENTION_REASON_LABELS: Record<AttentionReason, string> = {
  tone_drop: 'הטון ירד',
  low_1on1: '1:1 חלש',
  quiet: 'אין שיחה אישית',
}

export const CONTACT_CHANNEL_LABELS: Record<ContactChannel, string> = {
  meeting: 'פגישה',
  whatsapp: 'וואטסאפ',
  email: 'מייל',
  manual: 'ידני',
}

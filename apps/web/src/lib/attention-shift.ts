/** Keep in lockstep with apps/mobile/lib/attention-shift.ts */

export interface AttentionShiftCard {
  name: string
  dataReason?: string | null
  /** The cross-channel status from `relationshipBoard`. Absent on older API responses. */
  attention?: {
    status: 'needs_1on1' | 'steady' | 'good' | null
    severity: number
    suppressed: 'scheduled' | 'acknowledged' | null
  } | null
}

export interface AttentionShift {
  name: string
  dataReason: string
  rest: number
}

/** Keep in lockstep with INTERRUPT_SEVERITY in packages/api/src/services/relationship-attention.ts */
const INTERRUPT_SEVERITY = 2

/**
 * The home screen interrupts only for someone who clearly needs a 1:1 and has neither one booked
 * nor been marked as seen. Milder flags stay on the relationships page, so on most days this is
 * null. Pass people only; circles are not a "who".
 */
export function pickAttentionShift(cards: AttentionShiftCard[]): AttentionShift | null {
  const sharp = cards
    .filter((c) => c.attention?.status === 'needs_1on1' && !c.attention.suppressed && c.attention.severity >= INTERRUPT_SEVERITY)
    .sort((a, b) => b.attention!.severity - a.attention!.severity)
  const top = sharp[0]
  if (!top) return null
  return { name: top.name, dataReason: top.dataReason?.trim() ?? '', rest: sharp.length - 1 }
}

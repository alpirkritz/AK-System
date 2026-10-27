/** Keep in lockstep with apps/mobile/lib/attention-shift.ts */

export interface AttentionShiftCard {
  name: string
  trend: string | null
  recentAvg: number | null
  olderAvg: number | null
  /** Analysed meetings in the recent window. Absent on older API responses. */
  recentCount?: number
  dataReason?: string | null
}

export interface AttentionShift {
  name: string
  verb: 'מתקרר'
  dataReason: string
  rest: number
}

/** Keep in lockstep with DRASTIC_COOLING_DROP / DRASTIC_COOLING_MIN_RECENT in packages/api/src/services/warmth.ts */
const DRASTIC_COOLING_DROP = 0.5
const DRASTIC_COOLING_MIN_RECENT = 2

function drop(card: AttentionShiftCard): number {
  return (card.olderAvg ?? 0) - (card.recentAvg ?? 0)
}

/**
 * The home screen interrupts only for a specific person whose relationship fell sharply.
 * Warming, mild cooling and stable stay on the relationships page, so on most days this is null
 * and no card is shown. Pass people only; circles are not a "who".
 */
export function pickAttentionShift(cards: AttentionShiftCard[]): AttentionShift | null {
  const drastic = cards.filter(
    (card) =>
      card.trend === 'cooling' &&
      card.recentAvg != null &&
      card.olderAvg != null &&
      (card.recentCount ?? DRASTIC_COOLING_MIN_RECENT) >= DRASTIC_COOLING_MIN_RECENT &&
      drop(card) >= DRASTIC_COOLING_DROP,
  )
  const top = [...drastic].sort((a, b) => drop(b) - drop(a))[0]
  if (!top) return null
  return {
    name: top.name,
    verb: 'מתקרר',
    dataReason: top.dataReason?.trim() ?? '',
    rest: drastic.length - 1,
  }
}

/** Keep in lockstep with apps/web/src/lib/attention-shift.ts */

export interface AttentionShiftCard {
  name: string
  trend: string | null
  recentAvg: number | null
  olderAvg: number | null
  dataReason?: string | null
}

export interface AttentionShift {
  name: string
  verb: 'מתקרר' | 'מתחמם'
  dataReason: string
  rest: number
}

function gap(card: AttentionShiftCard): number {
  return Math.abs((card.recentAvg ?? 0) - (card.olderAvg ?? 0))
}

/** Largest warming/cooling shift. Stable and missing trends stay off the dashboard. */
export function pickAttentionShift(cards: AttentionShiftCard[]): AttentionShift | null {
  const movers = cards.filter((card) => card.trend === 'warming' || card.trend === 'cooling')
  if (movers.length === 0) return null
  const ranked = [...movers].sort((a, b) => gap(b) - gap(a))
  const top = ranked[0]
  if (!top) return null
  return {
    name: top.name,
    verb: top.trend === 'cooling' ? 'מתקרר' : 'מתחמם',
    dataReason: top.dataReason?.trim() ?? '',
    rest: movers.length - 1,
  }
}

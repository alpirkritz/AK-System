/** Signed sentiment on the −1…+1 scale, two decimals. */
export function formatSentiment(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const rounded = Math.round(n * 100) / 100
  const body = Math.abs(rounded).toFixed(2)
  if (rounded > 0) return `+${body}`
  if (rounded < 0) return `-${body}`
  return '0.00'
}

export const WARMTH_TREND_LABEL = {
  warming: 'מתחמם',
  cooling: 'מתקרר',
  stable: 'יציב',
} as const

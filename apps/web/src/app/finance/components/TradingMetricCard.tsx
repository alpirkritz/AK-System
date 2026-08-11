'use client'

/**
 * One trading statistic with the plain-Hebrew explanation of what it means.
 *
 * A win rate without "how many trades is this over" invites the wrong conclusion, so the
 * hint text is required rather than optional, and an unmeasurable metric renders as "—"
 * with the reason instead of a zero.
 */
export function TradingMetricCard({
  label,
  value,
  hint,
  color,
  emphasis = false,
}: {
  label: string
  value: string | null
  /** What the number means, or why it cannot be computed yet. */
  hint: string
  color?: string
  emphasis?: boolean
}) {
  const measured = value !== null

  return (
    <div className="card flex flex-col gap-1" title={hint}>
      <span className="text-xs text-[#647399] font-medium">{label}</span>
      <span
        className={`${emphasis ? 'text-2xl' : 'text-xl'} font-bold tracking-tight`}
        style={{ color: measured ? (color ?? '#eef3fb') : '#5a688c' }}
      >
        {measured ? value : '—'}
      </span>
      <span className="text-[11px] text-[#5a688c] leading-snug">{hint}</span>
    </div>
  )
}

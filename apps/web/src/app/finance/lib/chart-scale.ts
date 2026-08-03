/**
 * Minimal SVG chart maths — the parts a chart library would have provided.
 *
 * Charts render into a fixed `viewBox` and scale through CSS, so nothing here needs to
 * measure the DOM. Pure functions, unit-tested alongside.
 */

/** Round a maximum up to a readable axis bound (1/2/5 × 10ⁿ). */
export function niceMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const exponent = Math.floor(Math.log10(value))
  const magnitude = Math.pow(10, exponent)
  const normalized = value / magnitude
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return step * magnitude
}

/** Evenly spaced tick values from 0 to a nice bound, inclusive. */
export function ticks(max: number, count = 4): number[] {
  const bound = niceMax(max)
  return Array.from({ length: count + 1 }, (_, i) => (bound / count) * i)
}

export function scaleLinear(value: number, domainMax: number, rangeMax: number): number {
  if (domainMax <= 0) return 0
  return (Math.max(0, value) / domainMax) * rangeMax
}

function polar(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180
  return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) }
}

/**
 * Donut segment as a filled path between two radii.
 *
 * Paths rather than a dash-array stroke, so segment ends and hover offsets stay
 * controllable and the arc can be a real shape rather than a styled line.
 */
export function describeArc(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number
): string {
  // A full circle cannot be expressed as a single arc — nudge it just short of 360°.
  const sweep = Math.min(endAngle - startAngle, 359.99)
  const end = startAngle + sweep

  const outerStart = polar(cx, cy, outerRadius, startAngle)
  const outerEnd = polar(cx, cy, outerRadius, end)
  const innerEnd = polar(cx, cy, innerRadius, end)
  const innerStart = polar(cx, cy, innerRadius, startAngle)
  const largeArc = sweep > 180 ? 1 : 0

  return [
    `M ${outerStart.x.toFixed(3)} ${outerStart.y.toFixed(3)}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x.toFixed(3)} ${outerEnd.y.toFixed(3)}`,
    `L ${innerEnd.x.toFixed(3)} ${innerEnd.y.toFixed(3)}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x.toFixed(3)} ${innerStart.y.toFixed(3)}`,
    'Z',
  ].join(' ')
}

/**
 * Split values into visible slices plus one pooled slice for everything under `minShare`.
 *
 * The pooled slice is labelled by the caller — never 'אחר', which is a real category.
 */
export function poolSmallSlices<T extends { total: number }>(
  items: readonly T[],
  minSharePct: number
): { visible: T[]; pooled: T[]; pooledTotal: number } {
  const total = items.reduce((s, i) => s + i.total, 0)
  if (total <= 0) return { visible: [...items], pooled: [], pooledTotal: 0 }

  const visible: T[] = []
  const pooled: T[] = []
  for (const item of items) {
    if ((item.total / total) * 100 < minSharePct) pooled.push(item)
    else visible.push(item)
  }
  return { visible, pooled, pooledTotal: pooled.reduce((s, i) => s + i.total, 0) }
}

/** Shared finance formatting. Extracted from page.tsx so the analytics components reuse it. */

import { normalizeCurrencyCode } from '@ak-system/types'

function formatMoney(
  n: number,
  currency: string,
  maximumFractionDigits: number,
  minimumFractionDigits?: number
): string {
  const code = normalizeCurrencyCode(currency)
  try {
    return new Intl.NumberFormat('he-IL', {
      style: 'currency',
      currency: code,
      minimumFractionDigits,
      maximumFractionDigits,
    }).format(n)
  } catch {
    return `${n.toLocaleString('he-IL')} ${currency || code}`
  }
}

export function fmt(n: number, currency = 'ILS'): string {
  return formatMoney(n, currency, 2, 2)
}

/** Whole-shekel variant for charts and headlines, where cents are noise. */
export function fmtShort(n: number, currency = 'ILS'): string {
  return formatMoney(n, currency, 0)
}

export function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('he-IL', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    })
  } catch {
    return iso
  }
}

/** 'YYYY-MM' → 'אוגוסט 2026' */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('he-IL', {
    month: 'long',
    year: 'numeric',
  })
}

/** 'YYYY-MM' → 'אוג׳' for dense chart axes. */
export function monthShort(month: string): string {
  const [y, m] = month.split('-').map(Number)
  if (!y || !m) return month
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('he-IL', { month: 'short' })
}

export function currentMonthKey(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(now)
  const y = parts.find((p) => p.type === 'year')?.value
  const m = parts.find((p) => p.type === 'month')?.value
  if (!y || !m) {
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  }
  return `${y}-${m}`
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

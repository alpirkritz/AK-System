/**
 * Leak Hunter Engine — Personal CFO Module
 *
 * Analyzes recurring charges from cashflow data to identify:
 * - Price creep (YoY increases)
 * - Silent cancellations (subscriptions no longer used)
 * - Bank fees aggregation
 *
 * Classifies each leak as KEEP / CANCEL / RENEGOTIATE using deterministic rules.
 * LLM layer (cfo-narrative.ts) generates Hebrew negotiation letters.
 */

import type { RecurringItem } from './cashflow-analytics'

export type LeakAction = 'KEEP' | 'CANCEL' | 'RENEGOTIATE'

export interface LeakItem {
  id: string
  label: string
  category: string | null
  occurrences: number
  avgAmount: number
  lastAmount: number
  lastDate: string
  firstDate: string
  increasedPct: number | null
  action: LeakAction
  reason: string // Hebrew explanation
  annualizedCost: number
  potentialSavings: number
}

export interface LeakHunterResult {
  leaks: LeakItem[]
  totalBankFees: number
  totalPotentialSavings: number
  summary: string // Hebrew
}

/**
 * Analyze recurring charges for leaks.
 *
 * Rules:
 * - If increasedPct > 10% → RENEGOTIATE (price creep)
 * - If lastDate > 90 days ago AND avgAmount > 50 → CANCEL (not using)
 * - If label includes known fees ("עמלה", "דמי") → flag for review
 * - Otherwise → KEEP
 */
export function analyzeLeaks(recurring: RecurringItem[]): LeakHunterResult {
  const leaks: LeakItem[] = []
  let totalBankFees = 0
  let totalPotentialSavings = 0

  for (const item of recurring) {
    const daysSinceLastCharge = Math.floor(
      (Date.now() - new Date(item.lastDate).getTime()) / (1000 * 60 * 60 * 24)
    )

    let action: LeakAction = 'KEEP'
    let reason = ''
    let potentialSavings = 0

    // Rule 1: Price creep
    if (item.increasedPct !== null && item.increasedPct > 0.1) {
      action = 'RENEGOTIATE'
      reason = `עליית מחיר של ${(item.increasedPct * 100).toFixed(0)}% ביחס לעבר`
      potentialSavings = item.annualizedCost * item.increasedPct // potential saving if renegotiated back
    }
    // Rule 2: Inactive subscription
    else if (daysSinceLastCharge > 90 && item.avgAmount > 50) {
      action = 'CANCEL'
      reason = `לא נעשה שימוש מזה ${daysSinceLastCharge} ימים`
      potentialSavings = item.annualizedCost // full saving if cancelled
    }
    // Rule 3: Bank fees
    else if (
      item.label.includes('עמלה') ||
      item.label.includes('דמי') ||
      item.label.includes('fee') ||
      item.category?.includes('עמלות')
    ) {
      action = 'RENEGOTIATE'
      reason = 'עמלת בנק - ניתן לבקש הפחתה'
      potentialSavings = item.annualizedCost * 0.5 // assume 50% reduction possible
      totalBankFees += item.annualizedCost
    }

    totalPotentialSavings += potentialSavings

    leaks.push({
      id: `leak-${item.label.replace(/\s/g, '-')}`,
      label: item.label,
      category: item.category,
      occurrences: item.occurrences,
      avgAmount: item.avgAmount,
      lastAmount: item.lastAmount,
      lastDate: item.lastDate,
      firstDate: item.firstDate,
      increasedPct: item.increasedPct,
      action,
      reason,
      annualizedCost: item.annualizedCost,
      potentialSavings,
    })
  }

  const summary = `זוהו ${leaks.length} חיובים חוזרים. חיסכון פוטנציאלי: ${totalPotentialSavings.toFixed(0)} ₪/שנה. עמלות בנק: ${totalBankFees.toFixed(0)} ₪/שנה.`

  return {
    leaks,
    totalBankFees,
    totalPotentialSavings,
    summary,
  }
}

/**
 * Generate Hebrew negotiation letter for a leak marked RENEGOTIATE.
 */
export function generateNegotiationLetter(leak: LeakItem): string {
  const monthsSinceStart = Math.floor(
    (new Date().getTime() - new Date(leak.firstDate).getTime()) / (1000 * 60 * 60 * 24 * 30)
  )

  return `שלום,

אני לקוח שלכם מזה ${monthsSinceStart} חודשים והשתמשתי בשירותיכם באופן עקבי.

שמתי לב שהתשלום החודשי עבור ${leak.label} עלה לאחרונה ל-${leak.lastAmount.toFixed(0)} ₪ (בעבר היה כ-${(leak.lastAmount / (1 + (leak.increasedPct || 0))).toFixed(0)} ₪).

אני מעוניין להמשיך את השירות, אך אשמח לשמוע האם ניתן להתאים את המחיר לרמה הקודמת או להציע תכנית חלופית במחיר תחרותי יותר.

אודה על תשובתכם.

בברכה`
}

/**
 * Monthly Review Engine — Personal CFO Module
 *
 * Recurring monthly financial health check:
 * 1. Anomaly detection: categories exceeding 12-month rolling avg by > 15%
 * 2. Sweep validation: confirms cash above Layer 1 buffer was deployed
 * 3. Adversarial checklist: top-3 ₪-impact actions + stress tests
 *
 * Pure deterministic logic — LLM only narrates the results.
 */

import { monthWindow, monthKey, type AnalyticsTxn } from './cashflow-analytics'
import { isInternalCategory } from '@ak-system/types'
import type { BaselineProfile } from './cfo-profiler'

export interface Anomaly {
  category: string
  currentMonthSpend: number
  rollingAvg: number
  excessPct: number // how much over average
  excessAmount: number
}

export type SweepStatus = 'OK' | 'WARN' | 'CRITICAL'

export interface ActionItem {
  id: string
  priority: number // 1-3 (1 = highest)
  action: string // Hebrew
  impactIls: number
  effort: 'low' | 'medium' | 'high'
}

export interface MonthlyReviewResult {
  anomalies: Anomaly[]
  sweepStatus: SweepStatus
  sweepMessage: string
  adversarialChecklist: ActionItem[]
  stressTests: string[] // "What would make this plan fail?" scenarios
}

/**
 * Detect spending anomalies: categories exceeding rolling 12-month avg by > 15%.
 */
export function detectAnomalies(
  transactions: AnalyticsTxn[],
  targetMonth: string // YYYY-MM
): Anomaly[] {
  const months = monthWindow(12)
  const recentTxns = transactions.filter((t) => {
    const txnMonth = monthKey(t.transactionDate)
    return months.includes(txnMonth)
  })

  const countable = recentTxns.filter(
    (t) => !isInternalCategory(t.category) && t.direction === 'expense'
  )

  // Group by category
  const byCategory = new Map<string, { current: number; historical: number[] }>()
  for (const txn of countable) {
    const cat = txn.category || 'אחר'
    const txnMonth = monthKey(txn.transactionDate)

    if (!byCategory.has(cat)) {
      byCategory.set(cat, { current: 0, historical: [] })
    }

    if (txnMonth === targetMonth) {
      byCategory.get(cat)!.current += txn.amount
    } else {
      byCategory.get(cat)!.historical.push(txn.amount)
    }
  }

  const anomalies: Anomaly[] = []
  const THRESHOLD = 0.15 // 15%

  for (const [category, data] of byCategory.entries()) {
    if (data.historical.length === 0) continue

    const rollingAvg = data.historical.reduce((sum, amt) => sum + amt, 0) / data.historical.length
    if (rollingAvg < 100) continue // ignore tiny categories

    const excessPct = (data.current - rollingAvg) / rollingAvg
    if (excessPct > THRESHOLD) {
      anomalies.push({
        category,
        currentMonthSpend: data.current,
        rollingAvg,
        excessPct,
        excessAmount: data.current - rollingAvg,
      })
    }
  }

  return anomalies.sort((a, b) => b.excessAmount - a.excessAmount) // highest excess first
}

/**
 * Validate sweep: check if cash above Layer 1 threshold was deployed.
 */
export function validateSweep(
  currentBalance: number,
  layer1Threshold: number
): { status: SweepStatus; message: string } {
  const excess = currentBalance - layer1Threshold

  if (excess < 0) {
    return {
      status: 'CRITICAL',
      message: `יתרה מתחת ל-Layer 1 (${layer1Threshold.toFixed(0)} ₪) ב-${Math.abs(excess).toFixed(0)} ₪`,
    }
  } else if (excess > layer1Threshold * 0.5) {
    // More than 50% excess sitting idle
    return {
      status: 'WARN',
      message: `כסף לא פרודוקטיבי: ${excess.toFixed(0)} ₪ מעל Layer 1 לא הועבר להשקעה/חיסכון`,
    }
  } else {
    return {
      status: 'OK',
      message: 'יתרה מתחת לLayer 1 לא הועבר להשקעה/חיסכון',
    }
  }
}

/**
 * Generate adversarial action checklist: top-3 high-impact items + stress tests.
 *
 * This is deterministic based on the inputs, but designed to be "adversarial" —
 * challenges assumptions and finds weaknesses.
 */
export function generateAdversarialChecklist(
  profile: BaselineProfile,
  debtFreeMonth: number | null,
  totalFeeDrag: number
): { items: ActionItem[]; stressTests: string[] } {
  const items: ActionItem[] = []

  // 1. Debt payoff (if exists)
  if (debtFreeMonth !== null && debtFreeMonth > 0) {
    items.push({
      id: 'debt-payoff',
      priority: 1,
      action: `להקדיש עודף חודשי לפירעון חובות — חיסכון ריבית משמעותי`,
      impactIls: profile.freeCash * 12 * 0.15, // assume 15% APR savings
      effort: 'medium',
    })
  }

  // 2. Pension fee reduction
  if (totalFeeDrag > 10000) {
    items.push({
      id: 'pension-fees',
      priority: 1,
      action: `לפנות לחברת הפנסיה להפחתת עמלות — פוטנציאל חיסכון ${totalFeeDrag.toFixed(0)} ₪`,
      impactIls: totalFeeDrag * 0.5, // assume 50% reduction possible
      effort: 'low',
    })
  }

  // 3. Emergency fund gap
  if (profile.minBalanceCushion < profile.fixed * 3) {
    items.push({
      id: 'emergency-fund',
      priority: 2,
      action: `לבנות קרן חירום — חסרים ${((profile.fixed * 3) - profile.minBalanceCushion).toFixed(0)} ₪`,
      impactIls: 0, // risk mitigation, not immediate ₪
      effort: 'high',
    })
  }

  // Sort by impact
  items.sort((a, b) => b.impactIls - a.impactIls)

  const stressTests = [
    'מה אם ההכנסה יורדת ב-20% (פיטורים/הקטנת משרה)?',
    'מה אם חירום דורש משיכת Layer 2 (₪50k+)?',
    'מה אם הריבית על החובות עולה ב-5%?',
    'מה אם עמלות הפנסיה לא מופחתות?',
    'מה אם מינוי חודשי מבוטל והסכום לא עובר לחיסכון?',
  ]

  return {
    items: items.slice(0, 3), // top 3
    stressTests,
  }
}

/**
 * Full monthly review.
 */
export function performMonthlyReview(
  transactions: AnalyticsTxn[],
  currentBalance: number,
  profile: BaselineProfile,
  targetMonth: string,
  debtFreeMonth: number | null,
  totalFeeDrag: number
): MonthlyReviewResult {
  const anomalies = detectAnomalies(transactions, targetMonth)
  const layer1 = profile.fixed + profile.variable + profile.minBalanceCushion
  const { status, message } = validateSweep(currentBalance, layer1)
  const { items, stressTests } = generateAdversarialChecklist(profile, debtFreeMonth, totalFeeDrag)

  return {
    anomalies,
    sweepStatus: status,
    sweepMessage: message,
    adversarialChecklist: items,
    stressTests,
  }
}

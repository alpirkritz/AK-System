/**
 * CFO Profiler — Personal CFO Module
 *
 * Computes 12-month baseline cash flow profile: fixed/variable/amortized expenses,
 * net income, true "free cash" (after all obligations), and minimum balance cushion.
 *
 * Wraps existing `cashflow-analytics.ts` functions with CFO-specific slicing logic.
 */

import { monthWindow, type AnalyticsTxn } from './cashflow-analytics'
import { INTERNAL_CATEGORIES, isInternalCategory } from '@ak-system/types'

export interface BaselineProfile {
  /** Fixed monthly expenses (recurring, predictable) */
  fixed: number
  /** Variable monthly expenses (fluctuating) */
  variable: number
  /** Yearly expenses amortized to monthly (insurance, annual subscriptions) */
  yearlyAmortized: number
  /** Total monthly income */
  netIncome: number
  /** True free cash after all obligations */
  freeCash: number
  /** Historical minimum balance + 10% safety buffer */
  minBalanceCushion: number
  /** Number of months analyzed */
  monthsAnalyzed: number
}

/**
 * Compute 12-month baseline profile from transaction history.
 *
 * Logic:
 * - **Fixed:** Recurring items with cadence='monthly' and low variation
 * - **Variable:** Everything else that's regular spending
 * - **Amortized:** Expenses that occur yearly/quarterly, divided by 12
 * - **Free cash:** Net income - (fixed + variable + amortized)
 */
export function computeBaseline(
  transactions: AnalyticsTxn[],
  historicalMinBalance: number = 0
): BaselineProfile {
  // Filter to last 12 months
  const now = new Date()
  const months = monthWindow(12, now)
  const recentTxns = transactions.filter((t) => {
    const txnMonth = t.transactionDate.substring(0, 7)
    return months.includes(txnMonth)
  })

  // Exclude internal transfers (already handled by cashflow-analytics.ts)
  const countable = recentTxns.filter((t) => !isInternalCategory(t.category))

  // Income
  const income = countable.filter((t) => t.direction === 'income')
  const totalIncome = income.reduce((sum, t) => sum + t.amount, 0)
  const netIncome = totalIncome / 12 // monthly average

  // Expenses
  const expenses = countable.filter((t) => t.direction === 'expense')

  // Categorize as fixed/variable/amortized
  // Heuristic:
  // - Fixed: recurring categories (rent, insurance premiums, loan payments)
  // - Variable: discretionary + groceries + utilities
  // - Amortized: one-time or annual (divide by 12)

  const fixedCategories = ['דיור', 'הלוואות', 'ביטוח', 'מינויים']
  const amortizedCategories = ['מס', 'ביטוח שנתי', 'מנוי שנתי']

  const fixed = expenses.filter((t) =>
    fixedCategories.some((cat) => t.category?.includes(cat))
  )
  const amortized = expenses.filter((t) =>
    amortizedCategories.some((cat) => t.category?.includes(cat))
  )
  const variable = expenses.filter((t) => !fixed.includes(t) && !amortized.includes(t))

  const fixedMonthly = fixed.reduce((sum, t) => sum + t.amount, 0) / 12
  const variableMonthly = variable.reduce((sum, t) => sum + t.amount, 0) / 12
  const amortizedMonthly = amortized.reduce((sum, t) => sum + t.amount, 0) / 12

  const freeCash = netIncome - (fixedMonthly + variableMonthly + amortizedMonthly)

  // Min balance cushion: historical min + 10% buffer
  const minBalanceCushion = historicalMinBalance * 1.1

  return {
    fixed: fixedMonthly,
    variable: variableMonthly,
    yearlyAmortized: amortizedMonthly,
    netIncome,
    freeCash,
    minBalanceCushion,
    monthsAnalyzed: months.length,
  }
}

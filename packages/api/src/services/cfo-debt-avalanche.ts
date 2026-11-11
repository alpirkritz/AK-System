/**
 * Debt Avalanche Engine — Personal CFO Module
 *
 * Pure deterministic debt payoff calculator implementing the Avalanche algorithm:
 * **highest APR first**. Given a list of debts and monthly surplus cash, computes
 * the optimal payment timeline, debt-free date, and total interest saved compared
 * to minimum-payment baseline.
 *
 * Critical design principle: This is a **pure mathematical function** — no DB, no LLM,
 * fully testable with exact numerical inputs and outputs. The LLM only receives the
 * computed results for Hebrew narrative synthesis.
 */

export interface Debt {
  id: string
  name: string
  balance: number // current principal
  apr: number // annual percentage rate (decimal, e.g. 0.15 for 15%)
  minPayment: number // minimum monthly payment
  debtType: 'overdraft' | 'credit_loan' | 'installment'
}

export interface MonthlyPayment {
  month: number // 1-indexed (month 1 = first month)
  debtId: string
  debtName: string
  principalPaid: number
  interestPaid: number
  remainingBalance: number
}

export interface AvalancheResult {
  /** Chronological payment timeline for all debts */
  timeline: MonthlyPayment[]
  /** Month when all debts are paid off (0 if never with current surplus) */
  debtFreeMonth: number
  /** Total interest paid across all debts */
  totalInterestPaid: number
  /** Total interest that would be paid with minimum payments only */
  baselineInterestPaid: number
  /** Interest saved by using avalanche */
  interestSaved: number
  /** Warning message if surplus is insufficient */
  warning: string | null
}

/**
 * Compute the debt avalanche payoff schedule.
 *
 * Algorithm:
 * 1. Sort debts by APR descending (highest first)
 * 2. Each month:
 *    a. Pay minimum on all debts
 *    b. Apply surplus to highest-APR debt with remaining balance
 *    c. Accrue interest on remaining balances
 * 3. Stop when all debts are $0
 * 4. Compare total interest vs. minimum-payment baseline
 */
export function computeAvalanche(debts: Debt[], monthlySurplus: number): AvalancheResult {
  if (debts.length === 0) {
    return {
      timeline: [],
      debtFreeMonth: 0,
      totalInterestPaid: 0,
      baselineInterestPaid: 0,
      interestSaved: 0,
      warning: null,
    }
  }

  // Check if surplus is sufficient to cover all minimums
  const totalMinPayment = debts.reduce((sum, d) => sum + d.minPayment, 0)
  if (monthlySurplus < totalMinPayment) {
    return {
      timeline: [],
      debtFreeMonth: 0,
      totalInterestPaid: 0,
      baselineInterestPaid: 0,
      interestSaved: 0,
      warning: `עודף חודשי (${monthlySurplus.toFixed(0)} ₪) אינו מספיק לכיסוי התשלומים המינימליים (${totalMinPayment.toFixed(0)} ₪)`,
    }
  }

  // Sort by APR descending (avalanche = highest interest first)
  const sortedDebts = [...debts].sort((a, b) => b.apr - a.apr)

  // Initialize debt states
  const debtStates = sortedDebts.map((d) => ({
    ...d,
    balance: d.balance,
  }))

  const timeline: MonthlyPayment[] = []
  let totalInterestPaid = 0
  let month = 0
  const MAX_MONTHS = 600 // 50 years safety limit

  while (debtStates.some((d) => d.balance > 0.01) && month < MAX_MONTHS) {
    month++

    // Step 1: Pay minimums on all debts
    for (const debt of debtStates) {
      if (debt.balance <= 0) continue

      const monthlyInterestRate = debt.apr / 12
      const interest = debt.balance * monthlyInterestRate
      const minPrincipal = Math.max(0, debt.minPayment - interest)
      const actualMinPrincipal = Math.min(minPrincipal, debt.balance)

      debt.balance -= actualMinPrincipal
      totalInterestPaid += interest

      timeline.push({
        month,
        debtId: debt.id,
        debtName: debt.name,
        principalPaid: actualMinPrincipal,
        interestPaid: interest,
        remainingBalance: debt.balance,
      })
    }

    // Step 2: Apply surplus to highest-APR debt with remaining balance
    let surplusRemaining = monthlySurplus - totalMinPayment
    for (const debt of debtStates) {
      if (surplusRemaining <= 0) break
      if (debt.balance <= 0) continue

      const extraPayment = Math.min(surplusRemaining, debt.balance)
      debt.balance -= extraPayment
      surplusRemaining -= extraPayment

      // Find and update the timeline entry for this debt in this month
      const entry = timeline.find((t) => t.month === month && t.debtId === debt.id)
      if (entry) {
        entry.principalPaid += extraPayment
        entry.remainingBalance = debt.balance
      }

      break // Avalanche: all surplus goes to one debt at a time
    }
  }

  const debtFreeMonth = debtStates.every((d) => d.balance <= 0.01) ? month : 0

  // Baseline: compute interest if only paying minimums
  const baselineInterestPaid = computeBaselineInterest(debts)

  return {
    timeline,
    debtFreeMonth,
    totalInterestPaid,
    baselineInterestPaid,
    interestSaved: Math.max(0, baselineInterestPaid - totalInterestPaid),
    warning: debtFreeMonth === 0 ? 'לא ניתן לפרוע את כל החובות עם העודף הנוכחי (מגבלת 600 חודשים)' : null,
  }
}

/**
 * Compute baseline interest: total interest paid if only making minimum payments forever.
 *
 * This is a conservative upper bound — actual baseline depends on loan terms, but we
 * assume minimum payments eventually pay off the debt (typical for credit loans and
 * installments). For overdrafts, baseline is often "infinite" since minimums may not
 * cover interest, so we cap at 10 years of current balance × APR as a heuristic.
 */
function computeBaselineInterest(debts: Debt[]): number {
  let totalBaseline = 0

  for (const debt of debts) {
    if (debt.debtType === 'overdraft') {
      // Overdraft heuristic: 10 years of interest on current balance
      totalBaseline += debt.balance * debt.apr * 10
    } else {
      // Credit loan / installment: simulate minimum payments until $0
      let balance = debt.balance
      let interestAccrued = 0
      let months = 0
      const MAX_MONTHS = 600

      while (balance > 0.01 && months < MAX_MONTHS) {
        const monthlyInterestRate = debt.apr / 12
        const interest = balance * monthlyInterestRate
        const principal = Math.max(0, debt.minPayment - interest)
        balance -= Math.min(principal, balance)
        interestAccrued += interest
        months++
      }

      totalBaseline += interestAccrued
    }
  }

  return totalBaseline
}

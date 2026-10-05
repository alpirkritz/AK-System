/**
 * Liquidity Sweep Engine — Personal CFO Module
 *
 * Partitions available cash into three layers for optimal liquidity + yield:
 * - **Layer 1 (Operating):** 1 month expenses + historical minimum cushion
 * - **Layer 2 (Emergency):** 3–6 months fixed expenses → קרן כספית or short deposits
 * - **Layer 3 (Planned):** 6–24 month capital → deposit ladder or מק״מ
 *
 * Includes tax-aware yield comparison: 15% nominal (bank deposit) vs. 25% real (MMF),
 * using the break-even inflation formula from IL_FINANCE_2026.
 */

import { IL_FINANCE_2026 } from '@ak-system/types'

export interface BaselineProfile {
  fixed: number // monthly fixed expenses
  variable: number // monthly variable expenses
  minBalanceCushion: number // historical minimum balance + 10% buffer
}

export interface LiquidityPartition {
  layer1: number // operating buffer
  layer2: number // emergency fund
  layer3: number // planned money
  totalAllocated: number
  recommendation: string // Hebrew allocation guidance
}

export interface TaxYieldComparison {
  nominalDepositRate: number // input rate
  mmfRealRate: number // input rate (real, above CPI)
  projectedInflation: number // input assumption
  breakEvenInflation: number // calculated from formula
  depositNetYield: number // after 15% tax
  mmfNetYield: number // after 25% tax on real gains
  winner: 'deposit' | 'mmf' | 'neutral'
  explanation: string // Hebrew
}

export interface LiquiditySweepResult {
  partition: LiquidityPartition
  taxComparison: TaxYieldComparison
  warning: string | null
}

/**
 * Partition current balance into 3-tier liquidity structure.
 *
 * Layer 1: baseline.fixed + baseline.variable + baseline.minBalanceCushion
 * Layer 2: 3–6 months of baseline.fixed (configurable multiplier, default 4)
 * Layer 3: remainder
 */
export function partitionLiquidity(
  currentBalance: number,
  baseline: BaselineProfile,
  emergencyMonths: number = 4
): LiquidityPartition {
  const monthlyExpenses = baseline.fixed + baseline.variable

  // Layer 1: One month expenses + cushion
  const layer1 = monthlyExpenses + baseline.minBalanceCushion

  // Layer 2: Emergency fund (multiplier × fixed expenses only)
  const layer2Target = baseline.fixed * emergencyMonths
  const availableForL2 = Math.max(0, currentBalance - layer1)
  const layer2 = Math.min(layer2Target, availableForL2)

  // Layer 3: Planned money (anything above L1 + L2)
  const layer3 = Math.max(0, currentBalance - layer1 - layer2)

  let recommendation = ''
  if (currentBalance < layer1) {
    recommendation = `אזהרה: היתרה נמוכה משכבה 1 (${layer1.toFixed(0)} ₪). יש לבנות כרית תפעולית.`
  } else if (currentBalance < layer1 + layer2Target) {
    recommendation = `שכבה 1 מכוסה. יש לבנות קרן חירום: ${(layer2Target - layer2).toFixed(0)} ₪ חסרים.`
  } else {
    recommendation = `כל השכבות מכוסות. ${layer3.toFixed(0)} ₪ זמינים להקצאה ארוכת טווח.`
  }

  return {
    layer1,
    layer2,
    layer3,
    totalAllocated: layer1 + layer2 + layer3,
    recommendation,
  }
}

/**
 * Compare net yields: bank deposit (15% nominal tax) vs. money market fund (25% real tax).
 *
 * Break-even formula (from IL_FINANCE_2026):
 *   breakEvenInflation = nominalDepositRate × 0.4
 *
 * When inflation < break-even → deposit wins
 * When inflation ≥ break-even → MMF wins
 *
 * Example:
 * - Deposit offers 4% nominal
 * - Break-even = 4% × 0.4 = 1.6%
 * - If inflation is 2% → MMF wins
 * - If inflation is 1.5% → Deposit wins
 */
export function compareTaxYield(
  nominalDepositRate: number,
  mmfRealRate: number, // real return above CPI
  projectedInflation: number
): TaxYieldComparison {
  const breakEvenInflation = nominalDepositRate * IL_FINANCE_2026.breakEvenInflationFactor

  // Deposit: 15% tax on nominal interest
  const depositNetYield = nominalDepositRate * (1 - IL_FINANCE_2026.depositTaxRateNominal)

  // MMF: 25% tax on real gains (gains above inflation)
  // Total nominal return = realRate + inflation
  // Real gains = mmfRealRate
  // Tax = 25% × realRate
  // Net real = realRate × (1 - 0.25)
  // Net nominal = (realRate × 0.75) + inflation
  const mmfNetYield = mmfRealRate * (1 - IL_FINANCE_2026.mmfTaxRateReal) + projectedInflation

  let winner: 'deposit' | 'mmf' | 'neutral' = 'neutral'
  if (Math.abs(depositNetYield - mmfNetYield) < 0.001) {
    winner = 'neutral'
  } else if (depositNetYield > mmfNetYield) {
    winner = 'deposit'
  } else {
    winner = 'mmf'
  }

  let explanation = ''
  if (winner === 'deposit') {
    explanation = `בהנחת אינפלציה ${(projectedInflation * 100).toFixed(1)}% (מתחת לbreak-even ${(breakEvenInflation * 100).toFixed(1)}%), פקדון נטו: ${(depositNetYield * 100).toFixed(2)}% מנצח קרן כספית נטו: ${(mmfNetYield * 100).toFixed(2)}%.`
  } else if (winner === 'mmf') {
    explanation = `בהנחת אינפלציה ${(projectedInflation * 100).toFixed(1)}% (מעל break-even ${(breakEvenInflation * 100).toFixed(1)}%), קרן כספית נטו: ${(mmfNetYield * 100).toFixed(2)}% מנצחת פקדון נטו: ${(depositNetYield * 100).toFixed(2)}%.`
  } else {
    explanation = `שתי האפשרויות שוות (${(depositNetYield * 100).toFixed(2)}%).`
  }

  return {
    nominalDepositRate,
    mmfRealRate,
    projectedInflation,
    breakEvenInflation,
    depositNetYield,
    mmfNetYield,
    winner,
    explanation,
  }
}

/**
 * Full liquidity sweep: partition + tax comparison.
 *
 * @param currentBalance Current total liquid cash
 * @param baseline 12-month baseline profile
 * @param nominalDepositRate Bank deposit interest rate (e.g. 0.04 for 4%)
 * @param mmfRealRate MMF real return above CPI (e.g. 0.015 for 1.5%)
 * @param projectedInflation User's inflation assumption (e.g. 0.02 for 2%)
 */
export function computeLiquiditySweep(
  currentBalance: number,
  baseline: BaselineProfile,
  nominalDepositRate: number,
  mmfRealRate: number,
  projectedInflation: number
): LiquiditySweepResult {
  const partition = partitionLiquidity(currentBalance, baseline)
  const taxComparison = compareTaxYield(nominalDepositRate, mmfRealRate, projectedInflation)

  let warning: string | null = null
  if (currentBalance < baseline.minBalanceCushion) {
    warning = 'יתרה מתחת לכרית המינימום ההיסטורית'
  } else if (partition.layer1 + partition.layer2 > currentBalance) {
    warning = 'יתרה לא מכסה קרן חירום מלאה'
  }

  return {
    partition,
    taxComparison,
    warning,
  }
}

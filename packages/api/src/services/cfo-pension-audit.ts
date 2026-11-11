/**
 * Pension Audit Engine — Personal CFO Module
 *
 * Benchmarks pension/long-term savings policies against 2026 Israeli regulatory limits:
 * - Max deposit fee: 1.0%
 * - Max accumulation fee: 0.22%
 *
 * Projects lifetime fee drag using compound interest over years to retirement (age 67).
 * Flags duplicate policies and inactive accounts.
 */

import { IL_FINANCE_2026 } from '@ak-system/types'

export interface PensionPolicy {
  id: string
  provider: string
  policyType: 'pension' | 'keren_hishtalmut' | 'gemel_lehaskaa' | 'bituach_managers'
  balance: number
  depositFeePct: number
  accumFeePct: number
  monthlyDeposit: number
  retirementAge: number
  isActive: boolean
}

export interface AuditedPolicy extends PensionPolicy {
  overBenchmark: boolean
  depositFeeExcess: number
  accumFeeExcess: number
  lifetimeFeeDrag: number // projected total excess fees until retirement
  recommendation: string // Hebrew
}

export interface PensionAuditResult {
  policies: AuditedPolicy[]
  totalFeeDrag: number
  inactivePolicies: PensionPolicy[]
  duplicateWarnings: string[]
  formalLetterTemplate: string // Hebrew fee-reduction request
}

/**
 * Audit a single pension policy against benchmarks.
 *
 * Lifetime fee drag formula:
 * - Deposit fee drag = (depositFeePct - benchmark) × monthlyDeposit × 12 × yearsLeft
 * - Accum fee drag = (accumFeePct - benchmark) × balance × compound_factor(yearsLeft)
 *
 * Compound factor assumes 3% nominal annual return (conservative).
 */
export function auditPolicy(policy: PensionPolicy, currentAge: number): AuditedPolicy {
  const yearsToRetirement = Math.max(0, policy.retirementAge - currentAge)

  const depositFeeExcess = Math.max(
    0,
    policy.depositFeePct - IL_FINANCE_2026.pensionMaxDepositFeePct
  )
  const accumFeeExcess = Math.max(
    0,
    policy.accumFeePct - IL_FINANCE_2026.pensionMaxAccumFeePct
  )

  // Deposit fee drag: linear over years
  const depositFeeDrag = depositFeeExcess * policy.monthlyDeposit * 12 * yearsToRetirement

  // Accum fee drag: compound growth at 3% nominal
  const returnRate = IL_FINANCE_2026.conservativeNominalReturn
  const compoundFactor = Math.pow(1 + returnRate, yearsToRetirement)
  const accumFeeDrag = accumFeeExcess * policy.balance * compoundFactor

  const lifetimeFeeDrag = depositFeeDrag + accumFeeDrag

  const overBenchmark = depositFeeExcess > 0 || accumFeeExcess > 0

  let recommendation = ''
  if (!policy.isActive) {
    recommendation = 'חשבון לא פעיל — לשקול איחוד'
  } else if (overBenchmark) {
    recommendation = `עמלות מעל תקרה: ${lifetimeFeeDrag.toFixed(0)} ₪ עד פרישה. יש לפנות לחברה.`
  } else {
    recommendation = 'עמלות בתקן'
  }

  return {
    ...policy,
    overBenchmark,
    depositFeeExcess,
    accumFeeExcess,
    lifetimeFeeDrag,
    recommendation,
  }
}

/**
 * Run full pension audit across all policies.
 */
export function auditPensionPolicies(
  policies: PensionPolicy[],
  currentAge: number
): PensionAuditResult {
  const audited = policies.map((p) => auditPolicy(p, currentAge))
  const totalFeeDrag = audited.reduce((sum, p) => sum + p.lifetimeFeeDrag, 0)

  const inactivePolicies = policies.filter((p) => !p.isActive)

  // Detect duplicates: same policy type at same provider
  const duplicateWarnings: string[] = []
  const seen = new Set<string>()
  for (const policy of policies) {
    const key = `${policy.provider}-${policy.policyType}`
    if (seen.has(key)) {
      duplicateWarnings.push(`כפילות: ${policy.provider} - ${policy.policyType}`)
    }
    seen.add(key)
  }

  const formalLetterTemplate = generateFeeReductionLetter(audited.filter((p) => p.overBenchmark))

  return {
    policies: audited,
    totalFeeDrag,
    inactivePolicies,
    duplicateWarnings,
    formalLetterTemplate,
  }
}

/**
 * Generate formal Hebrew letter requesting fee reduction.
 */
function generateFeeReductionLetter(overBenchmarkPolicies: AuditedPolicy[]): string {
  if (overBenchmarkPolicies.length === 0) {
    return 'כל הפוליסות בתקן — אין צורך במכתב.'
  }

  const policy = overBenchmarkPolicies[0] // focus on first for template

  return `לכבוד ${policy.provider},

אני מבוטח/ת בקופתכם במסגרת ${policy.policyType === 'pension' ? 'קרן פנסיה' : policy.policyType}.

בדקתי את עמלות הניהול הנגבות ומצאתי כי הן חורגות מהתקרות הרגולטוריות לשנת 2026:
- תקרת עמלה על הפקדות: 1.0%
- תקרת עמלה על צבירה: 0.22%

עמלות הניהול הנוכחיות בפוליסה שלי:
- עמלת הפקדות: ${(policy.depositFeePct * 100).toFixed(2)}%
- עמלת צבירה: ${(policy.accumFeePct * 100).toFixed(3)}%

על פי חישוב שערכתי, גזר העמלות הגבוה צפוי לעלות לי כ-${policy.lifetimeFeeDrag.toFixed(0)} ₪ עד גיל הפרישה.

אני פונה בבקשה להתאים את העמלות לתקרות הרגולטוריות או להציע מסלול חלופי בעמלות נמוכות יותר.

אודה על טיפולכם המהיר בעניין.

בכבוד רב`
}

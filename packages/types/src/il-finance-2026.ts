/**
 * Israeli Financial Regulation Constants — 2026 Benchmarks
 *
 * Centralized source of truth for Israeli financial thresholds, tax rates, and
 * regulatory benchmarks used by the Personal CFO module engines.
 *
 * These constants are hardcoded for 2026 and should be manually updated annually
 * based on regulatory changes from:
 * - Ministry of Finance (מִשְׂרַד הָאוֹצָר)
 * - Israel Tax Authority (רשות המסים)
 * - Capital Market, Insurance and Savings Authority (הרשות לשווקי הון)
 */

export const IL_FINANCE_2026 = {
  /**
   * Pension & Long-Term Savings Benchmarks
   * Source: Capital Market Authority regulations, effective Jan 2026
   */

  /** Maximum management fee on pension deposits (1.0%) */
  pensionMaxDepositFeePct: 0.01,

  /** Maximum management fee on accumulated pension balance (0.22%) */
  pensionMaxAccumFeePct: 0.0022,

  /** Keren Hishtalmut tax-exempt salary ceiling (₪/month) */
  kerenHishtalmutCeiling: 15712,

  /** Gemel LeHaskaa annual deposit ceiling (₪/year) */
  gemelLeHaskaaAnnualCeiling: 83641,

  /**
   * Taxation Constants
   */

  /** Tax rate on bank deposit interest (nominal, 15%) */
  depositTaxRateNominal: 0.15,

  /** Tax rate on money market fund gains (real gains above CPI, 25%) */
  mmfTaxRateReal: 0.25,

  /**
   * Break-even inflation factor for deposit vs MMF comparison.
   *
   * Formula: breakEvenInflation = nominalDepositRate × 0.4
   *
   * When projected inflation < breakEvenInflation → bank deposit is preferable.
   * When projected inflation ≥ breakEvenInflation → money market fund (קרן כספית) is preferable.
   *
   * Example:
   * - Deposit offers 4% nominal → break-even = 1.6%
   * - If inflation forecast is 2% → MMF wins
   * - If inflation forecast is 1.5% → Deposit wins
   */
  breakEvenInflationFactor: 0.4,

  /**
   * Default Assumptions for Long-Term Projections
   */

  /** Standard retirement age for pension calculations */
  defaultRetirementAge: 67,

  /** Conservative nominal return assumption for pension growth projections (3% annually) */
  conservativeNominalReturn: 0.03,
} as const

/**
 * Human-readable labels for policy types (Hebrew)
 */
export const PENSION_POLICY_TYPE_LABELS = {
  pension: 'קרן פנסיה',
  keren_hishtalmut: 'קרן השתלמות',
  gemel_lehaskaa: 'גמל להשקעה',
  bituach_managers: 'ביטוח מנהלים',
} as const

/**
 * Debt type labels (Hebrew)
 */
export const DEBT_TYPE_LABELS = {
  overdraft: 'משיכת יתר',
  credit_loan: 'הלוואת צריכה',
  installment: 'תשלומים',
} as const

/**
 * Liquidity layer descriptions (Hebrew)
 */
export const LIQUIDITY_LAYER_LABELS = {
  layer1: 'שכבה 1: מזומנים תפעוליים',
  layer2: 'שכבה 2: קרן חירום',
  layer3: 'שכבה 3: כסף מתוכנן',
} as const

/**
 * Leak action type labels (Hebrew)
 */
export const LEAK_ACTION_LABELS = {
  KEEP: 'להשאיר',
  CANCEL: 'לבטל',
  RENEGOTIATE: 'לנהל מחדש',
} as const

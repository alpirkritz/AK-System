/**
 * PII Sanitizer — Stage 0 of Personal CFO Module
 *
 * Strips Israeli ID numbers (ת.ז.), credit card numbers, IBANs, and bank account numbers
 * from text before any LLM processing. Follows the critical security principle: **never**
 * expose personally identifiable information to external APIs.
 *
 * Also provides deduplication logic to remove aggregate credit card charges from bank
 * statements when they match itemized credit card transactions, preventing double-counting.
 */

/** Israeli ID (ת.ז.) — 9 digits, optionally with dashes/spaces */
const ISRAELI_ID_PATTERN = /\b\d{1,3}[-\s]?\d{2}[-\s]?\d{4}\b/g

/** Credit card — 13-19 digits, optionally with spaces/dashes, basic Luhn validation */
const CREDIT_CARD_PATTERN = /\b(?:\d{4}[-\s]?){3}\d{1,7}\b/g

/** Israeli IBAN — IL followed by 21 digits (2 check + 19 account) */
const ISRAELI_IBAN_PATTERN = /\bIL\d{21}\b/gi

/** Generic bank account number — 6-12 digits (common Israeli range) */
const BANK_ACCOUNT_PATTERN = /\b\d{6,12}\b/g

const REDACTED = '[REDACTED]'

/**
 * Luhn algorithm check — validates credit card numbers.
 * Returns true if the number passes Luhn validation.
 */
function isValidLuhn(cardNumber: string): boolean {
  const digits = cardNumber.replace(/\D/g, '')
  if (digits.length < 13 || digits.length > 19) return false

  let sum = 0
  let isSecond = false

  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = parseInt(digits[i], 10)

    if (isSecond) {
      digit *= 2
      if (digit > 9) digit -= 9
    }

    sum += digit
    isSecond = !isSecond
  }

  return sum % 10 === 0
}

export interface SanitizeResult {
  /** Sanitized text with PII redacted */
  sanitized: string
  /** Number of distinct PII instances redacted */
  redactedCount: number
  /** Breakdown by type */
  breakdown: {
    israeliIds: number
    creditCards: number
    ibans: number
    accountNumbers: number
  }
}

/**
 * Sanitize text by redacting Israeli IDs, credit cards, IBANs, and account numbers.
 *
 * Order matters: more specific patterns (IBAN, credit card with Luhn) are checked first,
 * then generic account numbers last to avoid false positives.
 */
export function sanitizePii(text: string): SanitizeResult {
  let sanitized = text
  const breakdown = {
    israeliIds: 0,
    creditCards: 0,
    ibans: 0,
    accountNumbers: 0,
  }

  // 1. Israeli IDs (9 digits with optional separators)
  const idMatches = Array.from(sanitized.matchAll(ISRAELI_ID_PATTERN))
  for (const match of idMatches) {
    sanitized = sanitized.replace(match[0], REDACTED)
    breakdown.israeliIds++
  }

  // 2. IBANs (IL + 21 digits)
  const ibanMatches = Array.from(sanitized.matchAll(ISRAELI_IBAN_PATTERN))
  for (const match of ibanMatches) {
    sanitized = sanitized.replace(match[0], REDACTED)
    breakdown.ibans++
  }

  // 3. Credit cards (13-19 digits with Luhn validation)
  const cardMatches = Array.from(sanitized.matchAll(CREDIT_CARD_PATTERN))
  for (const match of cardMatches) {
    if (isValidLuhn(match[0])) {
      sanitized = sanitized.replace(match[0], REDACTED)
      breakdown.creditCards++
    }
  }

  // 4. Generic bank account numbers (6-12 digits)
  // Applied last to avoid redacting legitimate numbers (amounts, dates, etc.)
  // Only redacts if preceded by keywords like "account" / "חשבון"
  const accountPattern = /(?:account|חשבון|מס[׳']?\s*חשבון)[\s:]*(\d{6,12})/gi
  const accountMatches = Array.from(sanitized.matchAll(accountPattern))
  for (const match of accountMatches) {
    const fullMatch = match[0]
    const numberPart = match[1]
    sanitized = sanitized.replace(numberPart, REDACTED)
    breakdown.accountNumbers++
  }

  const redactedCount = Object.values(breakdown).reduce((sum, count) => sum + count, 0)

  return {
    sanitized,
    redactedCount,
    breakdown,
  }
}

/**
 * Transaction deduplication: Remove aggregate credit card charge from bank statement
 * if it matches the sum of itemized card transactions (within ±5% tolerance).
 *
 * Typical scenario:
 * - Bank account shows one lump sum: "חיוב כרטיס אשראי: 5,432 ₪"
 * - Credit card connection shows 47 itemized transactions totaling 5,421 ₪
 * - The bank charge should be removed to avoid double-counting.
 */
export interface Transaction {
  id: string
  amount: number // positive for all, direction field determines income/expense
  description: string
  transactionDate: string
  source: string // 'hapoalim' | 'visaCal' | 'isracard' | etc.
  direction: 'income' | 'expense'
}

export interface DedupeResult {
  /** Transactions after deduplication */
  transactions: Transaction[]
  /** IDs of aggregate charges that were removed */
  removedAggregateIds: string[]
  /** Explanation of each dedup match */
  dedupLog: string[]
}

/**
 * Deduplicate aggregate credit card charges against itemized card transactions.
 *
 * Algorithm:
 * 1. Identify bank transactions with "כרטיס אשראי" / "credit card" in description
 * 2. For each, find all card transactions from same month with matching total (±5%)
 * 3. Remove the aggregate charge, keep the itemized transactions
 */
export function deduplicateAggregateCharges(transactions: Transaction[]): DedupeResult {
  const result: Transaction[] = []
  const removedAggregateIds: string[] = []
  const dedupLog: string[] = []

  // Separate bank aggregates and card transactions
  const aggregateCandidates = transactions.filter(
    (t) =>
      (t.source === 'hapoalim' || t.source === 'otsarHahayal' || t.source.includes('bank')) &&
      (t.description.includes('כרטיס אשראי') ||
        t.description.toLowerCase().includes('credit card') ||
        t.description.includes('ויזה') ||
        t.description.includes('מאסטרקארד'))
  )

  const cardTransactions = transactions.filter(
    (t) => t.source === 'visaCal' || t.source === 'isracard' || t.source.includes('card')
  )

  for (const aggregate of aggregateCandidates) {
    const aggregateMonth = aggregate.transactionDate.substring(0, 7) // YYYY-MM

    // Find all card transactions from the same month
    const monthCardTxns = cardTransactions.filter(
      (t) => t.transactionDate.substring(0, 7) === aggregateMonth && t.direction === aggregate.direction
    )

    if (monthCardTxns.length === 0) {
      result.push(aggregate)
      continue
    }

    const cardSum = monthCardTxns.reduce((sum, t) => sum + t.amount, 0)
    const tolerance = aggregate.amount * 0.05 // ±5%

    if (Math.abs(cardSum - aggregate.amount) <= tolerance) {
      // Match found — remove aggregate, keep itemized
      removedAggregateIds.push(aggregate.id)
      dedupLog.push(
        `Removed aggregate charge ${aggregate.id} (${aggregate.amount} ₪) — matched ${monthCardTxns.length} card transactions totaling ${cardSum} ₪`
      )
    } else {
      result.push(aggregate)
    }
  }

  // Add all non-aggregate transactions
  const nonAggregates = transactions.filter((t) => !aggregateCandidates.includes(t))
  result.push(...nonAggregates)

  return {
    transactions: result,
    removedAggregateIds,
    dedupLog,
  }
}

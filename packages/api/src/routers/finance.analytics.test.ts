import { describe, it, expect, beforeEach } from 'vitest'
import { getTestDb, createTestCaller } from '../test-utils'
import {
  financeTransactions,
  financeCategoryRules,
  bankAccounts,
  bankConnections,
  queryRows,
  eq,
} from '@ak-system/database'

function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

/** Anchor fixtures to the real clock: the procedures window on "now". */
const NOW = new Date()
const THIS_MONTH = monthKey(NOW)

function isoInMonthsAgo(monthsAgo: number, day = 5): string {
  return new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - monthsAgo, day)).toISOString()
}

let seq = 0
async function insertTxn(over: {
  amount: number
  direction?: 'income' | 'expense'
  category?: string | null
  description?: string
  transactionDate: string
}) {
  const db = getTestDb()
  await db.insert(financeTransactions).values({
    id: `fxt${seq++}`,
    amount: String(over.amount),
    currency: 'ILS',
    direction: over.direction ?? 'expense',
    category: over.category === undefined ? 'מזון' : over.category,
    description: over.description ?? 'סופר יוחננוף',
    transactionDate: over.transactionDate,
    source: 'bank_scrape',
    rawData: null,
    bankAccountId: null,
    dedupeKey: `dk${seq}`,
    installmentInfo: null,
    txnStatus: 'completed',
    createdAt: new Date().toISOString(),
  })
}

async function reset() {
  const db = getTestDb()
  await db.delete(financeTransactions)
  await db.delete(financeCategoryRules)
  await db.delete(bankAccounts)
  await db.delete(bankConnections)
}

describe('finance.analytics router', () => {
  beforeEach(reset)

  describe('monthlyTrend', () => {
    it('returns exactly the requested number of months, oldest first', async () => {
      const caller = await createTestCaller()
      const result = await caller.finance.analytics.monthlyTrend({ months: 6 })
      expect(result.months).toHaveLength(6)
      expect(result.months[0].month < result.months[5].month).toBe(true)
      expect(result.months[5].month).toBe(THIS_MONTH)
      expect(result.currency).toBe('ILS')
    })

    it('aggregates income and expense for the current month', async () => {
      await insertTxn({ amount: 1000, transactionDate: isoInMonthsAgo(0) })
      await insertTxn({
        amount: 5000,
        direction: 'income',
        category: 'משכורת',
        transactionDate: isoInMonthsAgo(0),
      })

      const caller = await createTestCaller()
      const result = await caller.finance.analytics.monthlyTrend({ months: 3 })
      const current = result.months.find((m) => m.month === THIS_MONTH)!
      expect(current.expense).toBe(1000)
      expect(current.income).toBe(5000)
      expect(current.net).toBe(4000)
    })

    it('agrees with getSummary for the current month once internal money is excluded', async () => {
      await insertTxn({ amount: 700, transactionDate: isoInMonthsAgo(0) })
      await insertTxn({
        amount: 4000,
        direction: 'income',
        category: 'משכורת',
        transactionDate: isoInMonthsAgo(0),
      })

      const caller = await createTestCaller()
      const [trend, summary] = await Promise.all([
        caller.finance.analytics.monthlyTrend({ months: 3 }),
        caller.finance.getSummary(),
      ])
      const current = trend.months.find((m) => m.month === THIS_MONTH)!
      expect(current.expense).toBe(summary.monthlyExpenses)
      expect(current.income).toBe(summary.monthlyIncome)
    })

    it('excludes internal categories from the totals', async () => {
      await insertTxn({ amount: 9000, category: 'כרטיס אשראי', transactionDate: isoInMonthsAgo(0) })
      await insertTxn({ amount: 100, category: 'מזון', transactionDate: isoInMonthsAgo(0) })

      const caller = await createTestCaller()
      const result = await caller.finance.analytics.monthlyTrend({ months: 3 })
      expect(result.months.find((m) => m.month === THIS_MONTH)!.expense).toBe(100)
    })
  })

  describe('categoryBreakdown', () => {
    it('returns per-category totals with the trailing comparison', async () => {
      await insertTxn({ amount: 900, category: 'מזון', transactionDate: isoInMonthsAgo(0) })
      for (const monthsAgo of [1, 2, 3]) {
        await insertTxn({ amount: 300, category: 'מזון', transactionDate: isoInMonthsAgo(monthsAgo) })
      }

      const caller = await createTestCaller()
      const result = await caller.finance.analytics.categoryBreakdown({
        month: THIS_MONTH,
        direction: 'expense',
      })
      expect(result.total).toBe(900)
      const food = result.items.find((i) => i.category === 'מזון')!
      expect(food.trailingAvg).toBe(300)
      expect(food.deltaPct).toBe(200)
    })

    it('rejects a malformed month', async () => {
      const caller = await createTestCaller()
      await expect(
        caller.finance.analytics.categoryBreakdown({ month: '2026/08', direction: 'expense' })
      ).rejects.toThrow()
    })
  })

  describe('recurring', () => {
    it('detects a monthly charge and annualizes it', async () => {
      for (const monthsAgo of [0, 1, 2, 3]) {
        await insertTxn({
          amount: 50,
          category: 'מנויים',
          description: 'נטפליקס',
          transactionDate: isoInMonthsAgo(monthsAgo),
        })
      }

      const caller = await createTestCaller()
      const result = await caller.finance.analytics.recurring({ minOccurrences: 3, lookbackMonths: 12 })
      const netflix = result.items.find((i) => i.label.includes('נטפליקס'))!
      expect(netflix.occurrences).toBe(4)
      expect(netflix.cadence).toBe('monthly')
      expect(netflix.annualizedCost).toBe(600)
      expect(result.monthlyFixedTotal).toBe(50)
    })
  })

  describe('coverage', () => {
    it('counts uncategorized rows and their share of expense value', async () => {
      await insertTxn({ amount: 300, category: null, transactionDate: isoInMonthsAgo(0) })
      await insertTxn({ amount: 100, category: 'מזון', transactionDate: isoInMonthsAgo(0) })

      const caller = await createTestCaller()
      const result = await caller.finance.analytics.coverage()
      expect(result.uncategorizedCount).toBe(1)
      expect(result.uncategorizedExpenseValue).toBe(300)
      expect(result.uncategorizedShare).toBe(75)
      expect(result.totalTransactions).toBe(2)
    })

    it('detects the credit-card blind spot before any categorization has run', async () => {
      await insertTxn({
        amount: 5000,
        category: null,
        description: 'כרטיס אשראי ויזה',
        transactionDate: isoInMonthsAgo(0),
      })
      await insertTxn({ amount: 5000, category: null, description: 'סופר', transactionDate: isoInMonthsAgo(0) })

      const caller = await createTestCaller()
      const result = await caller.finance.analytics.coverage()
      expect(result.creditCardConnected).toBe(false)
      expect(result.hiddenCardValue).toBe(5000)
      expect(result.hiddenCardShare).toBe(50)
    })

    it('reports zeros on an empty ledger instead of dividing by zero', async () => {
      const caller = await createTestCaller()
      const result = await caller.finance.analytics.coverage()
      expect(result.uncategorizedShare).toBe(0)
      expect(result.hiddenCardShare).toBe(0)
      expect(result.totalTransactions).toBe(0)
    })
  })

  describe('categorizeBacklog', () => {
    it('categorizes every uncategorized row and reports the tally', async () => {
      await insertTxn({ amount: 100, category: null, description: 'סופר יוחננוף', transactionDate: isoInMonthsAgo(0) })
      await insertTxn({ amount: 50, category: null, description: 'נטפליקס', transactionDate: isoInMonthsAgo(0) })

      const caller = await createTestCaller()
      const result = await caller.finance.categorizeBacklog({ dryRun: false })
      expect(result.updated).toBe(2)
      expect(result.remaining).toBe(0)
      expect(result.byCategory['מזון']).toBe(1)
      expect(result.byCategory['מנויים']).toBe(1)

      const after = await caller.finance.analytics.coverage()
      expect(after.uncategorizedCount).toBe(0)
    })

    it('dryRun changes nothing', async () => {
      await insertTxn({ amount: 100, category: null, transactionDate: isoInMonthsAgo(0) })

      const caller = await createTestCaller()
      const result = await caller.finance.categorizeBacklog({ dryRun: true })
      expect(result.updated).toBe(1)
      expect(result.remaining).toBe(1)

      const after = await caller.finance.analytics.coverage()
      expect(after.uncategorizedCount).toBe(1)
    })

    it('leaves already-categorized rows untouched', async () => {
      await insertTxn({ amount: 100, category: 'ביטוח', description: 'סופר יוחננוף', transactionDate: isoInMonthsAgo(0) })

      const caller = await createTestCaller()
      const result = await caller.finance.categorizeBacklog({ dryRun: false })
      expect(result.updated).toBe(0)

      const db = getTestDb()
      const rows = await queryRows(db.select().from(financeTransactions))
      expect(rows[0].category).toBe('ביטוח')
    })

    it('applies a learned rule ahead of the built-in keywords', async () => {
      const db = getTestDb()
      await db.insert(financeCategoryRules).values({
        id: 'rule-1',
        pattern: 'סופר יוחננוף',
        category: 'אוכל בחוץ',
        direction: 'expense',
        createdBy: 'user',
        createdAt: new Date().toISOString(),
      })
      await insertTxn({ amount: 100, category: null, description: 'סופר יוחננוף', transactionDate: isoInMonthsAgo(0) })

      const caller = await createTestCaller()
      const result = await caller.finance.categorizeBacklog({ dryRun: false })
      expect(result.byCategory['אוכל בחוץ']).toBe(1)
    })
  })

  describe('setTransactionCategory', () => {
    it('updates one transaction and creates no rule by default', async () => {
      await insertTxn({ amount: 100, category: null, transactionDate: isoInMonthsAgo(0) })
      const db = getTestDb()
      const [row] = await queryRows(db.select().from(financeTransactions))

      const caller = await createTestCaller()
      const result = await caller.finance.setTransactionCategory({ id: row.id, category: 'רכב' })
      expect(result).toEqual({ updated: 1, ruleCreated: false })

      const rules = await caller.finance.analytics.listCategoryRules()
      expect(rules.rules).toHaveLength(0)
    })

    it('applyToSimilar learns a rule and back-fills matching transactions', async () => {
      await insertTxn({ amount: 100, category: null, description: 'קפה נמרוד סניף 1', transactionDate: isoInMonthsAgo(0) })
      await insertTxn({ amount: 120, category: null, description: 'קפה נמרוד סניף 2', transactionDate: isoInMonthsAgo(1) })
      const db = getTestDb()
      const rows = await queryRows(db.select().from(financeTransactions))

      const caller = await createTestCaller()
      const result = await caller.finance.setTransactionCategory({
        id: rows[0].id,
        category: 'אוכל בחוץ',
        applyToSimilar: true,
      })
      expect(result.ruleCreated).toBe(true)
      expect(result.updated).toBe(2)

      const after = await queryRows(db.select().from(financeTransactions))
      expect(after.every((r) => r.category === 'אוכל בחוץ')).toBe(true)

      const rules = await caller.finance.analytics.listCategoryRules()
      expect(rules.rules).toHaveLength(1)
      expect(rules.rules[0].category).toBe('אוכל בחוץ')
    })

    it('does not spill a learned rule across directions', async () => {
      await insertTxn({ amount: 100, category: null, description: 'העברה דנה', transactionDate: isoInMonthsAgo(0) })
      await insertTxn({
        amount: 100,
        direction: 'income',
        category: null,
        description: 'העברה דנה',
        transactionDate: isoInMonthsAgo(0),
      })
      const db = getTestDb()
      const expense = (await queryRows(
        db.select().from(financeTransactions).where(eq(financeTransactions.direction, 'expense'))
      ))[0]

      const caller = await createTestCaller()
      const result = await caller.finance.setTransactionCategory({
        id: expense.id,
        category: 'העברות',
        applyToSimilar: true,
      })
      expect(result.updated).toBe(1)

      const income = (await queryRows(
        db.select().from(financeTransactions).where(eq(financeTransactions.direction, 'income'))
      ))[0]
      expect(income.category).toBeNull()
    })

    it('rejects an unknown transaction id', async () => {
      const caller = await createTestCaller()
      await expect(
        caller.finance.setTransactionCategory({ id: 'nope', category: 'מזון' })
      ).rejects.toThrow()
    })
  })

  describe('deleteCategoryRule', () => {
    it('removing a rule keeps transactions it already categorized', async () => {
      await insertTxn({ amount: 100, category: null, description: 'קפה נמרוד', transactionDate: isoInMonthsAgo(0) })
      const db = getTestDb()
      const [row] = await queryRows(db.select().from(financeTransactions))

      const caller = await createTestCaller()
      await caller.finance.setTransactionCategory({
        id: row.id,
        category: 'אוכל בחוץ',
        applyToSimilar: true,
      })
      const { rules } = await caller.finance.analytics.listCategoryRules()
      await caller.finance.analytics.deleteCategoryRule({ id: rules[0].id })

      expect((await caller.finance.analytics.listCategoryRules()).rules).toHaveLength(0)
      const after = await queryRows(db.select().from(financeTransactions))
      expect(after[0].category).toBe('אוכל בחוץ')
    })
  })

  describe('insights', () => {
    it('returns an overspend insight with a shekel figure', async () => {
      await insertTxn({ amount: 900, category: 'אוכל בחוץ', transactionDate: isoInMonthsAgo(0) })
      for (const monthsAgo of [1, 2, 3]) {
        await insertTxn({ amount: 200, category: 'אוכל בחוץ', transactionDate: isoInMonthsAgo(monthsAgo) })
      }

      const caller = await createTestCaller()
      const { insights } = await caller.finance.analytics.insights({ month: THIS_MONTH })
      const overspend = insights.find((i) => i.kind === 'overspend')
      expect(overspend).toBeDefined()
      expect(overspend!.category).toBe('אוכל בחוץ')
      expect(`${overspend!.title} ${overspend!.body}`).toMatch(/\d/)
    })

    it('returns no insights for an empty ledger rather than failing', async () => {
      const caller = await createTestCaller()
      const { insights } = await caller.finance.analytics.insights({ month: THIS_MONTH })
      expect(insights).toEqual([])
    })

    it('never returns data-quality kinds', async () => {
      await insertTxn({ amount: 5000, category: null, transactionDate: isoInMonthsAgo(0) })
      const caller = await createTestCaller()
      const { insights } = await caller.finance.analytics.insights({ month: THIS_MONTH })
      expect(insights.map((i) => i.kind)).not.toContain('coverage')
    })
  })

  describe('listTransactions', () => {
    it('uncategorized filter returns only rows with no category', async () => {
      await insertTxn({ amount: 100, category: null, transactionDate: isoInMonthsAgo(0) })
      await insertTxn({ amount: 100, category: 'מזון', transactionDate: isoInMonthsAgo(0) })

      const caller = await createTestCaller()
      const rows = await caller.finance.listTransactions({ uncategorized: true, limit: 50 })
      expect(rows).toHaveLength(1)
      expect(rows[0].category).toBeNull()
    })

    it('combines filters instead of keeping only the last one', async () => {
      await insertTxn({ amount: 100, category: 'מזון', transactionDate: isoInMonthsAgo(0) })
      await insertTxn({
        amount: 100,
        direction: 'income',
        category: 'מזון',
        transactionDate: isoInMonthsAgo(0),
      })

      const caller = await createTestCaller()
      const rows = await caller.finance.listTransactions({
        direction: 'expense',
        category: 'מזון',
        limit: 50,
      })
      expect(rows).toHaveLength(1)
      expect(rows[0].direction).toBe('expense')
    })
  })
})

import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import {
  financeTrades,
  financeTransactions,
  agentTriggers,
  bankConnections,
  bankAccounts,
  financeCategoryRules,
  queryRows,
  type BankConnection,
  type BankAccount,
  type FinanceCategoryRule,
} from '@ak-system/database'
import { eq, desc, gte, and, like, sql, count, sum, isNull } from 'drizzle-orm'
import { listIBKREmails } from '../services/ibkr-parser'
import { importIBKREmails } from '../services/ibkr-import-service'
import { importIBKRFromNotion, isNotionIbkrConfigured } from '../services/notion-ibkr-import'
import { computeFifoPnl, type TradeInput } from '../services/pnl'
import { parseCSV } from '../services/csv-parser'
import { extractTextFromPdf, parsePdfStatementText } from '../services/pdf-parser'
import { encryptCredentials, isBankCryptoConfigured } from '../lib/bank-credentials-crypto'
import { syncConnection, syncAllConnections } from '../services/bank-sync-service'
import {
  buildMonthlyTrend,
  buildCategoryBreakdown,
  detectRecurring,
  computeInsights,
  type AnalyticsTxn,
} from '../services/cashflow-analytics'
import {
  categorizeByKeywords,
  categorizeTransaction,
  suggestRulePattern,
  type CategoryRule,
} from '../services/transaction-categorizer'

type JournalPeriod = 'today' | 'week' | 'month' | 'all'

/** Inclusive lower-bound ISO timestamp for a journal period (empty = all-time). */
function periodSince(period: JournalPeriod): string {
  const now = new Date()
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  if (period === 'week') {
    const d = new Date(now)
    d.setDate(d.getDate() - 7)
    return d.toISOString()
  }
  if (period === 'month') return new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
  return ''
}

function toTradeInputs(
  rows: Array<{
    id: string
    symbol: string
    direction: string
    quantity: string
    price: string
    commission: string | null
    tradeDate: string
  }>,
): TradeInput[] {
  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    direction: r.direction === 'buy' ? 'buy' : 'sell',
    quantity: parseFloat(r.quantity) || 0,
    price: parseFloat(r.price) || 0,
    commission: r.commission ? parseFloat(r.commission) || 0 : 0,
    tradeDate: r.tradeDate,
  }))
}

const idInput = z.object({ id: z.string().min(1) })

/** First day of the month `months - 1` back, as an ISO timestamp for a date lower bound. */
function analyticsWindowStart(months: number): string {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1)).toISOString()
}

/**
 * Load the raw rows the analytics service aggregates over.
 *
 * Aggregation happens in memory rather than SQL: the volume is a few hundred rows per
 * year, the logic (trailing averages, cadence medians, insight rules) is far clearer as
 * pure TypeScript, and it stays identical across the SQLite and Postgres drivers.
 */
async function loadAnalyticsTxns(
  ctx: { db: any },
  months: number
): Promise<AnalyticsTxn[]> {
  const rows = (await queryRows(
    ctx.db
      .select({
        amount: financeTransactions.amount,
        direction: financeTransactions.direction,
        category: financeTransactions.category,
        description: financeTransactions.description,
        transactionDate: financeTransactions.transactionDate,
      })
      .from(financeTransactions)
      .where(gte(financeTransactions.transactionDate, analyticsWindowStart(months)))
  )) as Array<{
    amount: string
    direction: string
    category: string | null
    description: string | null
    transactionDate: string
  }>

  return rows.map((r) => ({
    amount: Number(r.amount) || 0,
    direction: r.direction === 'income' ? 'income' : 'expense',
    category: r.category,
    description: r.description,
    transactionDate: r.transactionDate,
  }))
}

async function loadCategoryRules(ctx: { db: any }): Promise<CategoryRule[]> {
  const rules = (await queryRows(
    ctx.db.select().from(financeCategoryRules)
  )) as FinanceCategoryRule[]
  return rules.map((r) => ({
    pattern: r.pattern,
    category: r.category,
    direction: r.direction === 'income' || r.direction === 'expense' ? r.direction : null,
  }))
}

export const financeRouter = router({
  // ─── IBKR Trades ─────────────────────────────────────────────────────────

  /** מחזיר רשימת מיילים מ-IBKR (לאבחון) — בלי שמירה לDB */
  listIBKREmails: protectedProcedure
    .input(z.object({ max: z.number().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      return listIBKREmails(input.max)
    }),

  /** אבחון מלא — מחפש בצורה רחבה ומחזיר גוף ראשון */
  gmailDebug: protectedProcedure
    .input(z.object({ query: z.string().default('interactivebrokers') }))
    .query(async ({ input }) => {
      const { searchGmailMessages } = await import('../services/gmail')
      const msgs = await searchGmailMessages(input.query, 5)
      return msgs.map((m) => ({
        id: m.id,
        from: m.from,
        subject: m.subject,
        date: m.date,
        bodySnippet: m.body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 400),
      }))
    }),

  syncIBKREmails: protectedProcedure
    .input(z.object({ maxEmails: z.number().min(1).max(500).default(100) }))
    .mutation(async ({ ctx, input }) => {
      return importIBKREmails({ maxEmails: input.maxEmails }, ctx.db)
    }),

  /** האם מוגדר בסיס נתונים של IBKR ב-Notion (לכפתור ייבוא היסטוריה) */
  notionIbkrConfigured: protectedProcedure.query(() => {
    return { configured: isNotionIbkrConfigured() }
  }),

  /** ייבוא חד-פעמי של היסטוריית עסקאות מ-Notion → finance_trades (עם dedupe) */
  importFromNotion: protectedProcedure
    .input(z.object({ dryRun: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      return importIBKRFromNotion({ dryRun: input.dryRun }, ctx.db)
    }),

  listTrades: protectedProcedure
    .input(
      z.object({
        symbol: z.string().optional(),
        direction: z.enum(['buy', 'sell']).optional(),
        since: z.string().optional(),
        limit: z.number().min(1).max(500).default(200),
      })
    )
    .query(async ({ ctx, input }) => {
      let rows = ctx.db.select().from(financeTrades).$dynamic()

      if (input.symbol) {
        rows = rows.where(like(financeTrades.symbol, `%${input.symbol.toUpperCase()}%`))
      }
      if (input.direction) {
        rows = rows.where(eq(financeTrades.direction, input.direction))
      }
      if (input.since) {
        rows = rows.where(gte(financeTrades.tradeDate, input.since))
      }

      return rows.orderBy(desc(financeTrades.tradeDate)).limit(input.limit)
    }),

  deleteTrade: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(financeTrades).where(eq(financeTrades.id, input.id))
    return { ok: true }
  }),

  // ─── Expenses / Income ────────────────────────────────────────────────────

  importCSV: protectedProcedure
    .input(z.object({ csvContent: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = parseCSV(input.csvContent)
      let inserted = 0

      for (const tx of result.transactions) {
        const id = 'fx' + Date.now() + Math.random().toString(36).slice(2, 7)
        await ctx.db.insert(financeTransactions).values({
          id,
          amount: String(tx.amount),
          currency: tx.currency,
          direction: tx.direction,
          category: tx.category,
          description: tx.description,
          transactionDate: tx.transactionDate,
          source: 'csv_import',
          rawData: tx.rawData,
          createdAt: new Date().toISOString(),
        })
        inserted++
      }

      return {
        inserted,
        skipped: result.skipped,
        detectedFormat: result.detectedFormat,
        total: result.transactions.length + result.skipped,
      }
    }),

  /** ייבוא קובץ PDF (למשל דוח ויזה כאל) — מחלץ טקסט ואז מפרסר כ-CSV או שורות ויזה כאל */
  importPDF: protectedProcedure
    .input(z.object({ pdfBase64: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.pdfBase64, 'base64')
      const text = await extractTextFromPdf(buffer)
      if (!text) {
        return {
          inserted: 0,
          skipped: 0,
          detectedFormat: 'PDF (לא נמצא טקסט)',
          total: 0,
        }
      }
      const result = parsePdfStatementText(text)
      let inserted = 0
      for (const tx of result.transactions) {
        const id = 'fx' + Date.now() + Math.random().toString(36).slice(2, 7)
        await ctx.db.insert(financeTransactions).values({
          id,
          amount: String(tx.amount),
          currency: tx.currency,
          direction: tx.direction,
          category: tx.category,
          description: tx.description,
          transactionDate: tx.transactionDate,
          source: 'csv_import',
          rawData: tx.rawData,
          createdAt: new Date().toISOString(),
        })
        inserted++
      }
      return {
        inserted,
        skipped: result.skipped,
        detectedFormat: result.detectedFormat,
        total: result.transactions.length + result.skipped,
      }
    }),

  createTransaction: protectedProcedure
    .input(
      z.object({
        amount: z.number().positive(),
        currency: z.string().default('ILS'),
        direction: z.enum(['income', 'expense']),
        category: z.string().default('אחר'),
        description: z.string().min(1),
        transactionDate: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = 'fx' + Date.now() + Math.random().toString(36).slice(2, 7)
      const date = new Date(input.transactionDate)
      const transactionDate = Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
      await ctx.db.insert(financeTransactions).values({
        id,
        amount: String(input.amount),
        currency: input.currency,
        direction: input.direction,
        category: input.category,
        description: input.description,
        transactionDate,
        source: 'manual',
        rawData: null,
        createdAt: new Date().toISOString(),
      })
      const [row] = await ctx.db
        .select()
        .from(financeTransactions)
        .where(eq(financeTransactions.id, id))
      return row!
    }),

  listTransactions: protectedProcedure
    .input(
      z.object({
        direction: z.enum(['income', 'expense']).optional(),
        category: z.string().optional(),
        since: z.string().optional(),
        uncategorized: z.boolean().optional(),
        limit: z.number().min(1).max(500).default(200),
      })
    )
    .query(async ({ ctx, input }) => {
      // Conditions are combined with and(): chained .where() calls replace each other in
      // Drizzle, so filtering by more than one field silently kept only the last.
      const conditions = [
        input.direction ? eq(financeTransactions.direction, input.direction) : undefined,
        input.category ? eq(financeTransactions.category, input.category) : undefined,
        input.since ? gte(financeTransactions.transactionDate, input.since) : undefined,
        input.uncategorized ? isNull(financeTransactions.category) : undefined,
      ].filter(Boolean)

      let rows = ctx.db.select().from(financeTransactions).$dynamic()
      if (conditions.length > 0) {
        rows = rows.where(conditions.length === 1 ? conditions[0] : and(...conditions))
      }

      return rows.orderBy(desc(financeTransactions.transactionDate)).limit(input.limit)
    }),

  deleteTransaction: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(financeTransactions).where(eq(financeTransactions.id, input.id))
    return { ok: true }
  }),

  // ─── Bank & credit card connections (israeli-bank-scrapers) ─────────────

  bankConnections: router({
    /** All connections + their accounts. NEVER returns credential fields. */
    list: protectedProcedure.query(async ({ ctx }) => {
      const connections = (await queryRows(
        ctx.db.select().from(bankConnections).orderBy(desc(bankConnections.createdAt)),
      )) as BankConnection[]
      const accounts = (await queryRows(ctx.db.select().from(bankAccounts))) as BankAccount[]
      return connections.map((c) => ({
        id: c.id,
        provider: c.provider,
        displayName: c.displayName,
        status: c.status,
        lastSyncAt: c.lastSyncAt,
        lastError: c.lastError,
        lastErrorType: c.lastErrorType,
        createdAt: c.createdAt,
        accounts: accounts.filter((a) => a.connectionId === c.id),
      }))
    }),

    cryptoConfigured: protectedProcedure.query(() => ({
      configured: isBankCryptoConfigured(),
    })),

    create: protectedProcedure
      .input(
        z.discriminatedUnion('provider', [
          z.object({
            provider: z.literal('hapoalim'),
            displayName: z.string().min(1),
            userCode: z.string().min(1),
            password: z.string().min(1),
          }),
          z.object({
            provider: z.literal('otsarHahayal'),
            displayName: z.string().min(1),
            username: z.string().min(1),
            password: z.string().min(1),
          }),
          z.object({
            provider: z.literal('visaCal'),
            displayName: z.string().min(1),
            username: z.string().min(1),
            password: z.string().min(1),
          }),
          z.object({
            provider: z.literal('isracard'),
            displayName: z.string().min(1),
            id: z.string().min(1),
            card6Digits: z.string().length(6),
            password: z.string().min(1),
          }),
        ]),
      )
      .mutation(async ({ ctx, input }) => {
        const { provider, displayName, ...credentials } = input
        const { encrypted, iv } = encryptCredentials(credentials as Record<string, string>)
        const id = 'bc' + Date.now() + Math.random().toString(36).slice(2, 7)
        const now = new Date().toISOString()
        await ctx.db.insert(bankConnections).values({
          id,
          provider,
          displayName,
          credentialsEncrypted: encrypted,
          credentialsIv: iv,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        })
        return { id }
      }),

    /** Deletes the connection + accounts; keeps past transactions (unlinks them). */
    delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
      const accounts = (await queryRows(
        ctx.db
          .select({ id: bankAccounts.id })
          .from(bankAccounts)
          .where(eq(bankAccounts.connectionId, input.id)),
      )) as Array<{ id: string }>
      for (const account of accounts) {
        await ctx.db
          .update(financeTransactions)
          .set({ bankAccountId: null })
          .where(eq(financeTransactions.bankAccountId, account.id))
      }
      await ctx.db.delete(bankAccounts).where(eq(bankAccounts.connectionId, input.id))
      await ctx.db.delete(bankConnections).where(eq(bankConnections.id, input.id))
      return { success: true }
    }),

    sync: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
      const rows = (await queryRows(
        ctx.db.select().from(bankConnections).where(eq(bankConnections.id, input.id)),
      )) as BankConnection[]
      const connection = rows[0]
      if (!connection) {
        return { success: false, accountsSynced: 0, transactionsInserted: 0, error: 'חיבור לא נמצא' }
      }
      return syncConnection(ctx.db, connection, ctx.bankScrape ?? undefined)
    }),

    syncAll: protectedProcedure.mutation(async ({ ctx }) => {
      const results = await syncAllConnections(ctx.db, ctx.bankScrape ?? undefined)
      return { results }
    }),
  }),

  getAccountsSnapshot: protectedProcedure.query(async ({ ctx }) => {
    const connections = (await queryRows(
      ctx.db.select().from(bankConnections),
    )) as BankConnection[]
    const accountRows = (await queryRows(ctx.db.select().from(bankAccounts))) as BankAccount[]

    const accounts = accountRows.map((a) => {
      const connection = connections.find((c) => c.id === a.connectionId)
      return {
        id: a.id,
        connectionId: a.connectionId,
        displayName: connection?.displayName ?? a.accountNumber,
        provider: connection?.provider ?? 'unknown',
        accountType: a.accountType as 'bank' | 'credit_card',
        accountNumber: a.accountNumber,
        balance: a.balance != null ? parseFloat(a.balance) : null,
        balanceUpdatedAt: a.balanceUpdatedAt,
        status: connection?.status ?? 'pending',
      }
    })

    const totalBankBalance = accounts
      .filter((a) => a.accountType === 'bank' && a.balance != null)
      .reduce((s, a) => s + (a.balance ?? 0), 0)
    const totalCreditCardBalance = accounts
      .filter((a) => a.accountType === 'credit_card' && a.balance != null)
      .reduce((s, a) => s + (a.balance ?? 0), 0)
    const lastSyncAt = connections
      .map((c) => c.lastSyncAt)
      .filter((t): t is string => Boolean(t))
      .sort()
      .pop() ?? null

    return {
      totalBankBalance,
      totalCreditCardBalance,
      currency: 'ILS' as const,
      connectedCount: connections.filter((c) => c.status === 'connected').length,
      lastSyncAt,
      accounts,
    }
  }),

  // ─── Cash-flow analytics & insights ──────────────────────────────────────

  analytics: router({
    monthlyTrend: protectedProcedure
      .input(z.object({ months: z.union([z.literal(3), z.literal(6), z.literal(12), z.literal(24)]).default(12) }))
      .query(async ({ ctx, input }) => {
        const txns = await loadAnalyticsTxns(ctx, input.months)
        return { months: buildMonthlyTrend(txns, input.months), currency: 'ILS' as const }
      }),

    categoryBreakdown: protectedProcedure
      .input(
        z.object({
          month: z.string().regex(/^\d{4}-\d{2}$/),
          direction: z.enum(['income', 'expense']).default('expense'),
        })
      )
      .query(async ({ ctx, input }) => {
        const txns = await loadAnalyticsTxns(ctx, 12)
        return buildCategoryBreakdown(txns, input.month, input.direction)
      }),

    recurring: protectedProcedure
      .input(
        z.object({
          minOccurrences: z.number().min(2).max(12).default(3),
          lookbackMonths: z.number().min(3).max(24).default(12),
        })
      )
      .query(async ({ ctx, input }) => {
        const txns = await loadAnalyticsTxns(ctx, input.lookbackMonths)
        return detectRecurring(txns, {
          minOccurrences: input.minOccurrences,
          lookbackMonths: input.lookbackMonths,
        })
      }),

    insights: protectedProcedure
      .input(z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) }))
      .query(async ({ ctx, input }) => {
        const txns = await loadAnalyticsTxns(ctx, 12)
        const trend = buildMonthlyTrend(txns, 12)
        const breakdown = buildCategoryBreakdown(txns, input.month, 'expense')
        const recurring = detectRecurring(txns, { lookbackMonths: 12 })
        return {
          insights: computeInsights({ month: input.month, trend, breakdown, recurring }),
        }
      }),

    /**
     * Data-quality state for the tab banner. Deliberately separate from `insights`:
     * a gap in the data is not a finding about spending, and showing it in both places
     * would print the same warning twice on one screen.
     */
    coverage: protectedProcedure.query(async ({ ctx }) => {
      const rows = (await queryRows(
        ctx.db
          .select({
            amount: financeTransactions.amount,
            direction: financeTransactions.direction,
            category: financeTransactions.category,
            description: financeTransactions.description,
            transactionDate: financeTransactions.transactionDate,
          })
          .from(financeTransactions)
      )) as Array<{
        amount: string
        direction: string
        category: string | null
        description: string | null
        transactionDate: string
      }>

      const accounts = (await queryRows(
        ctx.db.select({ accountType: bankAccounts.accountType }).from(bankAccounts)
      )) as Array<{ accountType: string }>

      let uncategorizedCount = 0
      let uncategorizedExpenseValue = 0
      let totalExpenseValue = 0
      let hiddenCardValue = 0
      let oldestUncategorizedDate: string | null = null

      for (const r of rows) {
        const amount = Number(r.amount) || 0
        const isExpense = r.direction === 'expense'
        if (isExpense) totalExpenseValue += amount

        if (!r.category) {
          uncategorizedCount++
          if (isExpense) uncategorizedExpenseValue += amount
          if (!oldestUncategorizedDate || r.transactionDate < oldestUncategorizedDate) {
            oldestUncategorizedDate = r.transactionDate
          }
        }

        // Works before the backfill has run: fall back to the keyword verdict so the
        // credit-card blind spot is detectable on day one.
        const effective = r.category ?? categorizeByKeywords(r.description ?? '', isExpense ? 'expense' : 'income')
        if (isExpense && effective === 'כרטיס אשראי') hiddenCardValue += amount
      }

      const creditCardConnected = accounts.some((a) => a.accountType === 'credit_card')

      return {
        uncategorizedCount,
        uncategorizedExpenseValue: Math.round(uncategorizedExpenseValue * 100) / 100,
        uncategorizedShare:
          totalExpenseValue > 0
            ? Math.round((uncategorizedExpenseValue / totalExpenseValue) * 1000) / 10
            : 0,
        oldestUncategorizedDate,
        creditCardConnected,
        hiddenCardValue: Math.round(hiddenCardValue * 100) / 100,
        hiddenCardShare:
          totalExpenseValue > 0 ? Math.round((hiddenCardValue / totalExpenseValue) * 1000) / 10 : 0,
        totalTransactions: rows.length,
      }
    }),

    listCategoryRules: protectedProcedure.query(async ({ ctx }) => {
      const rules = (await queryRows(
        ctx.db.select().from(financeCategoryRules).orderBy(desc(financeCategoryRules.createdAt))
      )) as FinanceCategoryRule[]
      return { rules }
    }),

    deleteCategoryRule: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
      await ctx.db.delete(financeCategoryRules).where(eq(financeCategoryRules.id, input.id))
      return { ok: true }
    }),
  }),

  /** Apply user rules then built-in keywords to every transaction still missing a category. */
  categorizeBacklog: protectedProcedure
    .input(z.object({ dryRun: z.boolean().default(false) }))
    .mutation(async ({ ctx, input }) => {
      const rules = await loadCategoryRules(ctx)
      const rows = (await queryRows(
        ctx.db
          .select({
            id: financeTransactions.id,
            direction: financeTransactions.direction,
            description: financeTransactions.description,
          })
          .from(financeTransactions)
          .where(isNull(financeTransactions.category))
      )) as Array<{ id: string; direction: string; description: string | null }>

      const byCategory: Record<string, number> = {}
      let updated = 0

      for (const row of rows) {
        const direction = row.direction === 'income' ? 'income' : 'expense'
        const category = categorizeTransaction(row.description ?? '', rules, direction)
        byCategory[category] = (byCategory[category] ?? 0) + 1
        if (!input.dryRun) {
          await ctx.db
            .update(financeTransactions)
            .set({ category })
            .where(eq(financeTransactions.id, row.id))
        }
        updated++
      }

      return { updated, remaining: input.dryRun ? rows.length : 0, byCategory }
    }),

  /**
   * Set one transaction's category, optionally learning a rule so similar descriptions
   * follow the same decision from now on.
   */
  setTransactionCategory: protectedProcedure
    .input(
      z.object({
        id: z.string(),
        category: z.string().min(1),
        applyToSimilar: z.boolean().default(false),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const [target] = (await queryRows(
        ctx.db
          .select({
            id: financeTransactions.id,
            description: financeTransactions.description,
            direction: financeTransactions.direction,
          })
          .from(financeTransactions)
          .where(eq(financeTransactions.id, input.id))
      )) as Array<{ id: string; description: string | null; direction: string }>

      if (!target) throw new Error('התנועה לא נמצאה')

      await ctx.db
        .update(financeTransactions)
        .set({ category: input.category })
        .where(eq(financeTransactions.id, input.id))

      if (!input.applyToSimilar) return { updated: 1, ruleCreated: false }

      const pattern = suggestRulePattern(target.description ?? '')
      if (!pattern) return { updated: 1, ruleCreated: false }

      await ctx.db.insert(financeCategoryRules).values({
        id: 'fcr' + Date.now() + Math.random().toString(36).slice(2, 7),
        pattern,
        category: input.category,
        direction: target.direction === 'income' ? 'income' : 'expense',
        createdBy: 'user',
        createdAt: new Date().toISOString(),
      })

      // Matching in memory rather than SQL LIKE: the pattern is a normalized, case-folded
      // substring, and SQLite's LIKE is not reliably case-insensitive for Hebrew.
      const candidates = (await queryRows(
        ctx.db
          .select({
            id: financeTransactions.id,
            description: financeTransactions.description,
            direction: financeTransactions.direction,
          })
          .from(financeTransactions)
      )) as Array<{ id: string; description: string | null; direction: string }>

      let updated = 1
      for (const row of candidates) {
        if (row.id === input.id) continue
        if (row.direction !== target.direction) continue
        if (!(row.description ?? '').toLowerCase().includes(pattern)) continue
        await ctx.db
          .update(financeTransactions)
          .set({ category: input.category })
          .where(eq(financeTransactions.id, row.id))
        updated++
      }

      return { updated, ruleCreated: true }
    }),

  // ─── Summary ─────────────────────────────────────────────────────────────

  getSummary: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const [
      [tradeCountAll],
      [tradeCountMonth],
      [txnCountAll],
      monthlyAgg,
      trades,
    ] = await Promise.all([
      ctx.db.select({ value: count() }).from(financeTrades),
      ctx.db.select({ value: count() }).from(financeTrades).where(gte(financeTrades.tradeDate, monthStart)),
      ctx.db.select({ value: count() }).from(financeTransactions),
      ctx.db
        .select({
          direction: financeTransactions.direction,
          total: sql<string>`COALESCE(SUM(CAST(${financeTransactions.amount} AS REAL)), 0)`,
        })
        .from(financeTransactions)
        .where(gte(financeTransactions.transactionDate, monthStart))
        .groupBy(financeTransactions.direction),
      ctx.db
        .select({
          symbol: financeTrades.symbol,
          direction: financeTrades.direction,
          quantity: financeTrades.quantity,
          price: financeTrades.price,
        })
        .from(financeTrades)
        .orderBy(desc(financeTrades.tradeDate)),
    ])

    let monthlyExpenses = 0
    let monthlyIncome = 0
    for (const row of monthlyAgg) {
      const val = parseFloat(String(row.total))
      if (row.direction === 'expense') monthlyExpenses = val
      else if (row.direction === 'income') monthlyIncome = val
    }

    const positions: Record<
      string,
      { symbol: string; totalBought: number; totalSold: number; sharesOwned: number; avgCost: number }
    > = {}

    for (const trade of trades) {
      const sym = trade.symbol
      if (!positions[sym]) {
        positions[sym] = { symbol: sym, totalBought: 0, totalSold: 0, sharesOwned: 0, avgCost: 0 }
      }
      const qty = parseFloat(trade.quantity)
      const price = parseFloat(trade.price)
      if (trade.direction === 'buy') {
        const prev = positions[sym]
        const newShares = prev.sharesOwned + qty
        positions[sym].avgCost =
          newShares > 0
            ? (prev.avgCost * prev.sharesOwned + price * qty) / newShares
            : price
        positions[sym].sharesOwned = newShares
        positions[sym].totalBought += qty * price
      } else {
        positions[sym].sharesOwned = Math.max(0, positions[sym].sharesOwned - qty)
        positions[sym].totalSold += qty * price
      }
    }

    const openPositions = Object.values(positions).filter((p) => p.sharesOwned > 0)
    const realizedPnl = Object.values(positions).reduce(
      (s, p) => s + (p.totalSold - p.totalBought),
      0
    )

    return {
      tradesThisMonth: tradeCountMonth?.value ?? 0,
      totalTradesAllTime: tradeCountAll?.value ?? 0,
      monthlyExpenses,
      monthlyIncome,
      monthlyNet: monthlyIncome - monthlyExpenses,
      openPositions,
      realizedPnl,
      totalTransactions: txnCountAll?.value ?? 0,
    }
  }),

  // ─── Trading Journal ───────────────────────────────────────────────────────

  /** מצב יומי + P&L ממומש (FIFO) לתקופה נבחרת, כולל סטטוס סנכרון אחרון */
  getTradingJournal: protectedProcedure
    .input(z.object({ period: z.enum(['today', 'week', 'month', 'all']).default('today') }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(financeTrades)
        .orderBy(desc(financeTrades.tradeDate))

      const { sells } = computeFifoPnl(toTradeInputs(rows))
      const realizedById = new Map<string, number>()
      for (const sell of sells) {
        if (sell.id) realizedById.set(sell.id, sell.realizedPnl)
      }

      const since = periodSince(input.period)
      let buysNotional = 0
      let sellsNotional = 0
      let realizedPnl = 0

      const trades = rows
        .filter((r) => !since || r.tradeDate >= since)
        .map((r) => {
          const quantity = parseFloat(r.quantity) || 0
          const price = parseFloat(r.price) || 0
          const notional = quantity * price
          if (r.direction === 'buy') buysNotional += notional
          else sellsNotional += notional
          const pnl = r.direction === 'sell' ? realizedById.get(r.id) ?? null : null
          if (pnl != null) realizedPnl += pnl
          return {
            id: r.id,
            tradeDate: r.tradeDate,
            symbol: r.symbol,
            direction: r.direction,
            quantity,
            price,
            currency: r.currency,
            realizedPnl: pnl,
          }
        })

      const [trigger] = await ctx.db
        .select()
        .from(agentTriggers)
        .where(eq(agentTriggers.agentId, '05_ibkr_daily_import'))
        .limit(1)

      return {
        period: input.period,
        tradesCount: trades.length,
        buysNotional,
        sellsNotional,
        realizedPnl,
        trades,
        lastSync: trigger
          ? { at: trigger.lastRunAt ?? null, status: trigger.lastRunStatus ?? null }
          : null,
      }
    }),

  /** דירוג סימבולים לפי P&L ממומש (FIFO) — מנצחים מול מפסידים */
  getSymbolRanking: protectedProcedure
    .input(
      z.object({
        period: z.enum(['today', 'week', 'month', 'all']).default('all'),
        limit: z.number().min(1).max(50).default(5),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db.select().from(financeTrades)
      const { sells } = computeFifoPnl(toTradeInputs(rows))

      const since = periodSince(input.period)
      const bySymbol: Record<string, number> = {}
      for (const sell of sells) {
        if (since && sell.tradeDate < since) continue
        bySymbol[sell.symbol] = (bySymbol[sell.symbol] ?? 0) + sell.realizedPnl
      }

      const entries = Object.entries(bySymbol).map(([symbol, realizedPnl]) => ({ symbol, realizedPnl }))
      const EPS = 0.005
      const winners = entries
        .filter((e) => e.realizedPnl > EPS)
        .sort((a, b) => b.realizedPnl - a.realizedPnl)
        .slice(0, input.limit)
      const losers = entries
        .filter((e) => e.realizedPnl < -EPS)
        .sort((a, b) => a.realizedPnl - b.realizedPnl)
        .slice(0, input.limit)
      const breakeven = entries.filter((e) => Math.abs(e.realizedPnl) <= EPS)

      return { winners, losers, breakeven }
    }),
})

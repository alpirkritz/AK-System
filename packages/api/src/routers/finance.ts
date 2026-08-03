import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import {
  financeTrades,
  financeTransactions,
  agentTriggers,
  bankConnections,
  bankAccounts,
  queryRows,
  type BankConnection,
  type BankAccount,
} from '@ak-system/database'
import { eq, desc, gte, and, like, sql, count, sum } from 'drizzle-orm'
import { listIBKREmails } from '../services/ibkr-parser'
import { importIBKREmails } from '../services/ibkr-import-service'
import { importIBKRFromNotion, isNotionIbkrConfigured } from '../services/notion-ibkr-import'
import { computeFifoPnl, type TradeInput } from '../services/pnl'
import { parseCSV } from '../services/csv-parser'
import { extractTextFromPdf, parsePdfStatementText } from '../services/pdf-parser'
import { encryptCredentials, isBankCryptoConfigured } from '../lib/bank-credentials-crypto'
import { syncConnection, syncAllConnections } from '../services/bank-sync-service'

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
        limit: z.number().min(1).max(500).default(200),
      })
    )
    .query(async ({ ctx, input }) => {
      let rows = ctx.db.select().from(financeTransactions).$dynamic()

      if (input.direction) {
        rows = rows.where(eq(financeTransactions.direction, input.direction))
      }
      if (input.category) {
        rows = rows.where(eq(financeTransactions.category, input.category))
      }
      if (input.since) {
        rows = rows.where(gte(financeTransactions.transactionDate, input.since))
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

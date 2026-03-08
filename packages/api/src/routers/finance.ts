import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { financeTrades, financeTransactions } from '@ak-system/database'
import { eq, desc, gte, and, like, sql, count, sum } from 'drizzle-orm'
import { fetchIBKRTrades, listIBKREmails } from '../services/ibkr-parser'
import { parseCSV } from '../services/csv-parser'
import { extractTextFromPdf, parsePdfStatementText } from '../services/pdf-parser'

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
      const trades = await fetchIBKRTrades(input.maxEmails)
      let inserted = 0
      let skipped = 0

      // Pre-load existing trades for deduplication (rawEmailId|symbol|direction as key)
      const existingRows = await ctx.db
        .select({
          rawEmailId: financeTrades.rawEmailId,
          symbol: financeTrades.symbol,
          direction: financeTrades.direction,
        })
        .from(financeTrades)
      const existingKeys = new Set(
        existingRows.map((r) => `${r.rawEmailId}|${r.symbol}|${r.direction}`)
      )

      for (const trade of trades) {
        const key = `${trade.rawEmailId}|${trade.symbol}|${trade.direction}`
        if (existingKeys.has(key)) {
          skipped++
          continue
        }

        const id = 'ft' + Date.now() + Math.random().toString(36).slice(2, 7)
        await ctx.db.insert(financeTrades).values({
          id,
          symbol: trade.symbol,
          direction: trade.direction,
          quantity: String(trade.quantity),
          price: String(trade.price),
          commission: String(trade.commission),
          currency: trade.currency,
          tradeDate: trade.tradeDate,
          source: 'ibkr_email',
          rawEmailId: trade.rawEmailId,
          description: trade.description ?? null,
          createdAt: new Date().toISOString(),
        })
        existingKeys.add(key)
        inserted++
      }

      return { inserted, skipped, total: trades.length }
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
})

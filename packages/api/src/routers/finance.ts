import { z } from 'zod'
import { router, publicProcedure } from '../trpc'
import { financeTrades, financeTransactions } from '@ak-system/database'
import { eq, desc, gte, and, like } from 'drizzle-orm'
import { fetchIBKRTrades, listIBKREmails } from '../services/ibkr-parser'
import { parseCSV } from '../services/csv-parser'

const idInput = z.object({ id: z.string().min(1) })

export const financeRouter = router({
  // ─── IBKR Trades ─────────────────────────────────────────────────────────

  /** מחזיר רשימת מיילים מ-IBKR (לאבחון) — בלי שמירה לDB */
  listIBKREmails: publicProcedure
    .input(z.object({ max: z.number().min(1).max(200).default(50) }))
    .query(async ({ input }) => {
      return listIBKREmails(input.max)
    }),

  /** אבחון מלא — מחפש בצורה רחבה ומחזיר גוף ראשון */
  gmailDebug: publicProcedure
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

  syncIBKREmails: publicProcedure
    .input(z.object({ maxEmails: z.number().min(1).max(500).default(100) }))
    .mutation(async ({ ctx, input }) => {
      const trades = await fetchIBKRTrades(input.maxEmails)
      let inserted = 0
      let skipped = 0

      for (const trade of trades) {
        // Deduplicate by rawEmailId + symbol + direction + quantity + price
        const existing = await ctx.db
          .select({ id: financeTrades.id })
          .from(financeTrades)
          .where(
            and(
              eq(financeTrades.rawEmailId, trade.rawEmailId),
              eq(financeTrades.symbol, trade.symbol),
              eq(financeTrades.direction, trade.direction)
            )
          )
          .limit(1)

        if (existing.length > 0) {
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
        inserted++
      }

      return { inserted, skipped, total: trades.length }
    }),

  listTrades: publicProcedure
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

  deleteTrade: publicProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(financeTrades).where(eq(financeTrades.id, input.id))
    return { ok: true }
  }),

  // ─── Expenses / Income ────────────────────────────────────────────────────

  importCSV: publicProcedure
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

  createTransaction: publicProcedure
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
      await ctx.db.insert(financeTransactions).values({
        id,
        amount: String(input.amount),
        currency: input.currency,
        direction: input.direction,
        category: input.category,
        description: input.description,
        transactionDate: new Date(input.transactionDate).toISOString(),
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

  listTransactions: publicProcedure
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

  deleteTransaction: publicProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(financeTransactions).where(eq(financeTransactions.id, input.id))
    return { ok: true }
  }),

  // ─── Summary ─────────────────────────────────────────────────────────────

  getSummary: publicProcedure.query(async ({ ctx }) => {
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()

    const [allTrades, monthTrades, allTxns, monthTxns] = await Promise.all([
      ctx.db.select().from(financeTrades).orderBy(desc(financeTrades.tradeDate)),
      ctx.db
        .select()
        .from(financeTrades)
        .where(gte(financeTrades.tradeDate, monthStart)),
      ctx.db.select().from(financeTransactions).orderBy(desc(financeTransactions.transactionDate)),
      ctx.db
        .select()
        .from(financeTransactions)
        .where(gte(financeTransactions.transactionDate, monthStart)),
    ])

    const monthlyExpenses = monthTxns
      .filter((t) => t.direction === 'expense')
      .reduce((sum, t) => sum + parseFloat(t.amount), 0)

    const monthlyIncome = monthTxns
      .filter((t) => t.direction === 'income')
      .reduce((sum, t) => sum + parseFloat(t.amount), 0)

    // Group trades by symbol to compute simplified P&L
    const positions: Record<
      string,
      { symbol: string; totalBought: number; totalSold: number; sharesOwned: number; avgCost: number }
    > = {}

    for (const trade of allTrades) {
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
      (sum, p) => sum + (p.totalSold - p.totalBought),
      0
    )

    return {
      tradesThisMonth: monthTrades.length,
      totalTradesAllTime: allTrades.length,
      monthlyExpenses,
      monthlyIncome,
      monthlyNet: monthlyIncome - monthlyExpenses,
      openPositions,
      realizedPnl,
      totalTransactions: allTxns.length,
    }
  }),
})

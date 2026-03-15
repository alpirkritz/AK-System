import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { vatEntries } from '@ak-system/database'
import { eq, desc, and, sql } from 'drizzle-orm'
import { VAT_CATEGORIES, computeVatBreakdown, VAT_RATE } from '@ak-system/types'

const idInput = z.object({ id: z.string().min(1) })

export const vatRouter = router({
  categories: protectedProcedure.query(() => VAT_CATEGORIES),

  list: protectedProcedure
    .input(
      z.object({
        year: z.number().int(),
        period: z.number().int().min(1).max(6),
        category: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        eq(vatEntries.year, input.year),
        eq(vatEntries.period, input.period),
      ]
      if (input.category) {
        conditions.push(eq(vatEntries.category, input.category))
      }

      return ctx.db
        .select()
        .from(vatEntries)
        .where(and(...conditions))
        .orderBy(vatEntries.date, vatEntries.createdAt)
    }),

  listYear: protectedProcedure
    .input(z.object({ year: z.number().int() }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(vatEntries)
        .where(eq(vatEntries.year, input.year))
        .orderBy(vatEntries.taxCode, vatEntries.date)
    }),

  create: protectedProcedure
    .input(
      z.object({
        year: z.number().int(),
        period: z.number().int().min(1).max(6),
        taxCode: z.string(),
        category: z.string(),
        entryType: z.enum(['income', 'expense']),
        date: z.string(),
        invoiceNumber: z.string().optional(),
        description: z.string().min(1),
        amount: z.number().positive(),
        isVatExempt: z.boolean().default(false),
        deductionPercent: z.number().min(0).max(1).optional(),
        dollarRate: z.number().positive().optional(),
        invoiceFileUrl: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = 've' + Date.now() + Math.random().toString(36).slice(2, 7)
      await ctx.db.insert(vatEntries).values({
        id,
        year: input.year,
        period: input.period,
        taxCode: input.taxCode,
        category: input.category,
        entryType: input.entryType,
        date: input.date,
        invoiceNumber: input.invoiceNumber ?? null,
        description: input.description,
        amount: String(input.amount),
        isVatExempt: input.isVatExempt ? 1 : 0,
        deductionPercent: input.deductionPercent != null ? String(input.deductionPercent) : null,
        dollarRate: input.dollarRate != null ? String(input.dollarRate) : null,
        invoiceFileUrl: input.invoiceFileUrl ?? null,
        createdAt: new Date().toISOString(),
      })
      return { id }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        taxCode: z.string().optional(),
        category: z.string().optional(),
        entryType: z.enum(['income', 'expense']).optional(),
        date: z.string().optional(),
        invoiceNumber: z.string().nullable().optional(),
        description: z.string().min(1).optional(),
        amount: z.number().positive().optional(),
        isVatExempt: z.boolean().optional(),
        deductionPercent: z.number().min(0).max(1).nullable().optional(),
        dollarRate: z.number().positive().nullable().optional(),
        invoiceFileUrl: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input
      const updates: Record<string, unknown> = {}

      if (fields.taxCode !== undefined) updates.taxCode = fields.taxCode
      if (fields.category !== undefined) updates.category = fields.category
      if (fields.entryType !== undefined) updates.entryType = fields.entryType
      if (fields.date !== undefined) updates.date = fields.date
      if (fields.invoiceNumber !== undefined) updates.invoiceNumber = fields.invoiceNumber
      if (fields.description !== undefined) updates.description = fields.description
      if (fields.amount !== undefined) updates.amount = String(fields.amount)
      if (fields.isVatExempt !== undefined) updates.isVatExempt = fields.isVatExempt ? 1 : 0
      if (fields.deductionPercent !== undefined) updates.deductionPercent = fields.deductionPercent != null ? String(fields.deductionPercent) : null
      if (fields.dollarRate !== undefined) updates.dollarRate = fields.dollarRate != null ? String(fields.dollarRate) : null
      if (fields.invoiceFileUrl !== undefined) updates.invoiceFileUrl = fields.invoiceFileUrl

      if (Object.keys(updates).length > 0) {
        await ctx.db.update(vatEntries).set(updates).where(eq(vatEntries.id, id))
      }
      return { ok: true }
    }),

  delete: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(vatEntries).where(eq(vatEntries.id, input.id))
    return { ok: true }
  }),

  periodSummary: protectedProcedure
    .input(z.object({ year: z.number().int(), period: z.number().int().min(1).max(6) }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(vatEntries)
        .where(and(eq(vatEntries.year, input.year), eq(vatEntries.period, input.period)))

      let totalIncomeInclVat = 0
      let totalIncomeExclVat = 0
      let totalVatExemptIncome = 0
      let totalVatFromIncome = 0
      let totalComputedExpense = 0
      let totalExpenseExclVat = 0
      let totalVatExemptExpense = 0
      let totalVatFromExpenses = 0
      let totalExpenseForAnnual = 0

      for (const row of rows) {
        const amount = parseFloat(row.amount) || 0
        const deduction = row.deductionPercent != null ? parseFloat(row.deductionPercent) : 1
        const exempt = row.isVatExempt === 1 || (row.isVatExempt as unknown) === true
        const b = computeVatBreakdown(row.entryType as 'income' | 'expense', amount, deduction, exempt)

        totalIncomeInclVat += b.incomeInclVat
        totalIncomeExclVat += b.incomeExclVat
        totalVatExemptIncome += b.vatExemptIncome
        totalVatFromIncome += b.vatFromIncome
        totalComputedExpense += b.computedExpense
        totalExpenseExclVat += b.expenseExclVat
        totalVatExemptExpense += b.vatExemptExpense
        totalVatFromExpenses += b.vatFromExpenses
        totalExpenseForAnnual += b.totalExpenseForAnnual
      }

      return {
        entryCount: rows.length,
        totalIncomeInclVat,
        totalIncomeExclVat,
        totalVatExemptIncome,
        totalVatFromIncome,
        totalComputedExpense,
        totalExpenseExclVat,
        totalVatExemptExpense,
        totalVatFromExpenses,
        totalExpenseForAnnual,
        vatToPay: totalVatFromIncome - totalVatFromExpenses,
      }
    }),

  annualSummary: protectedProcedure
    .input(z.object({ year: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(vatEntries)
        .where(eq(vatEntries.year, input.year))
        .orderBy(vatEntries.taxCode, vatEntries.date)

      const groups: Record<string, {
        taxCode: string
        entries: typeof rows
        totalIncomeInclVat: number
        totalIncomeExclVat: number
        totalVatFromIncome: number
        totalComputedExpense: number
        totalExpenseExclVat: number
        totalVatExemptExpense: number
        totalVatFromExpenses: number
        totalExpenseForAnnual: number
      }> = {}

      for (const row of rows) {
        const code = row.taxCode
        if (!groups[code]) {
          groups[code] = {
            taxCode: code,
            entries: [],
            totalIncomeInclVat: 0,
            totalIncomeExclVat: 0,
            totalVatFromIncome: 0,
            totalComputedExpense: 0,
            totalExpenseExclVat: 0,
            totalVatExemptExpense: 0,
            totalVatFromExpenses: 0,
            totalExpenseForAnnual: 0,
          }
        }
        groups[code].entries.push(row)

        const amount = parseFloat(row.amount) || 0
        const deduction = row.deductionPercent != null ? parseFloat(row.deductionPercent) : 1
        const exempt = row.isVatExempt === 1 || (row.isVatExempt as unknown) === true
        const b = computeVatBreakdown(row.entryType as 'income' | 'expense', amount, deduction, exempt)

        groups[code].totalIncomeInclVat += b.incomeInclVat
        groups[code].totalIncomeExclVat += b.incomeExclVat
        groups[code].totalVatFromIncome += b.vatFromIncome
        groups[code].totalComputedExpense += b.computedExpense
        groups[code].totalExpenseExclVat += b.expenseExclVat
        groups[code].totalVatExemptExpense += b.vatExemptExpense
        groups[code].totalVatFromExpenses += b.vatFromExpenses
        groups[code].totalExpenseForAnnual += b.totalExpenseForAnnual
      }

      const taxCodeOrder = ['1', '2', '8', '9', '10', '12', '13']
      const sortedGroups = taxCodeOrder
        .filter((code) => groups[code])
        .map((code) => groups[code])

      let grandTotalIncomeInclVat = 0
      let grandTotalExpenseForAnnual = 0
      let grandTotalVatFromIncome = 0
      let grandTotalVatFromExpenses = 0

      for (const g of sortedGroups) {
        grandTotalIncomeInclVat += g.totalIncomeInclVat
        grandTotalExpenseForAnnual += g.totalExpenseForAnnual
        grandTotalVatFromIncome += g.totalVatFromIncome
        grandTotalVatFromExpenses += g.totalVatFromExpenses
      }

      return {
        groups: sortedGroups,
        grandTotalIncomeInclVat,
        grandTotalExpenseForAnnual,
        grandTotalVatFromIncome,
        grandTotalVatFromExpenses,
        grandVatToPay: grandTotalVatFromIncome - grandTotalVatFromExpenses,
      }
    }),

  parseInvoice: protectedProcedure
    .input(
      z.object({
        fileBase64: z.string().min(1),
        mimeType: z.enum(['application/pdf', 'image/jpeg', 'image/png']),
      })
    )
    .mutation(async ({ input }) => {
      const { parseInvoiceWithVision } = await import('../services/invoice-ocr')
      return parseInvoiceWithVision(input.fileBase64, input.mimeType)
    }),
})

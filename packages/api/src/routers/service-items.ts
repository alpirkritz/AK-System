import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import {
  serviceItems,
  companyItemPrices,
  salesDocuments,
  salesDocumentLines,
} from '@ak-system/database'
import { eq, and, ne, asc, desc } from 'drizzle-orm'
import { SERVICE_UNITS } from '@ak-system/types'
import {
  resolveUnitPrice,
  pickLatestPerItem,
  type HistoryRow,
  type ResolvedPrice,
} from '../services/pricing-memory'

const idInput = z.object({ id: z.string().min(1) })

export const serviceItemsRouter = router({
  list: protectedProcedure
    .input(z.object({ includeInactive: z.boolean().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(serviceItems)
        .where(input?.includeInactive ? undefined : eq(serviceItems.isActive, true))
        .orderBy(asc(serviceItems.sortOrder), asc(serviceItems.name))
      return rows
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1),
        nameEn: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        unit: z.enum(SERVICE_UNITS).default('item'),
        defaultUnitPrice: z.number().min(0),
        currency: z.string().default('ILS'),
        vatApplicable: z.boolean().default(true),
        sortOrder: z.number().int().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const id = 'si' + Date.now() + Math.random().toString(36).slice(2, 7)
      const now = new Date().toISOString()
      await ctx.db.insert(serviceItems).values({
        id,
        name: input.name,
        nameEn: input.nameEn ?? null,
        description: input.description ?? null,
        unit: input.unit,
        defaultUnitPrice: String(input.defaultUnitPrice),
        currency: input.currency,
        vatApplicable: input.vatApplicable,
        isActive: true,
        sortOrder: input.sortOrder ?? 0,
        createdAt: now,
        updatedAt: now,
      })
      return { id }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).optional(),
        nameEn: z.string().nullable().optional(),
        description: z.string().nullable().optional(),
        unit: z.enum(SERVICE_UNITS).optional(),
        defaultUnitPrice: z.number().min(0).optional(),
        currency: z.string().optional(),
        vatApplicable: z.boolean().optional(),
        isActive: z.boolean().optional(),
        sortOrder: z.number().int().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, defaultUnitPrice, ...fields } = input
      const updates: Record<string, unknown> = {}
      for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
        if (fields[key] !== undefined) updates[key] = fields[key]
      }
      if (defaultUnitPrice !== undefined) updates.defaultUnitPrice = String(defaultUnitPrice)
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date().toISOString()
        await ctx.db.update(serviceItems).set(updates).where(eq(serviceItems.id, id))
      }
      return { ok: true }
    }),

  /** Archive rather than delete, so lines on issued documents keep their catalog link. */
  archive: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db
      .update(serviceItems)
      .set({ isActive: false, updatedAt: new Date().toISOString() })
      .where(eq(serviceItems.id, input.id))
    return { ok: true }
  }),

  /**
   * One fetch per document: returns the resolved price for every catalog item so the
   * line editor can fill instantly, with no per-line request and no loading state on
   * a money field.
   */
  pricesForClient: protectedProcedure
    .input(
      z.object({
        companyId: z.string().nullable().optional(),
        personId: z.string().nullable().optional(),
        currency: z.string().optional(),
      })
    )
    .query(async ({ ctx, input }) => {
      const documentCurrency = input.currency ?? 'ILS'
      const items = await ctx.db
        .select()
        .from(serviceItems)
        .where(eq(serviceItems.isActive, true))
        .orderBy(asc(serviceItems.sortOrder), asc(serviceItems.name))

      const pinnedByItem: Record<string, { unitPrice: number; currency: string }> = {}
      if (input.companyId) {
        const pinnedRows = await ctx.db
          .select()
          .from(companyItemPrices)
          .where(eq(companyItemPrices.companyId, input.companyId))
        for (const row of pinnedRows) {
          pinnedByItem[row.serviceItemId] = {
            unitPrice: parseFloat(row.unitPrice) || 0,
            currency: row.currency ?? 'ILS',
          }
        }
      }

      let historyByItem: Record<string, ReturnType<typeof pickLatestPerItem>[string]> = {}
      const clientFilter = input.companyId
        ? eq(salesDocuments.companyId, input.companyId)
        : input.personId
          ? eq(salesDocuments.personId, input.personId)
          : null

      if (clientFilter) {
        const rows = await ctx.db
          .select({
            serviceItemId: salesDocumentLines.serviceItemId,
            unitPrice: salesDocumentLines.unitPrice,
            currency: salesDocuments.currency,
            issueDate: salesDocuments.issueDate,
            documentId: salesDocuments.id,
          })
          .from(salesDocumentLines)
          .innerJoin(salesDocuments, eq(salesDocumentLines.documentId, salesDocuments.id))
          .where(
            and(
              clientFilter,
              eq(salesDocuments.status, 'issued'),
              ne(salesDocuments.docType, 'credit_invoice')
            )
          )
          .orderBy(desc(salesDocuments.issueDate))
        historyByItem = pickLatestPerItem(rows as HistoryRow[])
      }

      const result: Record<string, ResolvedPrice> = {}
      for (const item of items) {
        result[item.id] = resolveUnitPrice({
          pinned: pinnedByItem[item.id] ?? null,
          lastIssued: historyByItem[item.id] ?? null,
          catalogDefault: {
            unitPrice: parseFloat(item.defaultUnitPrice) || 0,
            currency: item.currency ?? 'ILS',
          },
          documentCurrency,
        })
      }
      return result
    }),

  pinPrice: protectedProcedure
    .input(
      z.object({
        companyId: z.string().min(1),
        serviceItemId: z.string().min(1),
        unitPrice: z.number().min(0),
        currency: z.string().default('ILS'),
        note: z.string().nullable().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date().toISOString()
      const [existing] = await ctx.db
        .select()
        .from(companyItemPrices)
        .where(
          and(
            eq(companyItemPrices.companyId, input.companyId),
            eq(companyItemPrices.serviceItemId, input.serviceItemId)
          )
        )
      if (existing) {
        await ctx.db
          .update(companyItemPrices)
          .set({
            unitPrice: String(input.unitPrice),
            currency: input.currency,
            note: input.note ?? null,
            updatedAt: now,
          })
          .where(eq(companyItemPrices.id, existing.id))
        return { id: existing.id }
      }
      const id = 'cip' + Date.now() + Math.random().toString(36).slice(2, 7)
      await ctx.db.insert(companyItemPrices).values({
        id,
        companyId: input.companyId,
        serviceItemId: input.serviceItemId,
        unitPrice: String(input.unitPrice),
        currency: input.currency,
        note: input.note ?? null,
        createdAt: now,
        updatedAt: now,
      })
      return { id }
    }),

  unpinPrice: protectedProcedure
    .input(z.object({ companyId: z.string().min(1), serviceItemId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(companyItemPrices)
        .where(
          and(
            eq(companyItemPrices.companyId, input.companyId),
            eq(companyItemPrices.serviceItemId, input.serviceItemId)
          )
        )
      return { ok: true }
    }),

  listPinned: protectedProcedure
    .input(z.object({ companyId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(companyItemPrices)
        .where(eq(companyItemPrices.companyId, input.companyId))
    }),
})

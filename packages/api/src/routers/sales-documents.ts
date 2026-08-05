import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { router, protectedProcedure } from '../trpc'
import {
  salesDocuments,
  salesDocumentLines,
  salesDocumentPayments,
  salesDocumentCounters,
  companies,
  people,
  vatEntries,
} from '@ak-system/database'
import { eq, and, or, like, desc, asc, gte, lte } from 'drizzle-orm'
import {
  SALES_DOCUMENT_TYPES,
  VAT_MODES,
  PAYMENT_METHODS,
  PRICE_SOURCES,
  VAT_RATE,
  computeDocumentTotals,
  computeLineTotal,
  isTaxDocument,
  requiresPayment,
  requiresReference,
  canCancel,
  allowedConversions,
  periodFromDate,
  type SalesDocumentType,
} from '@ak-system/types'
import { getBusinessProfile, buildIssuerSnapshot } from '../services/business-profile'
import type { Context } from '../trpc'

const idInput = z.object({ id: z.string().min(1) })

const lineInput = z.object({
  serviceItemId: z.string().nullable().optional(),
  priceSource: z.enum(PRICE_SOURCES).optional(),
  description: z.string().min(1),
  quantity: z.number().default(1),
  unitPrice: z.number().default(0),
  discountPercent: z.number().min(0).max(100).nullable().optional(),
  vatApplicable: z.boolean().optional(),
})

const paymentInput = z.object({
  method: z.enum(PAYMENT_METHODS).default('bank_transfer'),
  amount: z.number(),
  paidDate: z.string().min(1),
  reference: z.string().nullable().optional(),
  bankDetails: z.string().nullable().optional(),
})

const draftFields = {
  docType: z.enum(SALES_DOCUMENT_TYPES),
  language: z.enum(['he', 'en']).optional(),
  companyId: z.string().nullable().optional(),
  personId: z.string().nullable().optional(),
  issueDate: z.string().min(1),
  dueDate: z.string().nullable().optional(),
  validUntil: z.string().nullable().optional(),
  currency: z.string().optional(),
  exchangeRate: z.number().positive().nullable().optional(),
  vatMode: z.enum(VAT_MODES).optional(),
  notes: z.string().nullable().optional(),
  internalNotes: z.string().nullable().optional(),
  relatedDocumentId: z.string().nullable().optional(),
  lines: z.array(lineInput).default([]),
  payments: z.array(paymentInput).optional(),
}

type LineInput = z.infer<typeof lineInput>

function newId(prefix: string): string {
  return prefix + Date.now() + Math.random().toString(36).slice(2, 7)
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}

/**
 * A document priced in foreign currency still has to be reported to the VAT
 * authority in shekels, so the rate is mandatory rather than assumed.
 */
function requireExchangeRate(currency: string, exchangeRate?: number | null): number {
  if (currency === 'ILS') return 1
  if (!exchangeRate || exchangeRate <= 0) {
    throw new TRPCError({
      code: 'BAD_REQUEST',
      message: 'הזן שער המרה — נדרש לרישום המע"מ בשקלים',
    })
  }
  return exchangeRate
}

async function loadDocument(db: Context['db'], id: string) {
  const [doc] = await db.select().from(salesDocuments).where(eq(salesDocuments.id, id))
  if (!doc) throw new TRPCError({ code: 'NOT_FOUND', message: 'המסמך לא נמצא' })
  return doc
}

function assertDraft(doc: { status: string }) {
  if (doc.status !== 'draft') {
    throw new TRPCError({
      code: 'CONFLICT',
      message: 'המסמך כבר הונפק ולא ניתן לעריכה. לביטול יש להנפיק חשבונית זיכוי.',
    })
  }
}

/** Continuous per-type numbering; the settings start number seeds an unused counter. */
async function allocateNumber(db: Context['db'], docType: SalesDocumentType): Promise<number> {
  const [counter] = await db
    .select()
    .from(salesDocumentCounters)
    .where(eq(salesDocumentCounters.id, docType))
  const now = new Date().toISOString()

  if (!counter) {
    const profile = await getBusinessProfile(db)
    const start = profile.startNumbers?.[docType]
    const first = start && start > 0 ? start : 1
    await db.insert(salesDocumentCounters).values({
      id: docType,
      docType,
      lastNumber: first,
      updatedAt: now,
    })
    return first
  }

  const next = counter.lastNumber + 1
  await db
    .update(salesDocumentCounters)
    .set({ lastNumber: next, updatedAt: now })
    .where(eq(salesDocumentCounters.id, docType))
  return next
}

async function computeAndPersistTotals(
  db: Context['db'],
  documentId: string,
  lines: LineInput[],
  options: { vatMode: string; vatRate: number; currency: string; exchangeRate: number },
) {
  const totals = computeDocumentTotals(
    lines.map((line) => ({
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent ?? null,
      vatApplicable: line.vatApplicable !== false,
    })),
    { vatRate: options.vatRate, vatMode: options.vatMode as 'standard' | 'zero_rated' | 'exempt' },
  )

  await db.delete(salesDocumentLines).where(eq(salesDocumentLines.documentId, documentId))
  const now = new Date().toISOString()
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    await db.insert(salesDocumentLines).values({
      id: newId('sdl'),
      documentId,
      serviceItemId: line.serviceItemId ?? null,
      priceSource: line.priceSource ?? 'manual',
      position: i,
      description: line.description,
      quantity: String(line.quantity),
      unitPrice: String(line.unitPrice),
      discountPercent: line.discountPercent != null ? String(line.discountPercent) : null,
      vatApplicable: line.vatApplicable !== false,
      lineTotal: String(computeLineTotal(line)),
      createdAt: now,
    })
  }

  return {
    subtotal: String(totals.subtotal),
    vatAmount: String(totals.vatAmount),
    total: String(totals.total),
    totalIls: String(round2(totals.total * options.exchangeRate)),
  }
}

export const salesDocumentsRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          docType: z.enum(SALES_DOCUMENT_TYPES).optional(),
          status: z.enum(['draft', 'issued', 'cancelled']).optional(),
          companyId: z.string().optional(),
          year: z.number().int().optional(),
          search: z.string().optional(),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const conditions = []
      if (input?.docType) conditions.push(eq(salesDocuments.docType, input.docType))
      if (input?.status) conditions.push(eq(salesDocuments.status, input.status))
      if (input?.companyId) conditions.push(eq(salesDocuments.companyId, input.companyId))
      if (input?.year) {
        conditions.push(gte(salesDocuments.issueDate, `${input.year}-01-01`))
        conditions.push(lte(salesDocuments.issueDate, `${input.year}-12-31`))
      }
      const search = input?.search?.trim()
      if (search) {
        conditions.push(
          or(
            like(salesDocuments.clientName, `%${search}%`),
            like(salesDocuments.notes, `%${search}%`)
          )!
        )
      }

      const rows = await ctx.db
        .select()
        .from(salesDocuments)
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(salesDocuments.issueDate), desc(salesDocuments.createdAt))
        .limit(input?.limit ?? 200)

      const paid = await ctx.db.select().from(salesDocumentPayments)
      const paidByDoc = new Map<string, number>()
      for (const payment of paid) {
        paidByDoc.set(
          payment.documentId,
          (paidByDoc.get(payment.documentId) ?? 0) + (parseFloat(payment.amount) || 0)
        )
      }

      return rows.map((row) => ({
        ...row,
        paidAmount: round2(paidByDoc.get(row.id) ?? 0),
      }))
    }),

  get: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [document] = await ctx.db
      .select()
      .from(salesDocuments)
      .where(eq(salesDocuments.id, input.id))
    if (!document) return null

    const lines = await ctx.db
      .select()
      .from(salesDocumentLines)
      .where(eq(salesDocumentLines.documentId, input.id))
      .orderBy(asc(salesDocumentLines.position))

    const payments = await ctx.db
      .select()
      .from(salesDocumentPayments)
      .where(eq(salesDocumentPayments.documentId, input.id))
      .orderBy(asc(salesDocumentPayments.paidDate))

    let company = null
    if (document.companyId) {
      const [row] = await ctx.db
        .select()
        .from(companies)
        .where(eq(companies.id, document.companyId))
      company = row ?? null
    }

    let related = null
    if (document.relatedDocumentId) {
      const [row] = await ctx.db
        .select()
        .from(salesDocuments)
        .where(eq(salesDocuments.id, document.relatedDocumentId))
      related = row ?? null
    }

    // Drafts render against the live profile; issued documents keep their snapshot.
    const issuer = document.issuerJson
      ? JSON.parse(document.issuerJson)
      : buildIssuerSnapshot(await getBusinessProfile(ctx.db))

    return { document, lines, payments, company, related, issuer }
  }),

  nextNumber: protectedProcedure
    .input(z.object({ docType: z.enum(SALES_DOCUMENT_TYPES) }))
    .query(async ({ ctx, input }) => {
      const [counter] = await ctx.db
        .select()
        .from(salesDocumentCounters)
        .where(eq(salesDocumentCounters.id, input.docType))
      const profile = await getBusinessProfile(ctx.db)
      const number = counter
        ? counter.lastNumber + 1
        : profile.startNumbers?.[input.docType] && profile.startNumbers[input.docType]! > 0
          ? profile.startNumbers[input.docType]!
          : 1
      return { number, display: `${profile.numberPrefix ?? ''}${number}` }
    }),

  createDraft: protectedProcedure
    .input(z.object(draftFields))
    .mutation(async ({ ctx, input }) => {
      const currency = input.currency ?? 'ILS'
      const exchangeRate = requireExchangeRate(currency, input.exchangeRate)
      const vatMode = input.vatMode ?? 'standard'
      const vatRate = vatMode === 'standard' ? VAT_RATE : 0

      let language = input.language
      let clientSnapshot: Record<string, string | null> = {}
      if (input.companyId) {
        const [company] = await ctx.db
          .select()
          .from(companies)
          .where(eq(companies.id, input.companyId))
        if (company) {
          language = language ?? (company.preferredLanguage as 'he' | 'en')
          clientSnapshot = {
            clientName: company.name,
            clientTaxId: company.taxId,
            clientAddress: [company.address, company.city, company.zipCode]
              .filter(Boolean)
              .join(', ') || null,
            clientCountry: company.country,
            clientEmail: company.email,
            clientPhone: company.phone,
          }
        }
      } else if (input.personId) {
        const [person] = await ctx.db.select().from(people).where(eq(people.id, input.personId))
        if (person) {
          clientSnapshot = {
            clientName: person.name,
            clientEmail: person.email,
            clientPhone: person.phone,
          }
        }
      }

      const id = newId('sd')
      const now = new Date().toISOString()
      await ctx.db.insert(salesDocuments).values({
        id,
        docType: input.docType,
        docNumber: null,
        status: 'draft',
        language: language ?? 'he',
        issueDate: input.issueDate,
        dueDate: input.dueDate ?? null,
        validUntil: input.validUntil ?? null,
        companyId: input.companyId ?? null,
        personId: input.personId ?? null,
        ...clientSnapshot,
        currency,
        exchangeRate: currency === 'ILS' ? null : String(exchangeRate),
        vatMode,
        vatRate: String(vatRate),
        notes: input.notes ?? null,
        internalNotes: input.internalNotes ?? null,
        relatedDocumentId: input.relatedDocumentId ?? null,
        createdAt: now,
        updatedAt: now,
      })

      const totals = await computeAndPersistTotals(ctx.db, id, input.lines, {
        vatMode,
        vatRate,
        currency,
        exchangeRate,
      })
      await ctx.db.update(salesDocuments).set(totals).where(eq(salesDocuments.id, id))

      for (const payment of input.payments ?? []) {
        await ctx.db.insert(salesDocumentPayments).values({
          id: newId('sdp'),
          documentId: id,
          method: payment.method,
          amount: String(payment.amount),
          paidDate: payment.paidDate,
          reference: payment.reference ?? null,
          bankDetails: payment.bankDetails ?? null,
          createdAt: now,
        })
      }

      return { id }
    }),

  updateDraft: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        language: z.enum(['he', 'en']).optional(),
        companyId: z.string().nullable().optional(),
        personId: z.string().nullable().optional(),
        issueDate: z.string().optional(),
        dueDate: z.string().nullable().optional(),
        validUntil: z.string().nullable().optional(),
        currency: z.string().optional(),
        exchangeRate: z.number().positive().nullable().optional(),
        vatMode: z.enum(VAT_MODES).optional(),
        notes: z.string().nullable().optional(),
        internalNotes: z.string().nullable().optional(),
        relatedDocumentId: z.string().nullable().optional(),
        lines: z.array(lineInput).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const doc = await loadDocument(ctx.db, input.id)
      assertDraft(doc)

      const currency = input.currency ?? doc.currency
      const exchangeRate = requireExchangeRate(
        currency,
        input.exchangeRate ?? (doc.exchangeRate ? parseFloat(doc.exchangeRate) : null)
      )
      const vatMode = input.vatMode ?? doc.vatMode
      const vatRate = vatMode === 'standard' ? VAT_RATE : 0

      const updates: Record<string, unknown> = {
        currency,
        exchangeRate: currency === 'ILS' ? null : String(exchangeRate),
        vatMode,
        vatRate: String(vatRate),
        updatedAt: new Date().toISOString(),
      }
      if (input.language !== undefined) updates.language = input.language
      if (input.issueDate !== undefined) updates.issueDate = input.issueDate
      if (input.dueDate !== undefined) updates.dueDate = input.dueDate
      if (input.validUntil !== undefined) updates.validUntil = input.validUntil
      if (input.notes !== undefined) updates.notes = input.notes
      if (input.internalNotes !== undefined) updates.internalNotes = input.internalNotes
      if (input.relatedDocumentId !== undefined) updates.relatedDocumentId = input.relatedDocumentId
      if (input.personId !== undefined) updates.personId = input.personId

      if (input.companyId !== undefined) {
        updates.companyId = input.companyId
        if (input.companyId) {
          const [company] = await ctx.db
            .select()
            .from(companies)
            .where(eq(companies.id, input.companyId))
          if (company) {
            updates.clientName = company.name
            updates.clientTaxId = company.taxId
            updates.clientAddress =
              [company.address, company.city, company.zipCode].filter(Boolean).join(', ') || null
            updates.clientCountry = company.country
            updates.clientEmail = company.email
            updates.clientPhone = company.phone
          }
        }
      }

      if (input.lines) {
        const totals = await computeAndPersistTotals(ctx.db, input.id, input.lines, {
          vatMode,
          vatRate,
          currency,
          exchangeRate,
        })
        Object.assign(updates, totals)
      } else if (input.currency !== undefined || input.vatMode !== undefined) {
        const existing = await ctx.db
          .select()
          .from(salesDocumentLines)
          .where(eq(salesDocumentLines.documentId, input.id))
          .orderBy(asc(salesDocumentLines.position))
        const totals = await computeAndPersistTotals(
          ctx.db,
          input.id,
          existing.map((line) => ({
            serviceItemId: line.serviceItemId,
            priceSource: line.priceSource as LineInput['priceSource'],
            description: line.description,
            quantity: parseFloat(line.quantity) || 0,
            unitPrice: parseFloat(line.unitPrice) || 0,
            discountPercent: line.discountPercent ? parseFloat(line.discountPercent) : null,
            vatApplicable: Boolean(line.vatApplicable),
          })),
          { vatMode, vatRate, currency, exchangeRate }
        )
        Object.assign(updates, totals)
      }

      await ctx.db.update(salesDocuments).set(updates).where(eq(salesDocuments.id, input.id))
      return { ok: true }
    }),

  issue: protectedProcedure
    .input(z.object({ id: z.string().min(1), allocationNumber: z.string().nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const doc = await loadDocument(ctx.db, input.id)
      assertDraft(doc)

      const docType = doc.docType as SalesDocumentType

      if (requiresReference(docType)) {
        if (!doc.relatedDocumentId) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'חשבונית זיכוי חייבת להפנות לחשבונית מס שהונפקה',
          })
        }
        const [source] = await ctx.db
          .select()
          .from(salesDocuments)
          .where(eq(salesDocuments.id, doc.relatedDocumentId))
        if (!source || source.status !== 'issued') {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'חשבונית המקור לזיכוי לא נמצאה או שטרם הונפקה',
          })
        }
      }

      if (requiresPayment(docType)) {
        const payments = await ctx.db
          .select()
          .from(salesDocumentPayments)
          .where(eq(salesDocumentPayments.documentId, input.id))
        if (payments.length === 0) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: 'יש להוסיף לפחות תשלום אחד לפני ההנפקה',
          })
        }
      }

      requireExchangeRate(doc.currency, doc.exchangeRate ? parseFloat(doc.exchangeRate) : null)

      const profile = await getBusinessProfile(ctx.db)
      const docNumber = await allocateNumber(ctx.db, docType)
      const now = new Date().toISOString()

      const updates: Record<string, unknown> = {
        docNumber,
        numberPrefix: profile.numberPrefix ?? null,
        status: 'issued',
        issuedAt: now,
        updatedAt: now,
        issuerJson: JSON.stringify(buildIssuerSnapshot(profile)),
      }
      if (input.allocationNumber !== undefined) updates.allocationNumber = input.allocationNumber

      let vatEntryId: string | null = null
      // Credit notes are skipped: vat.create rejects negative amounts, so a credit
      // has to be recorded manually in the VAT tab.
      const syncsToVat = docType === 'tax_invoice' || docType === 'tax_invoice_receipt'
      if (syncsToVat && !doc.vatEntryId) {
        const amount = parseFloat(doc.totalIls) || 0
        if (amount > 0) {
          const { year, period } = periodFromDate(doc.issueDate)
          vatEntryId = newId('ve')
          await ctx.db.insert(vatEntries).values({
            id: vatEntryId,
            year,
            period,
            taxCode: '1',
            category: 'הכנסות',
            entryType: 'income',
            date: doc.issueDate,
            invoiceNumber: String(docNumber),
            description: doc.clientName ?? 'הכנסה ממסמך מכירה',
            amount: String(amount),
            isVatExempt: doc.vatMode !== 'standard' ? 1 : 0,
            deductionPercent: '1',
            salesDocumentId: doc.id,
            createdAt: now,
          })
          updates.vatEntryId = vatEntryId
        }
      }

      if (doc.relatedDocumentId && docType === 'credit_invoice') {
        await ctx.db
          .update(salesDocuments)
          .set({ creditedByDocumentId: doc.id, updatedAt: now })
          .where(eq(salesDocuments.id, doc.relatedDocumentId))
      }

      await ctx.db.update(salesDocuments).set(updates).where(eq(salesDocuments.id, input.id))
      return { id: input.id, docNumber, vatEntryId }
    }),

  setAllocationNumber: protectedProcedure
    .input(z.object({ id: z.string().min(1), allocationNumber: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await loadDocument(ctx.db, input.id)
      await ctx.db
        .update(salesDocuments)
        .set({ allocationNumber: input.allocationNumber, updatedAt: new Date().toISOString() })
        .where(eq(salesDocuments.id, input.id))
      return { ok: true }
    }),

  setInternalNotes: protectedProcedure
    .input(z.object({ id: z.string().min(1), internalNotes: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      await loadDocument(ctx.db, input.id)
      await ctx.db
        .update(salesDocuments)
        .set({ internalNotes: input.internalNotes, updatedAt: new Date().toISOString() })
        .where(eq(salesDocuments.id, input.id))
      return { ok: true }
    }),

  addPayment: protectedProcedure
    .input(z.object({ documentId: z.string().min(1) }).merge(paymentInput))
    .mutation(async ({ ctx, input }) => {
      await loadDocument(ctx.db, input.documentId)
      const id = newId('sdp')
      await ctx.db.insert(salesDocumentPayments).values({
        id,
        documentId: input.documentId,
        method: input.method,
        amount: String(input.amount),
        paidDate: input.paidDate,
        reference: input.reference ?? null,
        bankDetails: input.bankDetails ?? null,
        createdAt: new Date().toISOString(),
      })
      return { id }
    }),

  removePayment: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(salesDocumentPayments).where(eq(salesDocumentPayments.id, input.id))
    return { ok: true }
  }),

  cancel: protectedProcedure
    .input(z.object({ id: z.string().min(1), reason: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const doc = await loadDocument(ctx.db, input.id)
      if (!canCancel(doc.docType as SalesDocumentType)) {
        throw new TRPCError({
          code: 'CONFLICT',
          message: 'מסמך מס לא ניתן לביטול — יש להנפיק חשבונית זיכוי',
        })
      }
      const now = new Date().toISOString()
      await ctx.db
        .update(salesDocuments)
        .set({ status: 'cancelled', cancelledAt: now, cancelReason: input.reason, updatedAt: now })
        .where(eq(salesDocuments.id, input.id))
      return { ok: true }
    }),

  createCreditFor: protectedProcedure
    .input(z.object({ taxInvoiceId: z.string().min(1), reason: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const source = await loadDocument(ctx.db, input.taxInvoiceId)
      if (!isTaxDocument(source.docType as SalesDocumentType)) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'ניתן לזכות רק מסמך מס' })
      }
      if (source.status !== 'issued') {
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'ניתן לזכות רק מסמך שהונפק' })
      }

      const sourceLines = await ctx.db
        .select()
        .from(salesDocumentLines)
        .where(eq(salesDocumentLines.documentId, source.id))
        .orderBy(asc(salesDocumentLines.position))

      const id = newId('sd')
      const now = new Date().toISOString()
      await ctx.db.insert(salesDocuments).values({
        id,
        docType: 'credit_invoice',
        status: 'draft',
        language: source.language,
        issueDate: now.slice(0, 10),
        companyId: source.companyId,
        personId: source.personId,
        clientName: source.clientName,
        clientTaxId: source.clientTaxId,
        clientAddress: source.clientAddress,
        clientCountry: source.clientCountry,
        clientEmail: source.clientEmail,
        clientPhone: source.clientPhone,
        currency: source.currency,
        exchangeRate: source.exchangeRate,
        vatMode: source.vatMode,
        vatRate: source.vatRate,
        notes: input.reason ?? null,
        relatedDocumentId: source.id,
        createdAt: now,
        updatedAt: now,
      })

      const totals = await computeAndPersistTotals(
        ctx.db,
        id,
        sourceLines.map((line) => ({
          serviceItemId: line.serviceItemId,
          priceSource: line.priceSource as LineInput['priceSource'],
          description: line.description,
          quantity: parseFloat(line.quantity) || 0,
          unitPrice: parseFloat(line.unitPrice) || 0,
          discountPercent: line.discountPercent ? parseFloat(line.discountPercent) : null,
          vatApplicable: Boolean(line.vatApplicable),
        })),
        {
          vatMode: source.vatMode,
          vatRate: parseFloat(source.vatRate) || 0,
          currency: source.currency,
          exchangeRate: source.exchangeRate ? parseFloat(source.exchangeRate) : 1,
        }
      )
      await ctx.db.update(salesDocuments).set(totals).where(eq(salesDocuments.id, id))
      return { id }
    }),

  convert: protectedProcedure
    .input(
      z.object({ id: z.string().min(1), targetType: z.enum(SALES_DOCUMENT_TYPES) })
    )
    .mutation(async ({ ctx, input }) => {
      const source = await loadDocument(ctx.db, input.id)
      const allowed = allowedConversions(source.docType as SalesDocumentType)
      if (!allowed.includes(input.targetType)) {
        throw new TRPCError({
          code: 'BAD_REQUEST',
          message: 'המרה זו אינה מותרת עבור סוג המסמך',
        })
      }

      const sourceLines = await ctx.db
        .select()
        .from(salesDocumentLines)
        .where(eq(salesDocumentLines.documentId, source.id))
        .orderBy(asc(salesDocumentLines.position))

      const id = newId('sd')
      const now = new Date().toISOString()
      await ctx.db.insert(salesDocuments).values({
        id,
        docType: input.targetType,
        status: 'draft',
        language: source.language,
        issueDate: now.slice(0, 10),
        companyId: source.companyId,
        personId: source.personId,
        clientName: source.clientName,
        clientTaxId: source.clientTaxId,
        clientAddress: source.clientAddress,
        clientCountry: source.clientCountry,
        clientEmail: source.clientEmail,
        clientPhone: source.clientPhone,
        currency: source.currency,
        exchangeRate: source.exchangeRate,
        vatMode: source.vatMode,
        vatRate: source.vatRate,
        notes: source.notes,
        relatedDocumentId: source.status === 'issued' ? source.id : null,
        createdAt: now,
        updatedAt: now,
      })

      const totals = await computeAndPersistTotals(
        ctx.db,
        id,
        sourceLines.map((line) => ({
          serviceItemId: line.serviceItemId,
          priceSource: line.priceSource as LineInput['priceSource'],
          description: line.description,
          quantity: parseFloat(line.quantity) || 0,
          unitPrice: parseFloat(line.unitPrice) || 0,
          discountPercent: line.discountPercent ? parseFloat(line.discountPercent) : null,
          vatApplicable: Boolean(line.vatApplicable),
        })),
        {
          vatMode: source.vatMode,
          vatRate: parseFloat(source.vatRate) || 0,
          currency: source.currency,
          exchangeRate: source.exchangeRate ? parseFloat(source.exchangeRate) : 1,
        }
      )
      await ctx.db.update(salesDocuments).set(totals).where(eq(salesDocuments.id, id))
      return { id }
    }),

  duplicate: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const source = await loadDocument(ctx.db, input.id)
    const sourceLines = await ctx.db
      .select()
      .from(salesDocumentLines)
      .where(eq(salesDocumentLines.documentId, source.id))
      .orderBy(asc(salesDocumentLines.position))

    const id = newId('sd')
    const now = new Date().toISOString()
    await ctx.db.insert(salesDocuments).values({
      id,
      docType: source.docType,
      status: 'draft',
      language: source.language,
      issueDate: now.slice(0, 10),
      companyId: source.companyId,
      personId: source.personId,
      clientName: source.clientName,
      clientTaxId: source.clientTaxId,
      clientAddress: source.clientAddress,
      clientCountry: source.clientCountry,
      clientEmail: source.clientEmail,
      clientPhone: source.clientPhone,
      currency: source.currency,
      exchangeRate: source.exchangeRate,
      vatMode: source.vatMode,
      vatRate: source.vatRate,
      notes: source.notes,
      createdAt: now,
      updatedAt: now,
    })

    const totals = await computeAndPersistTotals(
      ctx.db,
      id,
      sourceLines.map((line) => ({
        serviceItemId: line.serviceItemId,
        priceSource: line.priceSource as LineInput['priceSource'],
        description: line.description,
        quantity: parseFloat(line.quantity) || 0,
        unitPrice: parseFloat(line.unitPrice) || 0,
        discountPercent: line.discountPercent ? parseFloat(line.discountPercent) : null,
        vatApplicable: Boolean(line.vatApplicable),
      })),
      {
        vatMode: source.vatMode,
        vatRate: parseFloat(source.vatRate) || 0,
        currency: source.currency,
        exchangeRate: source.exchangeRate ? parseFloat(source.exchangeRate) : 1,
      }
    )
    await ctx.db.update(salesDocuments).set(totals).where(eq(salesDocuments.id, id))
    return { id }
  }),

  remove: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    const doc = await loadDocument(ctx.db, input.id)
    if (doc.status !== 'draft') {
      throw new TRPCError({
        code: 'CONFLICT',
        message: 'לא ניתן למחוק מסמך שהונפק',
      })
    }
    await ctx.db.delete(salesDocumentLines).where(eq(salesDocumentLines.documentId, input.id))
    await ctx.db.delete(salesDocumentPayments).where(eq(salesDocumentPayments.documentId, input.id))
    await ctx.db.delete(salesDocuments).where(eq(salesDocuments.id, input.id))
    return { ok: true }
  }),

  summary: protectedProcedure
    .input(z.object({ year: z.number().int() }))
    .query(async ({ ctx, input }) => {
      const rows = await ctx.db
        .select()
        .from(salesDocuments)
        .where(
          and(
            gte(salesDocuments.issueDate, `${input.year}-01-01`),
            lte(salesDocuments.issueDate, `${input.year}-12-31`)
          )
        )

      const byType: Record<string, { count: number; total: number }> = {}
      let issuedTotalIls = 0
      for (const row of rows) {
        const bucket = (byType[row.docType] ??= { count: 0, total: 0 })
        bucket.count += 1
        bucket.total = round2(bucket.total + (parseFloat(row.total) || 0))
        if (row.status === 'issued' && row.docType !== 'credit_invoice') {
          issuedTotalIls = round2(issuedTotalIls + (parseFloat(row.totalIls) || 0))
        }
      }
      return { byType, issuedTotalIls, count: rows.length }
    }),
})

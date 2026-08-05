import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { companies, people } from '@ak-system/database'
import { eq, or, like, asc } from 'drizzle-orm'

const idInput = z.object({ id: z.string().min(1) })

const companyFields = {
  name: z.string().min(1),
  nameEn: z.string().nullable().optional(),
  taxId: z.string().nullable().optional(),
  taxIdType: z.enum(['osek_morshe', 'osek_patur', 'company', 'foreign', 'other']).optional(),
  address: z.string().nullable().optional(),
  city: z.string().nullable().optional(),
  zipCode: z.string().nullable().optional(),
  country: z.string().optional(),
  preferredLanguage: z.enum(['he', 'en']).optional(),
  phone: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
}

export const companiesRouter = router({
  list: protectedProcedure
    .input(
      z
        .object({
          search: z.string().optional(),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .optional()
    )
    .query(async ({ ctx, input }) => {
      const search = input?.search?.trim()
      const rows = await ctx.db
        .select()
        .from(companies)
        .where(
          search
            ? or(
                like(companies.name, `%${search}%`),
                like(companies.nameEn, `%${search}%`),
                like(companies.taxId, `%${search}%`)
              )
            : undefined
        )
        .orderBy(asc(companies.name))
        .limit(input?.limit ?? 200)
      return rows
    }),

  get: protectedProcedure.input(idInput).query(async ({ ctx, input }) => {
    const [company] = await ctx.db.select().from(companies).where(eq(companies.id, input.id))
    if (!company) return null
    const contacts = await ctx.db
      .select()
      .from(people)
      .where(eq(people.companyId, input.id))
      .orderBy(asc(people.name))
    return { company, contacts }
  }),

  create: protectedProcedure
    .input(z.object(companyFields))
    .mutation(async ({ ctx, input }) => {
      const id = 'co' + Date.now() + Math.random().toString(36).slice(2, 7)
      const now = new Date().toISOString()
      await ctx.db.insert(companies).values({
        id,
        name: input.name,
        nameEn: input.nameEn ?? null,
        taxId: input.taxId ?? null,
        taxIdType: input.taxIdType ?? 'company',
        address: input.address ?? null,
        city: input.city ?? null,
        zipCode: input.zipCode ?? null,
        country: input.country ?? 'IL',
        preferredLanguage: input.preferredLanguage ?? 'he',
        phone: input.phone ?? null,
        email: input.email ?? null,
        website: input.website ?? null,
        notes: input.notes ?? null,
        createdAt: now,
        updatedAt: now,
      })
      return { id }
    }),

  update: protectedProcedure
    .input(
      z.object({
        id: z.string().min(1),
        ...companyFields,
        name: z.string().min(1).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { id, ...fields } = input
      const updates: Record<string, unknown> = {}
      for (const key of Object.keys(fields) as (keyof typeof fields)[]) {
        if (fields[key] !== undefined) updates[key] = fields[key]
      }
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date().toISOString()
        await ctx.db.update(companies).set(updates).where(eq(companies.id, id))
      }
      return { ok: true }
    }),

  remove: protectedProcedure.input(idInput).mutation(async ({ ctx, input }) => {
    await ctx.db.delete(companies).where(eq(companies.id, input.id))
    return { ok: true }
  }),

  /** Attach or detach a contact — mirrors the free-text `people.company` for legacy views. */
  setContactCompany: protectedProcedure
    .input(z.object({ personId: z.string().min(1), companyId: z.string().nullable() }))
    .mutation(async ({ ctx, input }) => {
      let companyName: string | null = null
      if (input.companyId) {
        const [company] = await ctx.db
          .select()
          .from(companies)
          .where(eq(companies.id, input.companyId))
        companyName = company?.name ?? null
      }
      await ctx.db
        .update(people)
        .set({ companyId: input.companyId, ...(companyName ? { company: companyName } : {}) })
        .where(eq(people.id, input.personId))
      return { ok: true }
    }),
})

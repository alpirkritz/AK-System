/**
 * CFO Router — Personal CFO & Financial Intelligence Module
 *
 * Exposes all deterministic calculation engines + LLM narrative layer.
 * All procedures are protected (require auth).
 */

import { z } from 'zod'
import { router, protectedProcedure } from '../trpc'
import { getDb, financeDebts, financePensionPolicies, financeCfoReports, financeTransactions } from '@ak-system/database'
import { eq, and } from '@ak-system/database'
import { TRPCError } from '@trpc/server'

// Import all calculation engines
import { sanitizePii, deduplicateAggregateCharges } from '../services/cfo-pii-sanitizer'
import { computeBaseline } from '../services/cfo-profiler'
import { analyzeLeaks, generateNegotiationLetter } from '../services/cfo-leak-hunter'
import { computeAvalanche } from '../services/cfo-debt-avalanche'
import { computeLiquiditySweep } from '../services/cfo-liquidity-sweep'
import { auditPensionPolicies } from '../services/cfo-pension-audit'
import { performMonthlyReview } from '../services/cfo-monthly-review'
import { generateCfoNarrative, hashInput } from '../services/cfo-narrative'
import { computeRecurring } from '../services/cashflow-analytics'

export const cfoRouter = router({
  // ─── Profile & Baseline ───────────────────────────────────────────────────

  getProfile: protectedProcedure.query(async ({ ctx }) => {
    const db = getDb()
    
    // Fetch last 12 months transactions
    const txns = await db.select().from(financeTransactions).all()
    
    // Get historical min balance (simplified - would need bank_accounts query)
    const historicalMin = 5000 // placeholder
    
    const profile = computeBaseline(
      txns.map((t) => ({
        amount: parseFloat(t.amount),
        direction: t.direction as 'income' | 'expense',
        category: t.category || null,
        description: t.description || null,
        transactionDate: t.transactionDate,
      })),
      historicalMin
    )

    return profile
  }),

  // ─── Leak Hunter ──────────────────────────────────────────────────────────

  runLeakHunter: protectedProcedure
    .input(z.object({ forceRefresh: z.boolean().optional() }))
    .query(async ({ ctx, input }) => {
      const db = getDb()
      
      // Fetch transactions and compute recurring
      const txns = await db.select().from(financeTransactions).all()
      const recurring = computeRecurring(
        txns.map((t) => ({
          amount: parseFloat(t.amount),
          direction: t.direction as 'income' | 'expense',
          category: t.category || null,
          description: t.description || null,
          transactionDate: t.transactionDate,
        }))
      )

      const leakResult = analyzeLeaks(recurring)

      // Generate narrative
      let narrative = null
      if (process.env.GEMINI_API_KEY && !input.forceRefresh) {
        try {
          narrative = await generateCfoNarrative({
            context: 'leak',
            facts: {
              totalLeaks: leakResult.leaks.length,
              potentialSavings: leakResult.totalPotentialSavings,
              bankFees: leakResult.totalBankFees,
            },
          })
        } catch (e) {
          // Silent fail - return data without narrative
        }
      }

      return {
        ...leakResult,
        narrative,
      }
    }),

  // ─── Debt Management ──────────────────────────────────────────────────────

  listDebts: protectedProcedure.query(async ({ ctx }) => {
    const db = getDb()
    const debts = await db.select().from(financeDebts).where(eq(financeDebts.userId, ctx.session.user.id)).all()
    return debts.map((d) => ({
      ...d,
      balance: parseFloat(d.balance),
      apr: parseFloat(d.apr),
      minPayment: parseFloat(d.minPayment),
    }))
  }),

  upsertDebt: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        name: z.string().min(1),
        balance: z.number().positive(),
        apr: z.number().min(0).max(1),
        minPayment: z.number().positive(),
        debtType: z.enum(['overdraft', 'credit_loan', 'installment']),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb()
      const id = input.id || `debt-${Date.now()}`

      const debt = {
        id,
        userId: ctx.session.user.id,
        name: input.name,
        balance: input.balance.toString(),
        apr: input.apr.toString(),
        minPayment: input.minPayment.toString(),
        debtType: input.debtType,
        createdAt: new Date().toISOString(),
      }

      if (input.id) {
        await db.update(financeDebts).set(debt).where(eq(financeDebts.id, input.id)).run()
      } else {
        await db.insert(financeDebts).values(debt).run()
      }

      return { id }
    }),

  deleteDebt: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb()
      await db.delete(financeDebts).where(and(eq(financeDebts.id, input.id), eq(financeDebts.userId, ctx.session.user.id))).run()
      return { success: true }
    }),

  getDebtPlan: protectedProcedure
    .input(z.object({ monthlySurplus: z.number().positive() }))
    .query(async ({ ctx, input }) => {
      const db = getDb()
      const debts = await db.select().from(financeDebts).where(eq(financeDebts.userId, ctx.session.user.id)).all()

      const result = computeAvalanche(
        debts.map((d) => ({
          id: d.id,
          name: d.name,
          balance: parseFloat(d.balance),
          apr: parseFloat(d.apr),
          minPayment: parseFloat(d.minPayment),
          debtType: d.debtType as any,
        })),
        input.monthlySurplus
      )

      return result
    }),

  // ─── Liquidity Sweep ──────────────────────────────────────────────────────

  getLiquidityPlan: protectedProcedure
    .input(
      z.object({
        currentBalance: z.number(),
        nominalDepositRate: z.number().min(0).max(0.2).default(0.04),
        mmfRealRate: z.number().min(0).max(0.1).default(0.015),
        projectedInflation: z.number().min(0).max(0.2).default(0.02),
      })
    )
    .query(async ({ ctx, input }) => {
      const db = getDb()
      
      // Get baseline profile first
      const txns = await db.select().from(financeTransactions).all()
      const profile = computeBaseline(
        txns.map((t) => ({
          amount: parseFloat(t.amount),
          direction: t.direction as 'income' | 'expense',
          category: t.category || null,
          description: t.description || null,
          transactionDate: t.transactionDate,
        })),
        5000
      )

      const result = computeLiquiditySweep(
        input.currentBalance,
        profile,
        input.nominalDepositRate,
        input.mmfRealRate,
        input.projectedInflation
      )

      return result
    }),

  // ─── Pension Audit ────────────────────────────────────────────────────────

  listPensionPolicies: protectedProcedure.query(async ({ ctx }) => {
    const db = getDb()
    const policies = await db.select().from(financePensionPolicies).where(eq(financePensionPolicies.userId, ctx.session.user.id)).all()
    return policies.map((p) => ({
      ...p,
      balance: parseFloat(p.balance),
      depositFeePct: parseFloat(p.depositFeePct),
      accumFeePct: parseFloat(p.accumFeePct),
      monthlyDeposit: parseFloat(p.monthlyDeposit),
    }))
  }),

  upsertPensionPolicy: protectedProcedure
    .input(
      z.object({
        id: z.string().optional(),
        provider: z.string().min(1),
        policyType: z.enum(['pension', 'keren_hishtalmut', 'gemel_lehaskaa', 'bituach_managers']),
        balance: z.number().nonnegative(),
        depositFeePct: z.number().min(0).max(0.1),
        accumFeePct: z.number().min(0).max(0.1),
        monthlyDeposit: z.number().nonnegative(),
        retirementAge: z.number().int().min(60).max(70).default(67),
        isActive: z.boolean().default(true),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const db = getDb()
      const id = input.id || `pension-${Date.now()}`

      const policy = {
        id,
        userId: ctx.session.user.id,
        provider: input.provider,
        policyType: input.policyType,
        balance: input.balance.toString(),
        depositFeePct: input.depositFeePct.toString(),
        accumFeePct: input.accumFeePct.toString(),
        monthlyDeposit: input.monthlyDeposit.toString(),
        retirementAge: input.retirementAge,
        isActive: input.isActive ? 1 : 0,
        createdAt: new Date().toISOString(),
      }

      if (input.id) {
        await db.update(financePensionPolicies).set(policy).where(eq(financePensionPolicies.id, input.id)).run()
      } else {
        await db.insert(financePensionPolicies).values(policy).run()
      }

      return { id }
    }),

  deletePensionPolicy: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const db = getDb()
      await db.delete(financePensionPolicies).where(and(eq(financePensionPolicies.id, input.id), eq(financePensionPolicies.userId, ctx.session.user.id))).run()
      return { success: true }
    }),

  getPensionAudit: protectedProcedure
    .input(z.object({ userAge: z.number().int().min(18).max(67) }))
    .query(async ({ ctx, input }) => {
      const db = getDb()
      const policies = await db.select().from(financePensionPolicies).where(eq(financePensionPolicies.userId, ctx.session.user.id)).all()

      const result = auditPensionPolicies(
        policies.map((p) => ({
          id: p.id,
          provider: p.provider,
          policyType: p.policyType as any,
          balance: parseFloat(p.balance),
          depositFeePct: parseFloat(p.depositFeePct),
          accumFeePct: parseFloat(p.accumFeePct),
          monthlyDeposit: parseFloat(p.monthlyDeposit),
          retirementAge: p.retirementAge,
          isActive: p.isActive === 1,
        })),
        input.userAge
      )

      return result
    }),

  // ─── Monthly Review ───────────────────────────────────────────────────────

  getMonthlyReview: protectedProcedure
    .input(z.object({ month: z.string() }))
    .query(async ({ ctx, input }) => {
      const db = getDb()
      
      const txns = await db.select().from(financeTransactions).all()
      const profile = computeBaseline(
        txns.map((t) => ({
          amount: parseFloat(t.amount),
          direction: t.direction as 'income' | 'expense',
          category: t.category || null,
          description: t.description || null,
          transactionDate: t.transactionDate,
        })),
        5000
      )

      const result = performMonthlyReview(
        txns.map((t) => ({
          amount: parseFloat(t.amount),
          direction: t.direction as 'income' | 'expense',
          category: t.category || null,
          description: t.description || null,
          transactionDate: t.transactionDate,
        })),
        50000, // placeholder current balance
        profile,
        input.month,
        null, // debt-free month (would need debts query)
        0 // fee drag (would need pension query)
      )

      return result
    }),

  // ─── Sanitizer ────────────────────────────────────────────────────────────

  sanitizeUpload: protectedProcedure
    .input(z.object({ text: z.string() }))
    .mutation(async ({ input }) => {
      return sanitizePii(input.text)
    }),
})

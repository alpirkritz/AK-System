import { describe, test, expect } from 'vitest'
import { computeAvalanche, type Debt } from './cfo-debt-avalanche'

describe('cfo-debt-avalanche', () => {
  describe('computeAvalanche', () => {
    test('handles empty debt list', () => {
      const result = computeAvalanche([], 500)
      expect(result.debtFreeMonth).toBe(0)
      expect(result.totalInterestPaid).toBe(0)
      expect(result.timeline).toHaveLength(0)
    })

    test('warns when surplus < total minimum payments', () => {
      const debts: Debt[] = [
        {
          id: '1',
          name: 'Overdraft',
          balance: 10000,
          apr: 0.15,
          minPayment: 500,
          debtType: 'overdraft',
        },
      ]

      const result = computeAvalanche(debts, 300) // less than 500 min
      expect(result.warning).toContain('אינו מספיק')
      expect(result.debtFreeMonth).toBe(0)
    })

    test('pays off single debt correctly', () => {
      const debts: Debt[] = [
        {
          id: '1',
          name: 'Credit loan',
          balance: 5000,
          apr: 0.12, // 12% annual = 1% monthly
          minPayment: 200,
          debtType: 'credit_loan',
        },
      ]

      const result = computeAvalanche(debts, 500) // 500 total, 200 min, 300 surplus
      expect(result.debtFreeMonth).toBeGreaterThan(0)
      expect(result.debtFreeMonth).toBeLessThan(20) // should pay off in < 20 months
      expect(result.totalInterestPaid).toBeGreaterThan(0)
      expect(result.interestSaved).toBeGreaterThan(0)

      // Verify final month shows $0 balance
      const finalPayments = result.timeline.filter((t) => t.month === result.debtFreeMonth)
      const finalDebt = finalPayments.find((t) => t.debtId === '1')
      expect(finalDebt?.remainingBalance).toBeLessThan(0.02) // effectively 0
    })

    test('prioritizes highest APR debt (avalanche)', () => {
      const debts: Debt[] = [
        {
          id: 'low',
          name: 'Low APR',
          balance: 5000,
          apr: 0.05, // 5%
          minPayment: 100,
          debtType: 'credit_loan',
        },
        {
          id: 'high',
          name: 'High APR',
          balance: 5000,
          apr: 0.20, // 20%
          minPayment: 100,
          debtType: 'credit_loan',
        },
      ]

      const result = computeAvalanche(debts, 500) // 500 total, 200 min, 300 surplus

      // Find first month where surplus is applied
      const month1Payments = result.timeline.filter((t) => t.month === 1)
      const highAprPayment = month1Payments.find((t) => t.debtId === 'high')
      const lowAprPayment = month1Payments.find((t) => t.debtId === 'low')

      // High APR should receive surplus (principal > min)
      expect(highAprPayment).toBeDefined()
      expect(highAprPayment!.principalPaid).toBeGreaterThan(100) // more than min

      // Low APR should receive only minimum
      expect(lowAprPayment).toBeDefined()
      expect(lowAprPayment!.principalPaid).toBeLessThanOrEqual(100) // only min
    })

    test('moves to next debt after first is paid off', () => {
      const debts: Debt[] = [
        {
          id: 'small',
          name: 'Small debt',
          balance: 500,
          apr: 0.15,
          minPayment: 50,
          debtType: 'credit_loan',
        },
        {
          id: 'large',
          name: 'Large debt',
          balance: 10000,
          apr: 0.10,
          minPayment: 200,
          debtType: 'credit_loan',
        },
      ]

      const result = computeAvalanche(debts, 600) // 600 total, 250 min, 350 surplus

      // Small debt should be paid off quickly (balance 500, surplus 350/month)
      const smallDebtFinalMonth = result.timeline
        .filter((t) => t.debtId === 'small')
        .reduce((max, t) => Math.max(max, t.month), 0)

      expect(smallDebtFinalMonth).toBeLessThanOrEqual(3) // paid off in ≤3 months

      // After small debt is gone, large debt should receive all surplus
      const monthAfterSmall = smallDebtFinalMonth + 1
      const largeDebtPayment = result.timeline.find(
        (t) => t.month === monthAfterSmall && t.debtId === 'large'
      )

      expect(largeDebtPayment).toBeDefined()
      expect(largeDebtPayment!.principalPaid).toBeGreaterThan(200) // receives surplus now
    })

    test('computes interest saved vs baseline', () => {
      const debts: Debt[] = [
        {
          id: '1',
          name: 'Debt',
          balance: 10000,
          apr: 0.12,
          minPayment: 300,
          debtType: 'credit_loan',
        },
      ]

      const resultMin = computeAvalanche(debts, 300) // only minimum
      const resultSurplus = computeAvalanche(debts, 500) // 200 surplus

      // With surplus, should finish faster and pay less interest
      expect(resultSurplus.debtFreeMonth).toBeLessThan(resultMin.debtFreeMonth)
      expect(resultSurplus.totalInterestPaid).toBeLessThan(resultMin.totalInterestPaid)
      expect(resultSurplus.interestSaved).toBeGreaterThan(0)
    })

    test('handles zero surplus (minimum payments only)', () => {
      const debts: Debt[] = [
        {
          id: '1',
          name: 'Debt',
          balance: 5000,
          apr: 0.10,
          minPayment: 200,
          debtType: 'credit_loan',
        },
      ]

      const result = computeAvalanche(debts, 200) // exactly minimum
      expect(result.debtFreeMonth).toBeGreaterThan(0) // eventually pays off
      expect(result.interestSaved).toBe(0) // no savings, just baseline
    })

    test('does not run forever on impossible debt', () => {
      // Overdraft where min payment < interest accrual
      const debts: Debt[] = [
        {
          id: '1',
          name: 'Bad overdraft',
          balance: 10000,
          apr: 0.24, // 24% annual = 2% monthly = 200 ₪/month interest
          minPayment: 150, // less than interest
          debtType: 'overdraft',
        },
      ]

      const result = computeAvalanche(debts, 150) // only minimum
      expect(result.debtFreeMonth).toBe(0) // never paid off
      expect(result.warning).toContain('600 חודשים')
    })
  })
})

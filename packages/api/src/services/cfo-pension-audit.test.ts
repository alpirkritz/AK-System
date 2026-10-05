import { describe, test, expect } from 'vitest'
import { auditPolicy, auditPensionPolicies, type PensionPolicy } from './cfo-pension-audit'

describe('cfo-pension-audit', () => {
  describe('auditPolicy', () => {
    test('flags policy with fees above benchmark', () => {
      const policy: PensionPolicy = {
        id: '1',
        provider: 'מיטב דש',
        policyType: 'pension',
        balance: 100000,
        depositFeePct: 0.015, // 1.5% > 1.0% benchmark
        accumFeePct: 0.003, // 0.3% > 0.22% benchmark
        monthlyDeposit: 2000,
        retirementAge: 67,
        isActive: true,
      }

      const result = auditPolicy(policy, 40) // 27 years to retirement
      expect(result.overBenchmark).toBe(true)
      expect(result.depositFeeExcess).toBeGreaterThan(0)
      expect(result.accumFeeExcess).toBeGreaterThan(0)
      expect(result.lifetimeFeeDrag).toBeGreaterThan(0)
      expect(result.recommendation).toContain('עמלות מעל תקרה')
    })

    test('approves policy with fees at or below benchmark', () => {
      const policy: PensionPolicy = {
        id: '1',
        provider: 'הראל',
        policyType: 'pension',
        balance: 100000,
        depositFeePct: 0.01, // exactly at 1.0%
        accumFeePct: 0.0022, // exactly at 0.22%
        monthlyDeposit: 2000,
        retirementAge: 67,
        isActive: true,
      }

      const result = auditPolicy(policy, 40)
      expect(result.overBenchmark).toBe(false)
      expect(result.lifetimeFeeDrag).toBe(0)
      expect(result.recommendation).toContain('בתקן')
    })

    test('flags inactive policy', () => {
      const policy: PensionPolicy = {
        id: '1',
        provider: 'מגדל',
        policyType: 'keren_hishtalmut',
        balance: 50000,
        depositFeePct: 0.01,
        accumFeePct: 0.0022,
        monthlyDeposit: 0,
        retirementAge: 67,
        isActive: false,
      }

      const result = auditPolicy(policy, 40)
      expect(result.recommendation).toContain('לא פעיל')
    })
  })

  describe('auditPensionPolicies', () => {
    test('computes total fee drag across policies', () => {
      const policies: PensionPolicy[] = [
        {
          id: '1',
          provider: 'מיטב דש',
          policyType: 'pension',
          balance: 100000,
          depositFeePct: 0.015,
          accumFeePct: 0.003,
          monthlyDeposit: 2000,
          retirementAge: 67,
          isActive: true,
        },
        {
          id: '2',
          provider: 'הראל',
          policyType: 'keren_hishtalmut',
          balance: 50000,
          depositFeePct: 0.01,
          accumFeePct: 0.0022,
          monthlyDeposit: 1000,
          retirementAge: 67,
          isActive: true,
        },
      ]

      const result = auditPensionPolicies(policies, 40)
      expect(result.policies).toHaveLength(2)
      expect(result.totalFeeDrag).toBeGreaterThan(0)
    })

    test('detects duplicate policies', () => {
      const policies: PensionPolicy[] = [
        {
          id: '1',
          provider: 'מיטב דש',
          policyType: 'pension',
          balance: 100000,
          depositFeePct: 0.01,
          accumFeePct: 0.0022,
          monthlyDeposit: 2000,
          retirementAge: 67,
          isActive: true,
        },
        {
          id: '2',
          provider: 'מיטב דש',
          policyType: 'pension', // duplicate!
          balance: 50000,
          depositFeePct: 0.01,
          accumFeePct: 0.0022,
          monthlyDeposit: 1000,
          retirementAge: 67,
          isActive: true,
        },
      ]

      const result = auditPensionPolicies(policies, 40)
      expect(result.duplicateWarnings).toHaveLength(1)
      expect(result.duplicateWarnings[0]).toContain('מיטב דש')
    })

    test('generates formal letter for over-benchmark policies', () => {
      const policies: PensionPolicy[] = [
        {
          id: '1',
          provider: 'מיטב דש',
          policyType: 'pension',
          balance: 100000,
          depositFeePct: 0.015,
          accumFeePct: 0.003,
          monthlyDeposit: 2000,
          retirementAge: 67,
          isActive: true,
        },
      ]

      const result = auditPensionPolicies(policies, 40)
      expect(result.formalLetterTemplate).toContain('לכבוד')
      expect(result.formalLetterTemplate).toContain('מיטב דש')
      expect(result.formalLetterTemplate).toContain('תקרות')
    })
  })
})

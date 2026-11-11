import { describe, test, expect } from 'vitest'
import {
  partitionLiquidity,
  compareTaxYield,
  computeLiquiditySweep,
  type BaselineProfile,
} from './cfo-liquidity-sweep'

describe('cfo-liquidity-sweep', () => {
  const mockBaseline: BaselineProfile = {
    fixed: 10000, // 10k fixed
    variable: 5000, // 5k variable
    minBalanceCushion: 2000, // 2k cushion
  }

  describe('partitionLiquidity', () => {
    test('Layer 1 = monthly expenses + cushion', () => {
      const result = partitionLiquidity(50000, mockBaseline)
      // L1 = 10k + 5k + 2k = 17k
      expect(result.layer1).toBe(17000)
    })

    test('Layer 2 = 4 months of fixed expenses (default)', () => {
      const balance = 100000
      const result = partitionLiquidity(balance, mockBaseline)
      // L2 = 10k × 4 = 40k
      expect(result.layer2).toBe(40000)
    })

    test('Layer 3 = remainder after L1 + L2', () => {
      const balance = 100000
      const result = partitionLiquidity(balance, mockBaseline)
      // L1 = 17k, L2 = 40k → L3 = 100k - 17k - 40k = 43k
      expect(result.layer3).toBe(43000)
    })

    test('warns when balance < Layer 1', () => {
      const result = partitionLiquidity(10000, mockBaseline)
      expect(result.recommendation).toContain('אזהרה')
      expect(result.layer1).toBeGreaterThan(10000)
    })

    test('warns when emergency fund not fully covered', () => {
      const result = partitionLiquidity(30000, mockBaseline) // L1=17k, L2 target=40k
      expect(result.recommendation).toContain('קרן חירום')
    })

    test('reports success when all layers covered', () => {
      const result = partitionLiquidity(100000, mockBaseline)
      expect(result.recommendation).toContain('כל השכבות מכוסות')
    })

    test('respects custom emergency months multiplier', () => {
      const result = partitionLiquidity(100000, mockBaseline, 6) // 6 months instead of 4
      expect(result.layer2).toBe(60000) // 10k × 6
    })
  })

  describe('compareTaxYield', () => {
    test('deposit wins when inflation < break-even', () => {
      const result = compareTaxYield(
        0.04, // 4% deposit
        0.015, // 1.5% MMF real
        0.015 // 1.5% inflation (below 4% × 0.4 = 1.6% break-even)
      )
      expect(result.winner).toBe('deposit')
      expect(result.breakEvenInflation).toBeCloseTo(0.016) // 4% × 0.4
    })

    test('MMF wins when inflation >= break-even', () => {
      const result = compareTaxYield(
        0.04, // 4% deposit
        0.015, // 1.5% MMF real
        0.025 // 2.5% inflation (above 1.6% break-even)
      )
      expect(result.winner).toBe('mmf')
    })

    test('computes net yields correctly', () => {
      const result = compareTaxYield(0.04, 0.015, 0.02)
      // Deposit net = 4% × (1 - 0.15) = 3.4%
      expect(result.depositNetYield).toBeCloseTo(0.034)
      // MMF net = 1.5% × (1 - 0.25) + 2% = 1.125% + 2% = 3.125%
      expect(result.mmfNetYield).toBeCloseTo(0.03125)
    })

    test('explanation includes percentages', () => {
      const result = compareTaxYield(0.04, 0.015, 0.02)
      expect(result.explanation).toContain('%')
      expect(result.explanation).toContain('break-even')
    })
  })

  describe('computeLiquiditySweep', () => {
    test('returns partition + tax comparison', () => {
      const result = computeLiquiditySweep(
        100000, // balance
        mockBaseline,
        0.04, // deposit rate
        0.015, // MMF real
        0.02 // inflation
      )
      expect(result.partition).toBeDefined()
      expect(result.taxComparison).toBeDefined()
      expect(result.partition.layer1).toBe(17000)
    })

    test('warns when balance < min cushion', () => {
      const result = computeLiquiditySweep(1000, mockBaseline, 0.04, 0.015, 0.02)
      expect(result.warning).toContain('מינימום')
    })

    test('warns when emergency fund not covered', () => {
      const result = computeLiquiditySweep(20000, mockBaseline, 0.04, 0.015, 0.02)
      expect(result.warning).toContain('חירום')
    })

    test('no warning when all layers covered', () => {
      const result = computeLiquiditySweep(100000, mockBaseline, 0.04, 0.015, 0.02)
      expect(result.warning).toBeNull()
    })
  })
})

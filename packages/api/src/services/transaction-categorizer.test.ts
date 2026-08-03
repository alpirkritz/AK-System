import { describe, it, expect } from 'vitest'
import {
  categorizeByKeywords,
  categorizeByRules,
  categorizeTransaction,
  suggestRulePattern,
} from './transaction-categorizer'

describe('categorizeByKeywords', () => {
  it('matches Israeli supermarket names to food', () => {
    expect(categorizeByKeywords('סופר יוחננוף', 'expense')).toBe('מזון')
    expect(categorizeByKeywords('רמי לוי שיווק', 'expense')).toBe('מזון')
  })

  it('reads a credit-card charge as internal movement, not a purchase', () => {
    expect(categorizeByKeywords('כרטיס אשראי ויזה', 'expense')).toBe('כרטיס אשראי')
    expect(categorizeByKeywords('ישראכרט חיוב חודשי', 'expense')).toBe('כרטיס אשראי')
  })

  it('recognises the commitments that dominate bank-level statements', () => {
    expect(categorizeByKeywords('החזר משכנתא', 'expense')).toBe('משכנתא')
    expect(categorizeByKeywords('הלוואה בנקאית', 'expense')).toBe('הלוואות')
    expect(categorizeByKeywords('הפקדה לפיקדון', 'expense')).toBe('חיסכון והשקעות')
  })

  it('prefers salary over the generic transfer rule', () => {
    expect(categorizeByKeywords('העברת משכורת', 'income')).toBe('משכורת')
  })

  it('falls back to a distinct label for unrecognised income', () => {
    expect(categorizeByKeywords('זיכוי לא מזוהה', 'income')).toBe('הכנסה אחרת')
  })

  it('falls back to אחר for unrecognised expense', () => {
    expect(categorizeByKeywords('משהו לא מזוהה', 'expense')).toBe('אחר')
  })

  it('handles empty and missing descriptions', () => {
    expect(categorizeByKeywords('', 'expense')).toBe('אחר')
    expect(categorizeByKeywords('', 'income')).toBe('הכנסה אחרת')
  })

  it('is case-insensitive for Latin merchant names', () => {
    expect(categorizeByKeywords('NETFLIX.COM', 'expense')).toBe('מנויים')
  })

  it('does not apply an income-only rule to an expense', () => {
    expect(categorizeByKeywords('משכורת', 'expense')).not.toBe('משכורת')
  })
})

describe('categorizeByRules', () => {
  const rules = [{ pattern: 'קפה נמרוד', category: 'אוכל בחוץ' }]

  it('matches on a case-folded substring', () => {
    expect(categorizeByRules('תשלום ל קפה נמרוד בעיר', rules)).toBe('אוכל בחוץ')
  })

  it('returns null when nothing matches so callers can fall through', () => {
    expect(categorizeByRules('סופר', rules)).toBeNull()
  })

  it('honours a direction-scoped rule', () => {
    const scoped = [{ pattern: 'ביט', category: 'העברות', direction: 'expense' as const }]
    expect(categorizeByRules('העברה ביט', scoped, 'expense')).toBe('העברות')
    expect(categorizeByRules('העברה ביט', scoped, 'income')).toBeNull()
  })

  it('ignores an empty pattern rather than matching everything', () => {
    expect(categorizeByRules('כל דבר', [{ pattern: '', category: 'מזון' }])).toBeNull()
  })
})

describe('categorizeTransaction', () => {
  it('a user rule overrides the built-in keyword verdict', () => {
    const rules = [{ pattern: 'סופר יוחננוף', category: 'אחר' }]
    expect(categorizeByKeywords('סופר יוחננוף', 'expense')).toBe('מזון')
    expect(categorizeTransaction('סופר יוחננוף', rules, 'expense')).toBe('אחר')
  })

  it('falls back to keywords with no rules present', () => {
    expect(categorizeTransaction('סופר יוחננוף', [], 'expense')).toBe('מזון')
  })
})

describe('suggestRulePattern', () => {
  it('drops digits and keeps the leading merchant words', () => {
    expect(suggestRulePattern('סופר יוחננוף סניף 1234')).toBe('סופר יוחננוף סניף')
  })

  it('caps the pattern at three words so it stays general', () => {
    expect(suggestRulePattern('אחת שתיים שלוש ארבע חמש')).toBe('אחת שתיים שלוש')
  })

  it('does not produce an empty pattern from a digits-only description', () => {
    expect(suggestRulePattern('12345')).not.toBe('')
  })
})

import { describe, it, expect } from 'vitest'
import {
  isDuplicateCategoryLabel,
  mergeFinanceCategories,
  normalizeCategoryLabel,
  resolveCustomCategoryColor,
} from './finance-categories'

describe('finance-categories', () => {
  it('merges built-in and custom categories', () => {
    const merged = mergeFinanceCategories([
      { id: 'fcc1', label: 'חיות מחמד', color: '#f59e0b', kind: 'expense' },
    ])
    expect(merged.some((c) => c.label === 'מזון' && c.builtin)).toBe(true)
    expect(merged.some((c) => c.label === 'חיות מחמד' && !c.builtin)).toBe(true)
  })

  it('rejects duplicate built-in labels', () => {
    expect(isDuplicateCategoryLabel('מזון', [])).toBe(true)
    expect(isDuplicateCategoryLabel('  מזון  ', [])).toBe(true)
  })

  it('rejects duplicate custom labels', () => {
    expect(
      isDuplicateCategoryLabel('חיות מחמד', [
        { id: 'x', label: 'חיות מחמד', color: '#fff', kind: 'expense' },
      ]),
    ).toBe(true)
  })

  it('normalizes whitespace in labels', () => {
    expect(normalizeCategoryLabel('  חיות   מחמד ')).toBe('חיות מחמד')
  })

  it('falls back to default color for invalid hex', () => {
    expect(resolveCustomCategoryColor('not-a-color')).toBe('#647399')
    expect(resolveCustomCategoryColor('#aabbcc')).toBe('#aabbcc')
  })
})

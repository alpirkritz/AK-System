import { describe, it, expect, beforeEach } from 'vitest'
import { getTestDb, createTestCaller } from '../test-utils'
import { financeCustomCategories } from '@ak-system/database'

async function reset() {
  const db = getTestDb()
  await db.delete(financeCustomCategories)
}

describe('finance custom categories', () => {
  beforeEach(reset)

  it('lists built-in and custom categories', async () => {
    const caller = await createTestCaller()
    const created = await caller.finance.createCustomCategory({
      label: 'חיות מחמד',
      kind: 'expense',
      color: '#f59e0b',
    })
    expect(created.category.label).toBe('חיות מחמד')
    expect(created.category.builtin).toBe(false)

    const list = await caller.finance.listCategories()
    expect(list.categories.some((c) => c.label === 'מזון' && c.builtin)).toBe(true)
    expect(list.categories.some((c) => c.label === 'חיות מחמד' && !c.builtin)).toBe(true)
  })

  it('rejects duplicate built-in label', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.finance.createCustomCategory({ label: 'מזון', kind: 'expense' }),
    ).rejects.toThrow(/קיימת/)
  })

  it('deletes custom category', async () => {
    const caller = await createTestCaller()
    const { category } = await caller.finance.createCustomCategory({
      label: 'גינון',
      kind: 'expense',
    })
    await caller.finance.deleteCustomCategory({ id: category.id! })
    const list = await caller.finance.listCategories()
    expect(list.categories.some((c) => c.label === 'גינון')).toBe(false)
  })
})

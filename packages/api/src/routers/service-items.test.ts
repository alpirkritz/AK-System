import { describe, it, expect, beforeEach } from 'vitest'
import {
  getDb,
  companies,
  companyItemPrices,
  salesDocuments,
  salesDocumentLines,
  salesDocumentPayments,
  salesDocumentCounters,
  serviceItems,
} from '@ak-system/database'
import { createTestCaller } from '../test-utils'

beforeEach(async () => {
  const db = getDb()
  await db.delete(salesDocumentPayments)
  await db.delete(salesDocumentLines)
  await db.delete(salesDocuments)
  await db.delete(salesDocumentCounters)
  await db.delete(companyItemPrices)
  await db.delete(serviceItems)
  await db.delete(companies)
})

async function seedCatalogItem(caller: Awaited<ReturnType<typeof createTestCaller>>, price = 1000) {
  const { id } = await caller.serviceItems.create({
    name: 'הרצאה',
    unit: 'session',
    defaultUnitPrice: price,
  })
  return id
}

describe('service items catalog', () => {
  it('creates an active item with the catalog default price', async () => {
    const caller = await createTestCaller()
    const id = await seedCatalogItem(caller, 2500)
    const [item] = await caller.serviceItems.list()
    expect(item.id).toBe(id)
    expect(item.defaultUnitPrice).toBe('2500')
    expect(item.isActive).toBeTruthy()
  })

  it('archives instead of deleting, and hides archived items by default', async () => {
    const caller = await createTestCaller()
    const id = await seedCatalogItem(caller)
    await caller.serviceItems.archive({ id })

    expect(await caller.serviceItems.list()).toHaveLength(0)
    expect(await caller.serviceItems.list({ includeInactive: true })).toHaveLength(1)
  })
})

describe('pricesForClient', () => {
  it('falls back to the catalog default for a client with no history', async () => {
    const caller = await createTestCaller()
    const itemId = await seedCatalogItem(caller, 1000)
    const { id: companyId } = await caller.companies.create({ name: 'לקוח חדש' })

    const prices = await caller.serviceItems.pricesForClient({ companyId })
    expect(prices[itemId].unitPrice).toBe(1000)
    expect(prices[itemId].source).toBe('catalog')
  })

  it('returns the price last charged to this client on an issued document', async () => {
    const caller = await createTestCaller()
    const itemId = await seedCatalogItem(caller, 1000)
    const { id: companyId } = await caller.companies.create({ name: 'לקוח חוזר' })

    const { id: docId } = await caller.salesDocuments.createDraft({
      docType: 'tax_invoice',
      companyId,
      issueDate: '2026-05-01',
      lines: [
        { serviceItemId: itemId, description: 'הרצאה', quantity: 1, unitPrice: 1200 },
      ],
    })
    await caller.salesDocuments.issue({ id: docId })

    const prices = await caller.serviceItems.pricesForClient({ companyId })
    expect(prices[itemId].unitPrice).toBe(1200)
    expect(prices[itemId].source).toBe('history')
    expect(prices[itemId].lastDocumentId).toBe(docId)
  })

  it('ignores drafts — only what was actually invoiced counts as history', async () => {
    const caller = await createTestCaller()
    const itemId = await seedCatalogItem(caller, 1000)
    const { id: companyId } = await caller.companies.create({ name: 'לקוח עם טיוטה' })

    await caller.salesDocuments.createDraft({
      docType: 'tax_invoice',
      companyId,
      issueDate: '2026-05-01',
      lines: [{ serviceItemId: itemId, description: 'הרצאה', quantity: 1, unitPrice: 9999 }],
    })

    const prices = await caller.serviceItems.pricesForClient({ companyId })
    expect(prices[itemId].source).toBe('catalog')
  })

  it('does not leak one client price to another client', async () => {
    const caller = await createTestCaller()
    const itemId = await seedCatalogItem(caller, 1000)
    const { id: clientA } = await caller.companies.create({ name: 'לקוח א' })
    const { id: clientB } = await caller.companies.create({ name: 'לקוח ב' })

    const { id: docId } = await caller.salesDocuments.createDraft({
      docType: 'tax_invoice',
      companyId: clientA,
      issueDate: '2026-05-01',
      lines: [{ serviceItemId: itemId, description: 'הרצאה', quantity: 1, unitPrice: 1200 }],
    })
    await caller.salesDocuments.issue({ id: docId })

    const pricesB = await caller.serviceItems.pricesForClient({ companyId: clientB })
    expect(pricesB[itemId].unitPrice).toBe(1000)
    expect(pricesB[itemId].source).toBe('catalog')
  })

  it('lets a pinned rate override history', async () => {
    const caller = await createTestCaller()
    const itemId = await seedCatalogItem(caller, 1000)
    const { id: companyId } = await caller.companies.create({ name: 'לקוח עם הסכם' })

    const { id: docId } = await caller.salesDocuments.createDraft({
      docType: 'tax_invoice',
      companyId,
      issueDate: '2026-05-01',
      lines: [{ serviceItemId: itemId, description: 'הרצאה', quantity: 1, unitPrice: 1200 }],
    })
    await caller.salesDocuments.issue({ id: docId })
    await caller.serviceItems.pinPrice({ companyId, serviceItemId: itemId, unitPrice: 1500 })

    const prices = await caller.serviceItems.pricesForClient({ companyId })
    expect(prices[itemId].unitPrice).toBe(1500)
    expect(prices[itemId].source).toBe('pinned')
  })

  it('pins idempotently and unpins back to history', async () => {
    const caller = await createTestCaller()
    const itemId = await seedCatalogItem(caller, 1000)
    const { id: companyId } = await caller.companies.create({ name: 'לקוח' })

    await caller.serviceItems.pinPrice({ companyId, serviceItemId: itemId, unitPrice: 1500 })
    await caller.serviceItems.pinPrice({ companyId, serviceItemId: itemId, unitPrice: 1600 })
    const pinned = await caller.serviceItems.listPinned({ companyId })
    expect(pinned).toHaveLength(1)
    expect(pinned[0].unitPrice).toBe('1600')

    await caller.serviceItems.unpinPrice({ companyId, serviceItemId: itemId })
    expect(await caller.serviceItems.listPinned({ companyId })).toHaveLength(0)
  })

  it('flags a shekel price used on a dollar document instead of converting it', async () => {
    const caller = await createTestCaller()
    const itemId = await seedCatalogItem(caller, 1000)
    const { id: companyId } = await caller.companies.create({ name: 'Globex', country: 'US' })

    const prices = await caller.serviceItems.pricesForClient({ companyId, currency: 'USD' })
    expect(prices[itemId].currencyMismatch).toBe(true)
  })
})

import { describe, it, expect, beforeEach } from 'vitest'
import { getDb, companies, people } from '@ak-system/database'
import { createTestCaller } from '../test-utils'

beforeEach(async () => {
  const db = getDb()
  await db.delete(companies)
  await db.delete(people)
})

describe('companies router', () => {
  it('creates a company with Israeli defaults and lists it', async () => {
    const caller = await createTestCaller()
    const { id } = await caller.companies.create({ name: 'לקוח בדיקה' })

    const rows = await caller.companies.list()
    const created = rows.find((row) => row.id === id)
    expect(created).toBeTruthy()
    expect(created!.country).toBe('IL')
    expect(created!.preferredLanguage).toBe('he')
    expect(created!.taxIdType).toBe('company')
  })

  it('searches by name and by tax id', async () => {
    const caller = await createTestCaller()
    await caller.companies.create({ name: 'Northwind', taxId: '515151515' })
    await caller.companies.create({ name: 'Contoso', taxId: '999999999' })

    expect((await caller.companies.list({ search: 'North' })).map((r) => r.name)).toEqual([
      'Northwind',
    ])
    expect((await caller.companies.list({ search: '9999' })).map((r) => r.name)).toEqual(['Contoso'])
  })

  it('stores a foreign client so documents default to English', async () => {
    const caller = await createTestCaller()
    const { id } = await caller.companies.create({
      name: 'Globex Inc.',
      country: 'US',
      preferredLanguage: 'en',
      taxIdType: 'foreign',
    })
    const result = await caller.companies.get({ id })
    expect(result!.company.preferredLanguage).toBe('en')
    expect(result!.company.country).toBe('US')
  })

  it('updates only the fields that were sent', async () => {
    const caller = await createTestCaller()
    const { id } = await caller.companies.create({ name: 'Before', city: 'תל אביב' })
    await caller.companies.update({ id, name: 'After' })

    const result = await caller.companies.get({ id })
    expect(result!.company.name).toBe('After')
    expect(result!.company.city).toBe('תל אביב')
  })

  it('links a contact to a company and mirrors the company name', async () => {
    const caller = await createTestCaller()
    const { id: companyId } = await caller.companies.create({ name: 'Acme Ltd' })
    const person = await caller.people.create({ name: 'דנה כהן' })

    await caller.companies.setContactCompany({ personId: person.id, companyId })

    const result = await caller.companies.get({ id: companyId })
    expect(result!.contacts.map((c) => c.id)).toEqual([person.id])
    const [updated] = await getDb().select().from(people)
    expect(updated.company).toBe('Acme Ltd')
  })

  it('detaches a contact without deleting it', async () => {
    const caller = await createTestCaller()
    const { id: companyId } = await caller.companies.create({ name: 'Acme Ltd' })
    const person = await caller.people.create({ name: 'דנה כהן' })
    await caller.companies.setContactCompany({ personId: person.id, companyId })
    await caller.companies.setContactCompany({ personId: person.id, companyId: null })

    const result = await caller.companies.get({ id: companyId })
    expect(result!.contacts).toHaveLength(0)
  })

  it('removes a company', async () => {
    const caller = await createTestCaller()
    const { id } = await caller.companies.create({ name: 'Temp' })
    await caller.companies.remove({ id })
    expect(await caller.companies.get({ id })).toBeNull()
  })
})

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { createTestCaller, resetDb } from '../test-utils'

describe('people router', () => {
  beforeEach(async () => {
    await resetDb()
  })

  it('list returns empty array when no people', async () => {
    const caller = await createTestCaller()
    const result = await caller.people.list()
    expect(result).toEqual([])
  })

  it('create adds a person and returns it', async () => {
    const caller = await createTestCaller()
    const created = await caller.people.create({
      name: 'Alice',
      role: 'Developer',
      email: 'alice@example.com',
    })
    expect(created).toBeDefined()
    expect(created!.name).toBe('Alice')
    expect(created!.role).toBe('Developer')
    expect(created!.email).toBe('alice@example.com')
    expect(created!.id).toMatch(/^p\d+$/)
    expect(created!.createdAt).toBeDefined()

    const list = await caller.people.list()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('Alice')
  })

  it('getById returns person when exists', async () => {
    const caller = await createTestCaller()
    const created = await caller.people.create({ name: 'Bob' })
    const found = await caller.people.getById({ id: created!.id })
    expect(found).toBeDefined()
    expect(found!.name).toBe('Bob')
  })

  it('getById returns null when not exists', async () => {
    const caller = await createTestCaller()
    const found = await caller.people.getById({ id: 'p999' })
    expect(found).toBeNull()
  })

  it('update modifies person', async () => {
    const caller = await createTestCaller()
    const created = await caller.people.create({ name: 'Carol' })
    const updated = await caller.people.update({
      id: created!.id,
      name: 'Carol Updated',
      email: 'carol@test.com',
    })
    expect(updated!.name).toBe('Carol Updated')
    expect(updated!.email).toBe('carol@test.com')

    const list = await caller.people.list()
    expect(list[0].name).toBe('Carol Updated')
  })

  it('delete removes person', async () => {
    const caller = await createTestCaller()
    const created = await caller.people.create({ name: 'Dave' })
    await caller.people.delete({ id: created!.id })
    const found = await caller.people.getById({ id: created!.id })
    expect(found).toBeNull()
    const list = await caller.people.list()
    expect(list).toHaveLength(0)
  })

  it('create rejects empty name', async () => {
    const caller = await createTestCaller()
    await expect(caller.people.create({ name: '' })).rejects.toThrow()
  })

  it('create with a phone number auto-enables WhatsApp capture', async () => {
    const caller = await createTestCaller()
    const created = await caller.people.create({ name: 'Erin', phone: '+972501234567' })
    expect(created!.captureWhatsapp).toBe(true)
    expect(created!.captureWhatsappSince).toBeTruthy()
  })

  it('create without a phone number leaves WhatsApp capture off', async () => {
    const caller = await createTestCaller()
    const created = await caller.people.create({ name: 'Frank' })
    expect(created!.captureWhatsapp).toBe(false)
    expect(created!.captureWhatsappSince).toBeFalsy()
  })
})

describe('people notion sources', () => {
  const ENV_PEOPLE_DB = 'peopledb0000000000000000000000000'
  const CUSTOM_ID = 'abcdef01-2345-6789-abcd-ef0123456789'
  const ORIGINAL_ENV = { ...process.env }

  beforeEach(async () => {
    await resetDb()
    process.env.NOTION_ACCOUNTS = JSON.stringify([
      {
        label: 'Test',
        token: 'ntn_test',
        databases: [{ id: ENV_PEOPLE_DB, name: 'People', type: 'people' }],
      },
    ])
  })

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
  })

  it('notionAccounts lists configured labels', async () => {
    const caller = await createTestCaller()
    expect(await caller.people.notionAccounts()).toEqual([{ label: 'Test' }])
  })

  it('notionSources includes the env-configured database as a non-removable "env" source', async () => {
    const caller = await createTestCaller()
    const sources = await caller.people.notionSources()
    expect(sources).toEqual([
      { source: 'env', id: null, accountLabel: 'Test', notionDatabaseId: ENV_PEOPLE_DB, name: 'People' },
    ])
  })

  it('resolveNotionDatabaseLink rejects a link with no extractable id', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.people.resolveNotionDatabaseLink({ accountLabel: 'Test', link: 'not-a-notion-link' }),
    ).rejects.toThrow()
  })

  it('resolveNotionDatabaseLink rejects an account label that is not configured', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.people.resolveNotionDatabaseLink({ accountLabel: 'Nope', link: CUSTOM_ID }),
    ).rejects.toThrow()
  })

  it('resolveNotionDatabaseLink previews a valid, accessible database', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ title: [{ plain_text: 'Custom People' }], properties: {} }),
    } as unknown as Response)))
    const caller = await createTestCaller()
    const result = await caller.people.resolveNotionDatabaseLink({
      accountLabel: 'Test',
      link: `https://www.notion.so/ws/Custom-People-${CUSTOM_ID.replace(/-/g, '')}?v=xyz`,
    })
    expect(result).toEqual({
      notionDatabaseId: CUSTOM_ID,
      name: 'Custom People',
      alreadyAdded: false,
      fieldMappings: {
        phone: { candidates: [], auto: null },
        role: { candidates: [], auto: null },
        company: { candidates: [], auto: null },
        linkedin: { candidates: [], auto: null },
      },
    })
  })

  it('resolveNotionDatabaseLink returns auto-detected field mappings from the database schema', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        title: [{ plain_text: 'Custom People' }],
        properties: {
          Name: { type: 'title' },
          'Phone number': { type: 'phone_number' },
          Role: { type: 'rich_text' },
          Company: { type: 'relation' },
          Linkedin: { type: 'url' },
        },
      }),
    } as unknown as Response)))
    const caller = await createTestCaller()
    const result = await caller.people.resolveNotionDatabaseLink({
      accountLabel: 'Test',
      link: CUSTOM_ID,
    })
    expect(result.fieldMappings).toEqual({
      phone: { candidates: ['Phone number'], auto: 'Phone number' },
      role: { candidates: ['Role'], auto: 'Role' },
      company: { candidates: ['Company'], auto: 'Company' },
      linkedin: { candidates: ['Linkedin'], auto: 'Linkedin' },
    })
  })

  it('resolveNotionDatabaseLink throws when the integration lacks access (non-2xx from Notion)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false,
      status: 404,
      text: async () => 'object_not_found',
    } as unknown as Response)))
    const caller = await createTestCaller()
    await expect(
      caller.people.resolveNotionDatabaseLink({ accountLabel: 'Test', link: CUSTOM_ID }),
    ).rejects.toThrow()
  })

  it('addNotionSource inserts a custom source and rejects re-adding the same id', async () => {
    const caller = await createTestCaller()
    const created = await caller.people.addNotionSource({
      accountLabel: 'Test',
      notionDatabaseId: CUSTOM_ID,
      notionDatabaseName: 'Custom People',
    })
    expect(created.notionDatabaseId).toBe(CUSTOM_ID)

    await expect(
      caller.people.addNotionSource({
        accountLabel: 'Test',
        notionDatabaseId: CUSTOM_ID,
        notionDatabaseName: 'Custom People',
      }),
    ).rejects.toThrow()

    const sources = await caller.people.notionSources()
    expect(sources.find((s) => s.notionDatabaseId === CUSTOM_ID)?.source).toBe('custom')
  })

  it('addNotionSource stores the pinned per-field property names', async () => {
    const caller = await createTestCaller()
    const created = await caller.people.addNotionSource({
      accountLabel: 'Test',
      notionDatabaseId: CUSTOM_ID,
      notionDatabaseName: 'Custom People',
      phonePropertyName: 'Phone number',
      rolePropertyName: null,
      companyPropertyName: 'Contact info',
      linkedinPropertyName: null,
    })
    expect(created.phonePropertyName).toBe('Phone number')
    expect(created.rolePropertyName).toBeNull()
    expect(created.companyPropertyName).toBe('Contact info')
    expect(created.linkedinPropertyName).toBeNull()
  })

  it('addNotionSource rejects a database id that is already configured via env', async () => {
    const caller = await createTestCaller()
    await expect(
      caller.people.addNotionSource({
        accountLabel: 'Test',
        notionDatabaseId: ENV_PEOPLE_DB,
        notionDatabaseName: 'Duplicate',
      }),
    ).rejects.toThrow()
  })

  it('removeNotionSource deletes a custom row', async () => {
    const caller = await createTestCaller()
    const created = await caller.people.addNotionSource({
      accountLabel: 'Test',
      notionDatabaseId: CUSTOM_ID,
      notionDatabaseName: 'Custom People',
    })
    await caller.people.removeNotionSource({ id: created.id })
    const sources = await caller.people.notionSources()
    expect(sources.some((s) => s.notionDatabaseId === CUSTOM_ID)).toBe(false)
  })
})

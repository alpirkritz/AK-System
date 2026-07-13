import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  __resetNotionConfigCache,
  getAssistantTarget,
  getDatabasesByType,
  getNotionAccounts,
  isNotionConfigured,
} from './notion-config'

const ORIGINAL = { ...process.env }

function resetEnv() {
  delete process.env.NOTION_ACCOUNTS
  delete process.env.NOTION_API_KEY
  delete process.env.NOTION_USER_NAME
  __resetNotionConfigCache()
}

beforeEach(resetEnv)
afterEach(() => {
  process.env = { ...ORIGINAL }
  __resetNotionConfigCache()
})

describe('notion-config', () => {
  it('returns no accounts when nothing is configured', () => {
    expect(getNotionAccounts()).toEqual([])
    expect(isNotionConfigured()).toBe(false)
    expect(getAssistantTarget()).toBeNull()
  })

  it('synthesizes a legacy account from NOTION_API_KEY', () => {
    process.env.NOTION_API_KEY = 'ntn_legacy'
    process.env.NOTION_USER_NAME = 'Alpir'
    __resetNotionConfigCache()

    const accounts = getNotionAccounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0].label).toBe('Alpir')
    expect(accounts[0].token).toBe('ntn_legacy')
    // 3 legacy task DBs + 1 assistant DB
    expect(getDatabasesByType('tasks')).toHaveLength(3)
    expect(getDatabasesByType('assistant')).toHaveLength(1)
    expect(getAssistantTarget()).toEqual({
      token: 'ntn_legacy',
      databaseId: '325e7d50-cb8e-80c1-9046-f71dbdf75f9f',
    })
  })

  it('parses multi-account NOTION_ACCOUNTS and groups databases by type', () => {
    process.env.NOTION_ACCOUNTS = JSON.stringify([
      {
        label: 'Personal',
        token: 'ntn_a',
        databases: [
          { id: 'p-tasks', name: 'Personal To-do', type: 'tasks' },
          { id: 'p-meet', name: 'Meetings', type: 'meetings' },
          { id: 'p-inbox', name: 'Inbox', type: 'assistant' },
        ],
      },
      {
        label: 'DAZ',
        token: 'ntn_b',
        databases: [{ id: 'd-tasks', name: 'DT Actions', type: 'tasks' }],
      },
    ])
    __resetNotionConfigCache()

    const accounts = getNotionAccounts()
    expect(accounts).toHaveLength(2)
    expect(isNotionConfigured()).toBe(true)

    const tasks = getDatabasesByType('tasks')
    expect(tasks.map((t) => t.database.id).sort()).toEqual(['d-tasks', 'p-tasks'])
    expect(getDatabasesByType('meetings')).toHaveLength(1)
    expect(getAssistantTarget()).toEqual({ token: 'ntn_a', databaseId: 'p-inbox' })
  })

  it('parses the extended db types (people/projects/companies/meeting_notes)', () => {
    process.env.NOTION_ACCOUNTS = JSON.stringify([
      {
        label: 'Work',
        token: 'ntn_w',
        databases: [
          { id: 'ppl', name: 'People', type: 'people' },
          { id: 'prj', name: 'Projects', type: 'projects' },
          { id: 'cmp', name: 'Companies', type: 'companies' },
          { id: 'notes', name: 'AI Meeting Notes', type: 'meeting_notes' },
        ],
      },
    ])
    __resetNotionConfigCache()

    expect(getDatabasesByType('people').map((d) => d.database.id)).toEqual(['ppl'])
    expect(getDatabasesByType('projects').map((d) => d.database.id)).toEqual(['prj'])
    expect(getDatabasesByType('companies').map((d) => d.database.id)).toEqual(['cmp'])
    expect(getDatabasesByType('meeting_notes').map((d) => d.database.id)).toEqual(['notes'])
  })

  it('defaults db type to tasks and name to id when omitted', () => {
    process.env.NOTION_ACCOUNTS = JSON.stringify([
      { label: 'X', token: 'ntn_x', databases: [{ id: 'only-id' }] },
    ])
    __resetNotionConfigCache()

    const [db] = getDatabasesByType('tasks')
    expect(db.database).toEqual({ id: 'only-id', name: 'only-id', type: 'tasks' })
  })

  it('falls back to legacy account when NOTION_ACCOUNTS is invalid JSON', () => {
    process.env.NOTION_ACCOUNTS = '{not json'
    process.env.NOTION_API_KEY = 'ntn_legacy'
    __resetNotionConfigCache()

    const accounts = getNotionAccounts()
    expect(accounts).toHaveLength(1)
    expect(accounts[0].token).toBe('ntn_legacy')
  })

  it('falls back to legacy when an account is missing a token', () => {
    process.env.NOTION_ACCOUNTS = JSON.stringify([{ label: 'NoToken', databases: [] }])
    process.env.NOTION_API_KEY = 'ntn_legacy'
    __resetNotionConfigCache()

    expect(getNotionAccounts()[0].token).toBe('ntn_legacy')
  })
})

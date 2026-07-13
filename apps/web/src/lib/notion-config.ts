/**
 * Notion account/database configuration.
 *
 * Supports multiple Notion accounts, each with its own integration token and a
 * set of typed databases. Configured via the `NOTION_ACCOUNTS` env var (JSON):
 *
 *   NOTION_ACCOUNTS='[
 *     {"label":"Personal","token":"ntn_xxx","databases":[
 *       {"id":"181e7d50-...","name":"Personal To-do","type":"tasks"},
 *       {"id":"a1b2c3d4-...","name":"Meetings","type":"meetings"}
 *     ]},
 *     {"label":"DAZ","token":"ntn_yyy","databases":[ ... ]}
 *   ]'
 *
 * Backward compatible: if `NOTION_ACCOUNTS` is not set but `NOTION_API_KEY` is,
 * a single legacy account is synthesized from the historical hardcoded database
 * IDs so existing deployments keep working unchanged.
 */

export type NotionDbType =
  | 'tasks'
  | 'meetings'
  | 'assistant'
  | 'ibkr_transactions'
  | 'people'
  | 'projects'
  | 'companies'
  | 'meeting_notes'

export interface NotionDatabaseConfig {
  id: string
  name: string
  type: NotionDbType
}

export interface NotionAccountConfig {
  label: string
  token: string
  databases: NotionDatabaseConfig[]
}

const DB_TYPES: NotionDbType[] = [
  'tasks',
  'meetings',
  'assistant',
  'ibkr_transactions',
  'people',
  'projects',
  'companies',
  'meeting_notes',
]

/** Historical task databases (single legacy account). */
const LEGACY_TASK_DATABASES: NotionDatabaseConfig[] = [
  { id: '181e7d50-cb8e-8101-9d8a-e90aa8f9b3ac', name: 'Personal To-do', type: 'tasks' },
  { id: 'a38dba80-f058-4009-b8d9-bce763f10542', name: 'DT - Action items', type: 'tasks' },
  { id: '20fe7d50-cb8e-805a-9730-cfb2b6e2bfe6', name: 'Con Action items', type: 'tasks' },
]

/** Historical Assistant DB — used for the Notion Inbox notification. */
const LEGACY_ASSISTANT_DATABASE: NotionDatabaseConfig = {
  id: '325e7d50-cb8e-80c1-9046-f71dbdf75f9f',
  name: 'Assistant Inbox',
  type: 'assistant',
}

let cached: { accounts: NotionAccountConfig[]; raw: string | undefined } | null = null

function parseAccountsEnv(raw: string): NotionAccountConfig[] {
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch (err) {
    throw new Error(
      `NOTION_ACCOUNTS is not valid JSON: ${err instanceof Error ? err.message : 'parse error'}`,
    )
  }
  if (!Array.isArray(data)) {
    throw new Error('NOTION_ACCOUNTS must be a JSON array of accounts')
  }

  const accounts: NotionAccountConfig[] = []
  data.forEach((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`NOTION_ACCOUNTS[${i}] must be an object`)
    }
    const e = entry as Record<string, unknown>
    const token = typeof e.token === 'string' ? e.token.trim() : ''
    if (!token) throw new Error(`NOTION_ACCOUNTS[${i}].token is required`)
    const label = typeof e.label === 'string' && e.label.trim() ? e.label.trim() : `Account ${i + 1}`
    const rawDbs = Array.isArray(e.databases) ? e.databases : []
    const databases: NotionDatabaseConfig[] = []
    rawDbs.forEach((d, j) => {
      const db = (d ?? {}) as Record<string, unknown>
      const id = typeof db.id === 'string' ? db.id.trim() : ''
      if (!id) throw new Error(`NOTION_ACCOUNTS[${i}].databases[${j}].id is required`)
      const type = typeof db.type === 'string' && DB_TYPES.includes(db.type as NotionDbType)
        ? (db.type as NotionDbType)
        : 'tasks'
      const name = typeof db.name === 'string' && db.name.trim() ? db.name.trim() : id
      databases.push({ id, name, type })
    })
    accounts.push({ label, token, databases })
  })
  return accounts
}

function buildLegacyAccounts(): NotionAccountConfig[] {
  const token = process.env.NOTION_API_KEY?.trim()
  if (!token) return []
  return [
    {
      label: process.env.NOTION_USER_NAME?.trim() || 'Default',
      token,
      databases: [...LEGACY_TASK_DATABASES, LEGACY_ASSISTANT_DATABASE],
    },
  ]
}

/**
 * All configured Notion accounts. Prefers `NOTION_ACCOUNTS`; falls back to a
 * single legacy account built from `NOTION_API_KEY`. Result is cached per raw
 * env value so tests can override the env between calls.
 */
export function getNotionAccounts(): NotionAccountConfig[] {
  const raw = process.env.NOTION_ACCOUNTS?.trim()
  if (cached && cached.raw === raw) return cached.accounts

  let accounts: NotionAccountConfig[]
  if (raw) {
    try {
      accounts = parseAccountsEnv(raw)
    } catch (err) {
      console.warn('[notion-config]', err instanceof Error ? err.message : err, '— falling back to NOTION_API_KEY')
      accounts = buildLegacyAccounts()
    }
  } else {
    accounts = buildLegacyAccounts()
  }

  cached = { accounts, raw }
  return accounts
}

/** True when at least one account with a token is configured. */
export function isNotionConfigured(): boolean {
  return getNotionAccounts().some((a) => a.token)
}

/** Databases of a given type across all accounts, tagged with their account label + token. */
export function getDatabasesByType(
  type: NotionDbType,
): Array<{ accountLabel: string; token: string; database: NotionDatabaseConfig }> {
  const out: Array<{ accountLabel: string; token: string; database: NotionDatabaseConfig }> = []
  for (const account of getNotionAccounts()) {
    for (const database of account.databases) {
      if (database.type === type) {
        out.push({ accountLabel: account.label, token: account.token, database })
      }
    }
  }
  return out
}

/** The Assistant DB target used for Notion Inbox notifications (first configured assistant DB). */
export function getAssistantTarget(): { token: string; databaseId: string } | null {
  const assistant = getDatabasesByType('assistant')[0]
  if (assistant) return { token: assistant.token, databaseId: assistant.database.id }
  return null
}

/** Reset the internal cache — for tests. */
export function __resetNotionConfigCache(): void {
  cached = null
}

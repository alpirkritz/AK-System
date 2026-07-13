/**
 * One-time (and repeatable) historical import of IBKR transactions from the
 * Notion "📈 IBKR Transactions" database into `finance_trades`.
 *
 * Self-contained: reads Notion config from env (`NOTION_ACCOUNTS` with a
 * database of type `ibkr_transactions`, or `NOTION_IBKR_DATABASE_ID` +
 * `NOTION_API_KEY`) so it does not depend on the web app's Notion client.
 * Dedupes by Notion page id and by email subject, so re-running is safe and it
 * won't re-insert trades already imported from Gmail.
 */

import { getDb, financeTrades } from '@ak-system/database'

const NOTION_VERSION = '2022-06-28'

type Db = ReturnType<typeof getDb>
type NotionProp = Record<string, unknown>

interface NotionIbkrDatabase {
  token: string
  databaseId: string
  name: string
}

export interface NotionImportResult {
  inserted: number
  skipped: number
  failed: number
  errors: string[]
}

export function isNotionIbkrConfigured(): boolean {
  return resolveIbkrDatabases().length > 0
}

function resolveIbkrDatabases(): NotionIbkrDatabase[] {
  const out: NotionIbkrDatabase[] = []
  const raw = process.env.NOTION_ACCOUNTS?.trim()
  if (raw) {
    try {
      const data = JSON.parse(raw) as unknown
      if (Array.isArray(data)) {
        for (const acc of data as Array<Record<string, unknown>>) {
          const token = typeof acc?.token === 'string' ? acc.token.trim() : ''
          if (!token) continue
          const dbs = Array.isArray(acc?.databases) ? (acc.databases as Array<Record<string, unknown>>) : []
          for (const db of dbs) {
            if (db?.type === 'ibkr_transactions' && typeof db?.id === 'string' && db.id.trim()) {
              out.push({
                token,
                databaseId: db.id.trim(),
                name: typeof db.name === 'string' ? db.name : 'IBKR Transactions',
              })
            }
          }
        }
      }
    } catch {
      // fall through to direct env
    }
  }
  if (out.length === 0) {
    const directId = process.env.NOTION_IBKR_DATABASE_ID?.trim()
    const directToken = process.env.NOTION_API_KEY?.trim()
    if (directId && directToken) {
      out.push({ token: directToken, databaseId: directId, name: 'IBKR Transactions' })
    }
  }
  return out
}

async function queryDatabase(
  token: string,
  databaseId: string,
): Promise<Array<{ id: string; properties: Record<string, NotionProp> }>> {
  const pages: Array<{ id: string; properties: Record<string, NotionProp> }> = []
  let cursor: string | undefined
  do {
    const body: Record<string, unknown> = { page_size: 100 }
    if (cursor) body.start_cursor = cursor
    const res = await fetch(`https://api.notion.com/v1/databases/${databaseId}/query`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Notion-Version': NOTION_VERSION,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.text()
      throw new Error(`Notion API ${res.status}: ${err.slice(0, 200)}`)
    }
    const data = (await res.json()) as {
      results: Array<{ id: string; properties: Record<string, NotionProp> }>
      has_more: boolean
      next_cursor: string | null
    }
    pages.push(...data.results)
    cursor = data.has_more ? data.next_cursor ?? undefined : undefined
  } while (cursor)
  return pages
}

function findProp(props: Record<string, NotionProp>, names: string[]): NotionProp | undefined {
  for (const [key, value] of Object.entries(props)) {
    const lower = key.toLowerCase()
    if (names.some((n) => lower === n || lower.includes(n))) return value
  }
  return undefined
}

function getTitle(props: Record<string, NotionProp>): string {
  for (const value of Object.values(props)) {
    if (value?.type === 'title') {
      return ((value.title as Array<{ plain_text?: string }>) ?? [])
        .map((x) => x.plain_text ?? '')
        .join('')
        .trim()
    }
  }
  return ''
}

function propToString(prop: NotionProp | undefined): string {
  if (!prop || typeof prop !== 'object') return ''
  const t = prop.type as string
  if (t === 'title') return ((prop.title as Array<{ plain_text?: string }>) ?? []).map((x) => x.plain_text ?? '').join('')
  if (t === 'rich_text') return ((prop.rich_text as Array<{ plain_text?: string }>) ?? []).map((x) => x.plain_text ?? '').join('')
  if (t === 'select' && prop.select) return (prop.select as { name?: string }).name ?? ''
  if (t === 'status' && prop.status) return (prop.status as { name?: string }).name ?? ''
  if (t === 'number' && prop.number != null) return String(prop.number)
  if (t === 'date' && prop.date) return (prop.date as { start?: string }).start ?? ''
  return ''
}

function propToNumber(prop: NotionProp | undefined): number | null {
  if (!prop || typeof prop !== 'object') return null
  if (prop.type === 'number' && typeof prop.number === 'number') return prop.number
  const str = propToString(prop).replace(/[$€£₪,]/g, '').trim()
  if (!str) return null
  const n = parseFloat(str)
  return Number.isFinite(n) ? n : null
}

function propToDateIso(prop: NotionProp | undefined): string {
  const raw = propToString(prop)
  if (!raw) return ''
  const d = new Date(raw)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString()
}

function resolveDirection(action: string): 'buy' | 'sell' {
  const lower = action.toLowerCase()
  if (lower.includes('buy') || lower.includes('bought') || lower.includes('bot') ||
      lower.includes('קני') || lower.includes('נקנה')) return 'buy'
  return 'sell'
}

export async function importIBKRFromNotion(
  opts: { dryRun?: boolean } = {},
  db: Db = getDb(),
): Promise<NotionImportResult> {
  const databases = resolveIbkrDatabases()
  if (databases.length === 0) {
    throw new Error('לא הוגדר בסיס נתונים של IBKR ב-Notion — הוסף אותו ל-NOTION_ACCOUNTS')
  }

  const existing = await db
    .select({
      notionPageId: financeTrades.notionPageId,
      emailSubject: financeTrades.emailSubject,
    })
    .from(financeTrades)
  const seenPages = new Set<string>()
  const seenSubjects = new Set<string>()
  for (const row of existing) {
    if (row.notionPageId) seenPages.add(row.notionPageId)
    if (row.emailSubject) seenSubjects.add(row.emailSubject)
  }

  const result: NotionImportResult = { inserted: 0, skipped: 0, failed: 0, errors: [] }
  const now = new Date().toISOString()

  for (const database of databases) {
    let pages: Array<{ id: string; properties: Record<string, NotionProp> }>
    try {
      pages = await queryDatabase(database.token, database.databaseId)
    } catch (err) {
      result.errors.push(`${database.name}: ${err instanceof Error ? err.message : 'query failed'}`)
      continue
    }

    for (const page of pages) {
      const props = page.properties
      const subject = getTitle(props)

      if (seenPages.has(page.id) || (subject && seenSubjects.has(subject))) {
        result.skipped++
        continue
      }

      const symbol = propToString(findProp(props, ['symbol', 'ticker'])).toUpperCase().trim()
      const action = propToString(findProp(props, ['action', 'side', 'type', 'buy/sell']))
      const quantity = propToNumber(findProp(props, ['quantity', 'shares', 'qty', 'units']))
      const price = propToNumber(findProp(props, ['price']))

      if (!symbol || quantity == null || price == null || quantity <= 0 || price <= 0) {
        result.failed++
        if (result.errors.length < 20) {
          result.errors.push(`שדות חסרים: "${subject || page.id}"`)
        }
        continue
      }

      const currency = (propToString(findProp(props, ['currency', 'ccy'])) || 'USD').toUpperCase().slice(0, 3)
      const account = propToString(findProp(props, ['account'])) || null
      const sourceDetail = propToString(findProp(props, ['source'])) || null
      const tradeDate = propToDateIso(findProp(props, ['date'])) || now

      if (opts.dryRun) {
        result.inserted++
        seenPages.add(page.id)
        if (subject) seenSubjects.add(subject)
        continue
      }

      const id = 'ft' + Date.now() + Math.random().toString(36).slice(2, 7)
      await db.insert(financeTrades).values({
        id,
        symbol,
        direction: resolveDirection(action),
        quantity: String(quantity),
        price: String(price),
        commission: null,
        currency,
        tradeDate,
        source: 'notion_import',
        rawEmailId: null,
        description: null,
        emailSubject: subject || null,
        actionType: 'trade',
        account,
        sourceDetail,
        notionPageId: page.id,
        importedAt: now,
        createdAt: now,
      })
      seenPages.add(page.id)
      if (subject) seenSubjects.add(subject)
      result.inserted++
    }
  }

  return result
}

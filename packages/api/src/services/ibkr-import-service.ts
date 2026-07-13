/**
 * Deterministic IBKR email import — Gmail → parse → dedupe → insert into
 * `finance_trades`. Shared by the tRPC `syncIBKREmails` mutation and the daily
 * cron trigger, so the import works even when the LLM agent engine is
 * unavailable or overloaded.
 */

import { getDb, financeTrades } from '@ak-system/database'
import { fetchIBKRTrades } from './ibkr-parser'

export interface IbkrImportResult {
  inserted: number
  skipped: number
  total: number
  subjects: string[]
}

type Db = ReturnType<typeof getDb>

/** Dedupe keys for an already-stored trade. */
function dedupeKeys(row: {
  rawEmailId: string | null
  symbol: string
  direction: string
  emailSubject: string | null
}): string[] {
  const keys = [`${row.rawEmailId}|${row.symbol}|${row.direction}`]
  if (row.emailSubject) keys.push(`subj|${row.emailSubject}`)
  return keys
}

export async function importIBKREmails(
  opts: { maxEmails?: number } = {},
  db: Db = getDb(),
): Promise<IbkrImportResult> {
  const maxEmails = opts.maxEmails ?? 100
  const trades = await fetchIBKRTrades(maxEmails)

  const existingRows = await db
    .select({
      rawEmailId: financeTrades.rawEmailId,
      symbol: financeTrades.symbol,
      direction: financeTrades.direction,
      emailSubject: financeTrades.emailSubject,
    })
    .from(financeTrades)

  const seen = new Set<string>()
  for (const row of existingRows) {
    for (const key of dedupeKeys(row)) seen.add(key)
  }

  let inserted = 0
  let skipped = 0
  const subjects: string[] = []
  const now = new Date().toISOString()

  for (const trade of trades) {
    const rowKeys = dedupeKeys({
      rawEmailId: trade.rawEmailId,
      symbol: trade.symbol,
      direction: trade.direction,
      emailSubject: trade.emailSubject ?? null,
    })
    if (rowKeys.some((k) => seen.has(k))) {
      skipped++
      continue
    }

    const id = 'ft' + Date.now() + Math.random().toString(36).slice(2, 7)
    await db.insert(financeTrades).values({
      id,
      symbol: trade.symbol,
      direction: trade.direction,
      quantity: String(trade.quantity),
      price: String(trade.price),
      commission: String(trade.commission),
      currency: trade.currency,
      tradeDate: trade.tradeDate,
      source: 'ibkr_email',
      rawEmailId: trade.rawEmailId,
      description: trade.description ?? null,
      emailSubject: trade.emailSubject ?? null,
      actionType: 'trade',
      account: trade.account ?? null,
      sourceDetail: null,
      notionPageId: null,
      importedAt: now,
      createdAt: now,
    })
    for (const key of rowKeys) seen.add(key)
    if (trade.emailSubject) subjects.push(trade.emailSubject)
    inserted++
  }

  return { inserted, skipped, total: trades.length, subjects }
}

/** Human-readable Hebrew summary of an import run — used by the daily agent. */
export function formatImportReport(result: IbkrImportResult): string {
  if (result.inserted === 0) {
    return result.total === 0
      ? 'לא נמצאו מיילי עסקאות IBKR חדשים בסריקה.'
      : `לא נמצאו עסקאות חדשות לייבוא (${result.skipped} כפולות דולגו).`
  }
  const lines = [
    `יובאו ${result.inserted} עסקאות IBKR חדשות (${result.skipped} כפולות דולגו).`,
  ]
  const preview = result.subjects.slice(0, 15)
  if (preview.length > 0) {
    lines.push('', 'עסקאות שיובאו:')
    for (const subject of preview) lines.push(`• ${subject}`)
    if (result.subjects.length > preview.length) {
      lines.push(`• ...ועוד ${result.subjects.length - preview.length}`)
    }
  }
  return lines.join('\n')
}

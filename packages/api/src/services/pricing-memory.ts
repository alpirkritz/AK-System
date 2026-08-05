import type { PriceSource } from '@ak-system/types'

export type PricedCandidate = {
  unitPrice: number
  currency: string
}

export type HistoricalPrice = PricedCandidate & {
  lastUsedAt: string
  lastDocumentId: string
}

export type ResolvedPrice = {
  unitPrice: number
  currency: string
  source: Exclude<PriceSource, 'manual'>
  /** True when the resolved price is quoted in a currency the document does not use. */
  currencyMismatch: boolean
  lastUsedAt?: string
  lastDocumentId?: string
}

/**
 * One explicit precedence chain: a rate deliberately pinned for the client wins,
 * then the price actually charged on the most recent issued document, then the
 * catalog default. A price in a foreign currency is never converted silently —
 * it is flagged so the UI can ask for a manual amount instead.
 */
export function resolveUnitPrice(input: {
  pinned?: PricedCandidate | null
  lastIssued?: HistoricalPrice | null
  catalogDefault: PricedCandidate
  documentCurrency?: string
}): ResolvedPrice {
  const documentCurrency = input.documentCurrency ?? 'ILS'

  if (input.pinned) {
    return {
      unitPrice: input.pinned.unitPrice,
      currency: input.pinned.currency,
      source: 'pinned',
      currencyMismatch: input.pinned.currency !== documentCurrency,
    }
  }

  if (input.lastIssued) {
    return {
      unitPrice: input.lastIssued.unitPrice,
      currency: input.lastIssued.currency,
      source: 'history',
      currencyMismatch: input.lastIssued.currency !== documentCurrency,
      lastUsedAt: input.lastIssued.lastUsedAt,
      lastDocumentId: input.lastIssued.lastDocumentId,
    }
  }

  return {
    unitPrice: input.catalogDefault.unitPrice,
    currency: input.catalogDefault.currency,
    source: 'catalog',
    currencyMismatch: input.catalogDefault.currency !== documentCurrency,
  }
}

export type HistoryRow = {
  serviceItemId: string | null
  unitPrice: string | number
  currency: string | null
  issueDate: string | null
  documentId: string
}

/**
 * Collapses raw issued-document lines into one entry per catalog item, keeping the
 * most recently issued price. Rows are expected pre-filtered to issued, non-credit
 * documents for the relevant client.
 */
export function pickLatestPerItem(rows: HistoryRow[]): Record<string, HistoricalPrice> {
  const latest: Record<string, HistoricalPrice & { sortKey: string }> = {}

  for (const row of rows) {
    if (!row.serviceItemId) continue
    const sortKey = row.issueDate ?? ''
    const current = latest[row.serviceItemId]
    if (current && current.sortKey >= sortKey) continue
    latest[row.serviceItemId] = {
      unitPrice: typeof row.unitPrice === 'number' ? row.unitPrice : parseFloat(row.unitPrice) || 0,
      currency: row.currency ?? 'ILS',
      lastUsedAt: row.issueDate ?? '',
      lastDocumentId: row.documentId,
      sortKey,
    }
  }

  const result: Record<string, HistoricalPrice> = {}
  for (const [itemId, value] of Object.entries(latest)) {
    const { sortKey: _sortKey, ...rest } = value
    result[itemId] = rest
  }
  return result
}

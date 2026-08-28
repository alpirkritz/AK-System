import { createHash } from 'crypto'
import { and, eq, sql } from 'drizzle-orm'
import { financeTransactions, queryRows } from '@ak-system/database'

type DedupeTxn = { date: string; chargedAmount: number; description: string }

/** Calendar day for dedupe — Visa Cal pending/completed differ by seconds on the same purchase. */
export function normalizeTxnDateForDedupe(isoDate: string): string {
  return isoDate.slice(0, 10)
}

export function normalizeTxnDescriptionForDedupe(description: string): string {
  return description.trim().replace(/\s+/g, ' ').toLowerCase()
}

export function transactionDedupeKey(
  accountNumber: string,
  txn: Pick<DedupeTxn, 'date' | 'chargedAmount' | 'description'>,
): string {
  const day = normalizeTxnDateForDedupe(txn.date)
  const amount = Math.abs(txn.chargedAmount)
  const desc = normalizeTxnDescriptionForDedupe(txn.description)
  return createHash('sha256').update(`${accountNumber}|${day}|${amount}|${desc}`).digest('hex')
}

export function fuzzyTxnMatch(
  existing: {
    description: string | null
    amount: string
    transactionDate: string
  },
  incoming: { description: string; amount: number; date: string },
): boolean {
  if (normalizeTxnDescriptionForDedupe(existing.description ?? '') !==
      normalizeTxnDescriptionForDedupe(incoming.description)) {
    return false
  }
  if (String(existing.amount) !== String(incoming.amount)) return false
  return (
    normalizeTxnDateForDedupe(existing.transactionDate) === normalizeTxnDateForDedupe(incoming.date)
  )
}

type Db = {
  select: (...args: unknown[]) => unknown
  update: (...args: unknown[]) => unknown
  delete: (...args: unknown[]) => unknown
}

type TxnRow = {
  id: string
  description: string | null
  amount: string
  transactionDate: string
  txnStatus: string | null
  dedupeKey: string | null
}

/** Remove pending shadow rows when a completed row exists for the same purchase. */
export async function reconcilePendingCompletedDuplicates(
  db: Db,
  bankAccountId: string,
): Promise<number> {
  const rows = (await queryRows(
    db
      .select({
        id: financeTransactions.id,
        description: financeTransactions.description,
        amount: financeTransactions.amount,
        transactionDate: financeTransactions.transactionDate,
        txnStatus: financeTransactions.txnStatus,
        dedupeKey: financeTransactions.dedupeKey,
      })
      .from(financeTransactions)
      .where(eq(financeTransactions.bankAccountId, bankAccountId)),
  )) as TxnRow[]

  const groups = new Map<string, TxnRow[]>()
  for (const row of rows) {
    const key = [
      normalizeTxnDateForDedupe(row.transactionDate),
      row.amount,
      normalizeTxnDescriptionForDedupe(row.description ?? ''),
    ].join('|')
    const list = groups.get(key) ?? []
    list.push(row)
    groups.set(key, list)
  }

  let removed = 0
  for (const group of groups.values()) {
    if (group.length < 2) continue
    const completed = group.filter((r) => r.txnStatus === 'completed')
    const pending = group.filter((r) => r.txnStatus === 'pending')
    if (completed.length === 0 || pending.length === 0) continue
    for (const row of pending) {
      await db.delete(financeTransactions).where(eq(financeTransactions.id, row.id))
      removed++
    }
  }
  return removed
}

export async function findFuzzyDuplicateTxn(
  db: Db,
  bankAccountId: string,
  incoming: { description: string; amount: number; date: string },
): Promise<TxnRow | null> {
  const day = normalizeTxnDateForDedupe(incoming.date)
  const candidates = (await queryRows(
    db
      .select({
        id: financeTransactions.id,
        description: financeTransactions.description,
        amount: financeTransactions.amount,
        transactionDate: financeTransactions.transactionDate,
        txnStatus: financeTransactions.txnStatus,
        dedupeKey: financeTransactions.dedupeKey,
      })
      .from(financeTransactions)
      .where(
        and(
          eq(financeTransactions.bankAccountId, bankAccountId),
          eq(financeTransactions.amount, String(incoming.amount)),
          sql`date(${financeTransactions.transactionDate}) = ${day}`,
        ),
      ),
  )) as TxnRow[]

  return candidates.find((row) => fuzzyTxnMatch(row, incoming)) ?? null
}

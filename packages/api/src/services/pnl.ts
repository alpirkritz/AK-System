/**
 * FIFO realized P&L for IBKR trades.
 *
 * Pure and side-effect free so it can be unit tested and reused by the trading
 * journal + symbol ranking queries. Each sell is matched against the oldest
 * open buy lots of the same symbol (first-in, first-out). Realized P&L for a
 * sell is `proceeds - matched cost basis - sell commission`.
 *
 * When a sell has no (or insufficient) prior buy lots — e.g. partial email
 * history — the unmatched quantity contributes zero cost basis rather than
 * being dropped, so proceeds are never silently lost.
 */

export interface TradeInput {
  id?: string
  symbol: string
  direction: 'buy' | 'sell'
  quantity: number
  price: number
  commission: number
  tradeDate: string
}

/** A slice of a buy lot consumed by a sell — carries the buy date so holding time is derivable. */
export interface MatchedLot {
  quantity: number
  price: number
  buyDate: string
}

export interface SellRealized {
  id?: string
  symbol: string
  tradeDate: string
  quantity: number
  proceeds: number
  costBasis: number
  commission: number
  realizedPnl: number
  /** Buy-lot slices this sell was matched against, oldest first (FIFO). */
  matchedLots: MatchedLot[]
  /** Quantity that had no prior buy lot (partial history) — contributed zero cost basis. */
  unmatchedQuantity: number
}

export interface SymbolPnl {
  symbol: string
  realizedPnl: number
  totalBought: number
  totalSold: number
  sharesOwned: number
  avgCost: number
  buyCount: number
  sellCount: number
  commission: number
}

export interface FifoResult {
  bySymbol: Record<string, SymbolPnl>
  sells: SellRealized[]
}

interface Lot {
  quantity: number
  price: number
  buyDate: string
}

export function computeFifoPnl(trades: TradeInput[]): FifoResult {
  const ordered = [...trades].sort((a, b) => {
    if (a.tradeDate < b.tradeDate) return -1
    if (a.tradeDate > b.tradeDate) return 1
    return 0
  })

  const lotsBySymbol: Record<string, Lot[]> = {}
  const bySymbol: Record<string, SymbolPnl> = {}
  const sells: SellRealized[] = []

  const ensure = (symbol: string): SymbolPnl => {
    if (!bySymbol[symbol]) {
      bySymbol[symbol] = {
        symbol,
        realizedPnl: 0,
        totalBought: 0,
        totalSold: 0,
        sharesOwned: 0,
        avgCost: 0,
        buyCount: 0,
        sellCount: 0,
        commission: 0,
      }
      lotsBySymbol[symbol] = []
    }
    return bySymbol[symbol]!
  }

  for (const trade of ordered) {
    const stat = ensure(trade.symbol)
    const commission = Number.isFinite(trade.commission) ? trade.commission : 0
    stat.commission += commission

    if (trade.direction === 'buy') {
      lotsBySymbol[trade.symbol]!.push({
        quantity: trade.quantity,
        price: trade.price,
        buyDate: trade.tradeDate,
      })
      stat.totalBought += trade.quantity * trade.price
      stat.buyCount += 1
      continue
    }

    // sell — match against oldest lots
    const proceeds = trade.quantity * trade.price
    let remaining = trade.quantity
    let costBasis = 0
    const matchedLots: MatchedLot[] = []
    const lots = lotsBySymbol[trade.symbol]!
    while (remaining > 0 && lots.length > 0) {
      const lot = lots[0]!
      const take = Math.min(remaining, lot.quantity)
      costBasis += take * lot.price
      matchedLots.push({ quantity: take, price: lot.price, buyDate: lot.buyDate })
      lot.quantity -= take
      remaining -= take
      if (lot.quantity <= 1e-9) lots.shift()
    }

    const realizedPnl = proceeds - costBasis - commission
    stat.totalSold += proceeds
    stat.sellCount += 1
    stat.realizedPnl += realizedPnl
    sells.push({
      id: trade.id,
      symbol: trade.symbol,
      tradeDate: trade.tradeDate,
      quantity: trade.quantity,
      proceeds,
      costBasis,
      commission,
      realizedPnl,
      matchedLots,
      unmatchedQuantity: remaining,
    })
  }

  for (const [symbol, lots] of Object.entries(lotsBySymbol)) {
    const stat = bySymbol[symbol]!
    let shares = 0
    let cost = 0
    for (const lot of lots) {
      shares += lot.quantity
      cost += lot.quantity * lot.price
    }
    stat.sharesOwned = shares
    stat.avgCost = shares > 0 ? cost / shares : 0
  }

  return { bySymbol, sells }
}

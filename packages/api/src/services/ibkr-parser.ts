import { searchGmailMessages, type GmailMessage } from './gmail'

export interface IBKRTrade {
  symbol: string
  direction: 'buy' | 'sell'
  quantity: number
  price: number
  commission: number
  currency: string
  tradeDate: string
  description?: string
  rawEmailId: string
}

// Run separate queries per domain and merge — Gmail API doesn't reliably support
// cross-domain OR queries in the from: field
const IBKR_DOMAINS = [
  'inter-il.com',           // Interactive Brokers Israel (Info@inter-il.com)
  'interactivebrokers.com', // IBKR US/Global
  'ibkr.com',               // IBKR alternative domain
]

async function fetchAllIBKRMessages(maxPerDomain = 50): Promise<GmailMessage[]> {
  const results = await Promise.allSettled(
    IBKR_DOMAINS.map((domain) =>
      searchGmailMessages(`from:${domain}`, maxPerDomain)
    )
  )
  const seen = new Set<string>()
  const all: GmailMessage[] = []
  for (const r of results) {
    if (r.status !== 'fulfilled') continue
    for (const msg of r.value) {
      if (!seen.has(msg.id)) {
        seen.add(msg.id)
        all.push(msg)
      }
    }
  }
  return all
}

export async function fetchIBKRTrades(maxEmails = 100): Promise<IBKRTrade[]> {
  const perDomain = Math.ceil(maxEmails / IBKR_DOMAINS.length)
  const messages = await fetchAllIBKRMessages(perDomain)
  const trades: IBKRTrade[] = []
  for (const msg of messages) {
    trades.push(...parseIBKREmail(msg))
  }
  return trades
}

/** Returns raw email metadata from IBKR — used for diagnostics */
export async function listIBKREmails(
  maxEmails = 50
): Promise<Array<{ id: string; from: string; subject: string; date: string; tradesParsed: number }>> {
  const perDomain = Math.ceil(maxEmails / IBKR_DOMAINS.length)
  const messages = await fetchAllIBKRMessages(perDomain)
  return messages.map((msg) => ({
    id: msg.id,
    from: msg.from,
    subject: msg.subject,
    date: msg.date,
    tradesParsed: parseIBKREmail(msg).length,
  }))
}

export function parseIBKREmail(msg: GmailMessage): IBKRTrade[] {
  const tradeDate = parseEmailDate(msg.date)

  // ── Strategy 0 (primary): subject line ───────────────────────────────────
  // Info@inter-il.com encodes the full trade in the subject:
  //   "SOLD 4,500 AVXX @ 4.415727 (UXXX5446)"
  //   "BUY 1,000 TSLA @ 250.123456 (U1234567)"
  const subjectMatch = msg.subject.match(
    /^(BUY|BOUGHT|BOT|SELL|SOLD|SLD)\s+([\d,]+(?:\.\d+)?)\s+([A-Z0-9]{1,12})\s+@\s+([\d,]+(?:\.\d+)?)/i
  )
  if (subjectMatch) {
    return [{
      symbol: subjectMatch[3].toUpperCase(),
      direction: resolveDirection(subjectMatch[1]),
      quantity: parseNum(subjectMatch[2]),
      price: parseNum(subjectMatch[4]),
      commission: 0,
      currency: detectCurrency(msg.subject + ' ' + msg.body),
      tradeDate,
      rawEmailId: msg.id,
    }]
  }

  // ── Fallback strategies: parse body ───────────────────────────────────────
  const plain = htmlToPlainText(msg.body)
  const trades: IBKRTrade[] = []
  let m: RegExpExecArray | null

  // ── Strategy 1: Hebrew inter-il.com body format ───────────────────────────
  // Matches patterns like:
  //   "קנייה 1,000 AAPL @ 150.00"  /  "מכירה 500 TSLA @ 200.00"
  //   "נקנה: AAPL 1000 @ 150.00"   /  "נמכר: TSLA 500 @ 200.00"
  const hebrewPattern =
    /(קנייה|קניה|נקנה|מכירה|נמכר)\s*:?\s*([\d,]+(?:\.\d+)?)\s+([A-Z0-9]{1,12})\s+@\s+([\d,]+(?:\.\d+)?)/gi
  while ((m = hebrewPattern.exec(plain)) !== null) {
    const qty = parseNum(m[2])
    const price = parseNum(m[4])
    if (qty > 0 && price > 0) {
      trades.push({
        symbol: m[3].toUpperCase(),
        direction: resolveDirection(m[1]),
        quantity: qty,
        price,
        commission: 0,
        currency: detectCurrency(plain),
        tradeDate,
        rawEmailId: msg.id,
      })
    }
  }

  // Also handle reversed: "AAPL קנייה 1000 @ 150"
  const hebrewPattern2 =
    /([A-Z0-9]{1,12})\s+(קנייה|קניה|נקנה|מכירה|נמכר)\s+([\d,]+(?:\.\d+)?)\s+@\s+([\d,]+(?:\.\d+)?)/gi
  while ((m = hebrewPattern2.exec(plain)) !== null) {
    const qty = parseNum(m[3])
    const price = parseNum(m[4])
    if (qty > 0 && price > 0) {
      trades.push({
        symbol: m[1].toUpperCase(),
        direction: resolveDirection(m[2]),
        quantity: qty,
        price,
        commission: 0,
        currency: detectCurrency(plain),
        tradeDate,
        rawEmailId: msg.id,
      })
    }
  }

  // ── Strategy 1 (primary): IBKR inline format ─────────────────────────────
  // Matches: "SOLD 4,500 AVXX @ 4.415727 (U1234567)"
  //          "BUY 100 AAPL @ 150.00"
  //          "BOUGHT 50 TSLA @ 200.123456"
  //
  // Quantity can have comma thousands separators: 4,500 or 1,234,567
  // Price can have many decimal places: 4.415727
  // Symbol: 1-12 uppercase alphanumeric chars (covers ETFs, warrants, etc.)
  // Account number in parens at end is optional and ignored
  const ibkrPattern =
    /\b(BUY|BOUGHT|BOT|SELL|SOLD|SLD)\s+([\d,]+(?:\.\d+)?)\s+([A-Z0-9]{1,12})\s+@\s+([\d,]+(?:\.\d+)?)(?:\s*\([^)]*\))?/gi

  while ((m = ibkrPattern.exec(plain)) !== null) {
    const qty = parseNum(m[2])
    const price = parseNum(m[4])
    if (qty > 0 && price > 0) {
      trades.push({
        symbol: m[3].toUpperCase(),
        direction: resolveDirection(m[1]),
        quantity: qty,
        price,
        commission: 0,
        currency: detectCurrency(plain),
        tradeDate,
        rawEmailId: msg.id,
      })
    }
  }

  // ── Strategy 2: "at" instead of "@" ──────────────────────────────────────
  if (trades.length === 0) {
    const atPattern =
      /\b(BUY|BOUGHT|BOT|SELL|SOLD|SLD)\s+([\d,]+(?:\.\d+)?)\s+([A-Z0-9]{1,12})\s+at\s+([\d,]+(?:\.\d+)?)/gi
    while ((m = atPattern.exec(plain)) !== null) {
      const qty = parseNum(m[2])
      const price = parseNum(m[4])
      if (qty > 0 && price > 0) {
        trades.push({
          symbol: m[3].toUpperCase(),
          direction: resolveDirection(m[1]),
          quantity: qty,
          price,
          commission: 0,
          currency: detectCurrency(plain),
          tradeDate,
          rawEmailId: msg.id,
        })
      }
    }
  }

  // ── Strategy 3: Table columns (BUY/SELL in one cell, symbol in another) ──
  if (trades.length === 0) {
    const lines = plain.split('\n').filter((l) => l.trim().length > 0)
    for (const line of lines) {
      const cells = line
        .split(/\s{2,}|\t/)
        .map((c) => c.trim())
        .filter(Boolean)
      if (cells.length < 4) continue
      const dirCell = cells.find((c) => /^(buy|bought|bot|sell|sold|sld)$/i.test(c))
      if (!dirCell) continue
      const symbolCell = cells.find(
        (c) => /^[A-Z0-9]{1,12}$/.test(c) && !/^(BUY|SELL|BOT|SLD|BOUGHT|SOLD|USD|EUR|GBP|ILS)$/i.test(c)
      )
      const nums = cells
        .map((c) => parseNum(c.replace(/[$€£₪,]/g, '')))
        .filter((n) => n > 0 && n < 1_000_000_000)
      if (!symbolCell || nums.length < 2) continue
      trades.push({
        symbol: symbolCell,
        direction: resolveDirection(dirCell),
        quantity: nums[0],
        price: nums[1],
        commission: nums[2] && nums[2] < 100 ? nums[2] : 0,
        currency: detectCurrency(plain),
        tradeDate,
        rawEmailId: msg.id,
      })
    }
  }

  // ── Strategy 4: Key-value pairs ──────────────────────────────────────────
  if (trades.length === 0) {
    const kv = extractKeyValues(plain)
    const action = kv['action'] || kv['side'] || kv['transaction'] || kv['type'] || kv['buy/sell']
    const symbol = kv['symbol'] || kv['ticker'] || kv['instrument'] || kv['financial instrument']
    const qty = kv['quantity'] || kv['shares'] || kv['units'] || kv['qty']
    const price = kv['price'] || kv['execution price'] || kv['avg price'] || kv['trade price']
    const comm = kv['commission'] || kv['fees'] || kv['fee']
    const curr = kv['currency'] || kv['ccy']
    if (action && symbol && qty && price) {
      trades.push({
        symbol: symbol.toUpperCase().split(/\s+/)[0],
        direction: resolveDirection(action),
        quantity: parseNum(qty),
        price: parseNum(price.replace(/[$€£₪]/g, '')),
        commission: comm ? parseNum(comm.replace(/[$€£₪]/g, '')) : 0,
        currency: curr ? curr.toUpperCase().slice(0, 3) : 'USD',
        tradeDate,
        rawEmailId: msg.id,
      })
    }
  }

  return trades
}

/** Detects the currency mentioned in the email body */
function detectCurrency(text: string): string {
  if (/\bUSD\b/.test(text)) return 'USD'
  if (/\bEUR\b/.test(text)) return 'EUR'
  if (/\bGBP\b/.test(text)) return 'GBP'
  if (/\bILS\b|\bNIS\b/.test(text)) return 'ILS'
  return 'USD'
}

function resolveDirection(raw: string): 'buy' | 'sell' {
  const lower = raw.toLowerCase().trim()
  // English
  if (lower === 'buy' || lower === 'bot' || lower === 'bought') return 'buy'
  // Hebrew
  if (lower.includes('קנייה') || lower.includes('קנה') || lower.includes('נקנה')) return 'buy'
  return 'sell'
}

function parseNum(s: string): number {
  return parseFloat(s.replace(/,/g, '')) || 0
}

function parseEmailDate(dateStr: string): string {
  if (!dateStr) return new Date().toISOString()
  try {
    return new Date(dateStr).toISOString()
  } catch {
    return new Date().toISOString()
  }
}

function htmlToPlainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<\/td>/gi, '  ')
    .replace(/<\/th>/gi, '  ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
}

function extractKeyValues(text: string): Record<string, string> {
  const kv: Record<string, string> = {}
  const lines = text.split('\n')
  for (const line of lines) {
    const colonIdx = line.indexOf(':')
    if (colonIdx > 0 && colonIdx < 40) {
      const key = line.slice(0, colonIdx).trim().toLowerCase()
      const value = line.slice(colonIdx + 1).trim()
      if (key.length > 0 && value.length > 0) {
        kv[key] = value
      }
    }
  }
  return kv
}

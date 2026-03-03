export interface NormalizedTransaction {
  amount: number
  currency: string
  direction: 'income' | 'expense'
  category: string
  description: string
  transactionDate: string
  rawData: string
}

export interface CSVParseResult {
  transactions: NormalizedTransaction[]
  detectedFormat: string
  skipped: number
}

// Column aliases for each bank format.
// Each entry maps a canonical field to possible Hebrew/English column names.
interface ColumnMap {
  date: string[]
  description: string[]
  debit: string[] // חיוב / הוצאה
  credit: string[] // זכות / הכנסה
  amount: string[] // single amount column (credit card style)
  currency?: string[]
}

const BANK_FORMATS: Record<string, ColumnMap> = {
  'בנק הפועלים': {
    date: ['תאריך'],
    description: ['שם פעולה', 'תיאור פעולה', 'פרטים'],
    debit: ['סכום חובה', 'חובה', 'חיוב'],
    credit: ['סכום זכות', 'זכות', 'הכנסה'],
    amount: [],
  },
  'בנק לאומי': {
    date: ['תאריך'],
    description: ['תיאור', 'פרטים', 'שם פעולה'],
    debit: ['חיוב', 'חובה'],
    credit: ['זכות', 'הכנסה'],
    amount: [],
  },
  'בנק דיסקונט': {
    date: ['תאריך'],
    description: ['פרטים', 'תיאור', 'שם פעולה'],
    debit: ['חובה', 'חיוב'],
    credit: ['זכות', 'הכנסה'],
    amount: [],
  },
  'Max / כאל': {
    date: ['תאריך עסקה', 'תאריך'],
    description: ['שם בית עסק', 'שם עסק', 'תיאור'],
    debit: ['סכום חיוב', 'סכום', 'חיוב'],
    credit: [],
    amount: ['סכום חיוב', 'סכום'],
    currency: ['מטבע', 'currency'],
  },
  'Isracard / ויזה': {
    date: ['תאריך', 'תאריך עסקה'],
    description: ['שם עסק', 'שם בית עסק', 'תיאור'],
    debit: ['סכום', 'סכום חיוב', 'חיוב'],
    credit: [],
    amount: ['סכום', 'סכום חיוב'],
    currency: ['מטבע', 'currency'],
  },
  'Cal / ויזה כאל': {
    date: ['תאריך עסקה', 'תאריך'],
    description: ['שם בית עסק', 'שם עסק'],
    debit: ['סכום עסקה', 'סכום', 'חיוב'],
    credit: [],
    amount: ['סכום עסקה', 'סכום'],
    currency: ['מטבע עסקה', 'מטבע'],
  },
  English: {
    date: ['date', 'transaction date', 'value date'],
    description: ['description', 'details', 'merchant', 'name'],
    debit: ['debit', 'withdrawal', 'charge', 'amount (debit)'],
    credit: ['credit', 'deposit', 'amount (credit)'],
    amount: ['amount'],
    currency: ['currency', 'ccy'],
  },
}

// Auto-detect bank format by matching column headers
function detectFormat(headers: string[]): string {
  const normalized = headers.map((h) => h.trim().toLowerCase())

  let bestMatch = ''
  let bestScore = 0

  for (const [formatName, colMap] of Object.entries(BANK_FORMATS)) {
    const allAliases = [
      ...colMap.date,
      ...colMap.description,
      ...colMap.debit,
      ...colMap.credit,
      ...colMap.amount,
      ...(colMap.currency ?? []),
    ].map((s) => s.toLowerCase())

    const score = allAliases.filter((alias) =>
      normalized.some((h) => h.includes(alias) || alias.includes(h))
    ).length

    if (score > bestScore) {
      bestScore = score
      bestMatch = formatName
    }
  }

  return bestScore >= 1 ? bestMatch : 'Unknown'
}

// Find the index of a column from a list of aliases
function findColIdx(headers: string[], aliases: string[]): number {
  const normalized = headers.map((h) => h.trim().toLowerCase())
  for (const alias of aliases) {
    const al = alias.toLowerCase()
    const idx = normalized.findIndex((h) => h.includes(al) || al.includes(h))
    if (idx >= 0) return idx
  }
  return -1
}

function parseAmount(s: string): number {
  if (!s || s.trim() === '' || s.trim() === '-') return 0
  // Strip currency symbols and thousands separators
  const cleaned = s
    .replace(/[₪$€£]/g, '')
    .replace(/,/g, '')
    .replace(/\s/g, '')
    .replace(/\(([^)]+)\)/, '-$1') // (100) → -100
  return parseFloat(cleaned) || 0
}

function parseDate(s: string): string {
  if (!s || s.trim() === '') return new Date().toISOString()

  // DD/MM/YYYY or DD.MM.YYYY
  const hebrewDate = s.trim().match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})$/)
  if (hebrewDate) {
    const [, d, m, y] = hebrewDate
    const year = y.length === 2 ? `20${y}` : y
    return new Date(`${year}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`).toISOString()
  }

  try {
    return new Date(s).toISOString()
  } catch {
    return new Date().toISOString()
  }
}

function categorize(description: string): string {
  const d = description.toLowerCase()
  if (/סופר|שופרסל|מגה|ויקטורי|רמי|אמזון|משלוח|food|grocery/.test(d)) return 'מזון'
  if (/דלק|סונול|פז|דור|כיבוד|תדלוק|fuel|gas/.test(d)) return 'רכב'
  if (/קפה|מסעדה|אוכל|אינדומי|שווארמה|pizza|restaurant|cafe/.test(d)) return 'אוכל בחוץ'
  if (/ביגוד|נעליים|זארה|h&m|mango|fashion/.test(d)) return 'ביגוד'
  if (/בריאות|רפואה|רופא|בית חולים|קופת|health|pharmacy/.test(d)) return 'בריאות'
  if (/חשמל|מים|גז|ועד|ארנונה|utility/.test(d)) return 'חשבונות'
  if (/נטפליקס|ספוטיפיי|netflix|spotify|amazon prime|subscription/.test(d)) return 'מנויים'
  if (/בנק|עמלה|bank fee|interest/.test(d)) return 'עמלות בנק'
  if (/משכורת|שכר|salary|income|הכנסה/.test(d)) return 'משכורת'
  if (/שכירות|rent/.test(d)) return 'שכירות'
  if (/ביטוח|insurance/.test(d)) return 'ביטוח'
  if (/חינוך|לימודים|school|education/.test(d)) return 'חינוך'
  return 'אחר'
}

export function parseCSV(csvContent: string): CSVParseResult {
  const lines = csvContent
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  if (lines.length < 2) {
    return { transactions: [], detectedFormat: 'Unknown', skipped: 0 }
  }

  // Find the header row — skip BOM and metadata rows
  let headerLineIdx = 0
  for (let i = 0; i < Math.min(lines.length, 10); i++) {
    const cells = parseLine(lines[i])
    if (cells.length >= 3 && cells.some((c) => /תאריך|date|חיוב|credit|debit/i.test(c))) {
      headerLineIdx = i
      break
    }
  }

  const headers = parseLine(lines[headerLineIdx]).map((h) =>
    h.replace(/\uFEFF/g, '').trim()
  )
  const formatName = detectFormat(headers)
  const colMap =
    BANK_FORMATS[formatName] ??
    ({
      date: ['date', 'תאריך'],
      description: ['description', 'תיאור', 'פרטים'],
      debit: ['debit', 'חיוב', 'חובה'],
      credit: ['credit', 'זכות'],
      amount: ['amount', 'סכום'],
    } as ColumnMap)

  const dateIdx = findColIdx(headers, colMap.date)
  const descIdx = findColIdx(headers, colMap.description)
  const debitIdx = findColIdx(headers, colMap.debit)
  const creditIdx = findColIdx(headers, colMap.credit)
  const amountIdx = findColIdx(headers, colMap.amount)
  const currencyIdx = colMap.currency ? findColIdx(headers, colMap.currency) : -1

  const transactions: NormalizedTransaction[] = []
  let skipped = 0

  for (let i = headerLineIdx + 1; i < lines.length; i++) {
    const cells = parseLine(lines[i])
    if (cells.length < 2) { skipped++; continue }

    const dateStr = dateIdx >= 0 ? (cells[dateIdx] ?? '') : ''
    const desc = descIdx >= 0 ? (cells[descIdx] ?? '') : cells.slice(0, 3).join(' ')
    const currency = currencyIdx >= 0 ? (cells[currencyIdx] ?? 'ILS') : 'ILS'

    let amount = 0
    let direction: 'income' | 'expense' = 'expense'

    if (amountIdx >= 0) {
      const raw = cells[amountIdx] ?? ''
      amount = Math.abs(parseAmount(raw))
      direction = parseAmount(raw) < 0 ? 'expense' : 'expense'
      // Credit cards: all are expenses unless explicitly income
    } else if (debitIdx >= 0 || creditIdx >= 0) {
      const debit = debitIdx >= 0 ? parseAmount(cells[debitIdx] ?? '') : 0
      const credit = creditIdx >= 0 ? parseAmount(cells[creditIdx] ?? '') : 0
      if (debit > 0) {
        amount = debit
        direction = 'expense'
      } else if (credit > 0) {
        amount = credit
        direction = 'income'
      }
    }

    if (amount === 0 || !dateStr) { skipped++; continue }

    transactions.push({
      amount,
      currency: currency.trim().toUpperCase().substring(0, 3) || 'ILS',
      direction,
      category: categorize(desc),
      description: desc,
      transactionDate: parseDate(dateStr),
      rawData: JSON.stringify(Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? '']))),
    })
  }

  return { transactions, detectedFormat: formatName, skipped }
}

// RFC4180-compliant CSV line parser (handles quoted fields with commas)
function parseLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
    } else if ((ch === ',' || ch === '\t') && !inQuotes) {
      result.push(current.trim())
      current = ''
    } else {
      current += ch
    }
  }
  result.push(current.trim())
  return result
}

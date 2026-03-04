import type { CSVParseResult, NormalizedTransaction } from './csv-parser'
import { parseCSV } from './csv-parser'

/** Extract raw text from a PDF buffer (e.g. Visa Cal statement). */
export async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  const pdfParse = (await import('pdf-parse')).default
  const data = await pdfParse(buffer)
  return (data?.text ?? '').trim()
}

function toValidISO(date: Date): string {
  const time = date.getTime()
  if (Number.isNaN(time)) return new Date().toISOString()
  return date.toISOString()
}

function parseDate(s: string): string {
  if (!s || s.trim() === '') return new Date().toISOString()
  const t = s.trim()
  const dmy = t.match(/^(\d{1,2})[\/\.\-](\d{1,2})[\/\.\-](\d{2,4})$/)
  if (dmy) {
    const [, d, month, y] = dmy
    const year = y.length === 2 ? `20${y}` : y
    return toValidISO(new Date(`${year}-${month.padStart(2, '0')}-${d.padStart(2, '0')}`))
  }
  const ymd = t.match(/^(\d{4})[\/\.\-](\d{1,2})[\/\.\-](\d{1,2})$/)
  if (ymd) {
    const [, y, month, d] = ymd
    return toValidISO(new Date(`${y}-${month.padStart(2, '0')}-${d.padStart(2, '0')}`))
  }
  return toValidISO(new Date(s))
}

function parseAmount(s: string): number {
  if (!s || s.trim() === '' || s.trim() === '-') return 0
  let cleaned = s.replace(/[₪$€£\s]/g, '').trim()
  // Israeli style: 1.234,56 or 1234,56 → decimal comma
  if (/^\d{1,3}(\.\d{3})*,\d{2}$/.test(cleaned) || /^\d+,\d{2}$/.test(cleaned)) {
    cleaned = cleaned.replace(/\./g, '').replace(',', '.')
  } else {
    cleaned = cleaned.replace(/,/g, '')
  }
  return parseFloat(cleaned) || 0
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

// Match a single amount (with . or , decimal, or Israeli 1.234,56). Use new RegExp per line to avoid lastIndex issues.
const AMOUNT_REG_SOURCE = /(\d{1,3}(?:\.\d{3})*(?:[.,]\d{2})?|\d+[.,]\d{2})\s*[₪]?/
const DATE_REG = /(\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4})/

const DATE_ONLY_REG = /^\d{1,2}[\/\.\-]\d{1,2}[\/\.\-]\d{2,4}$|^\d{4}[\/\.\-]\d{1,2}[\/\.\-]\d{1,2}$/
const AMOUNT_ONLY_REG = /^\d+[.,]\d{2}$|^\d{1,3}(?:\.\d{3})*,\d{2}$/

function tryParseLineAsColumns(line: string): { dateStr: string; description: string; amountStr: string } | null {
  const parts = line.split(/\s{2,}|\t/).map((p) => p.trim()).filter(Boolean)
  if (parts.length < 2) return null
  let dateStr = ''
  let amountStr = ''
  const rest: string[] = []
  for (const p of parts) {
    const clean = p.replace(/[₪\s]/g, '')
    if (DATE_ONLY_REG.test(p)) {
      dateStr = p
    } else if (AMOUNT_ONLY_REG.test(clean)) {
      amountStr = clean
    } else {
      rest.push(p)
    }
  }
  if (dateStr && amountStr && parseAmount(amountStr) > 0) {
    return { dateStr, description: rest.join(' ').trim() || 'לא צוין', amountStr }
  }
  return null
}

/**
 * Parse Visa Cal / Israeli credit card PDF statement text.
 * Handles: "01/02/2024  שם בית עסק  123.45", "01.02.24  MERCHANT  50,00 ₪",
 * and column-style lines (date, description, amount with multiple spaces or tabs).
 */
function parseVisaCalLines(text: string): CSVParseResult {
  const transactions: NormalizedTransaction[] = []
  let skipped = 0
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)

  for (const line of lines) {
    const colResult = tryParseLineAsColumns(line)
    if (colResult) {
      const amount = parseAmount(colResult.amountStr)
      if (amount <= 0) {
        skipped++
        continue
      }
      transactions.push({
        amount,
        currency: 'ILS',
        direction: 'expense',
        category: categorize(colResult.description),
        description: colResult.description,
        transactionDate: parseDate(colResult.dateStr),
        rawData: JSON.stringify({
          date: colResult.dateStr,
          description: colResult.description,
          amount: colResult.amountStr,
        }),
      })
      continue
    }

    const dateMatch = line.match(DATE_REG)
    const amountMatches = [...line.matchAll(new RegExp(AMOUNT_REG_SOURCE.source, 'g'))]
    if (!dateMatch || amountMatches.length === 0) {
      skipped++
      continue
    }
    const dateStr = dateMatch[1]
    let amountStr = ''
    let amountStartIdx = -1
    for (const m of amountMatches) {
      const s = m[1]
      const n = parseAmount(s)
      if (n > 0 && n < 1_000_000) {
        amountStr = s
        amountStartIdx = m.index!
      }
    }
    if (!amountStr || amountStartIdx < 0) {
      skipped++
      continue
    }
    const amount = parseAmount(amountStr)
    if (amount <= 0) {
      skipped++
      continue
    }
    const dateEndIdx = dateMatch.index! + dateStr.length
    const description =
      line
        .slice(dateEndIdx, amountStartIdx)
        .replace(/\s+/g, ' ')
        .trim() ||
      line.slice(0, dateMatch.index!).replace(/\s+/g, ' ').trim() ||
      'לא צוין'
    transactions.push({
      amount,
      currency: 'ILS',
      direction: 'expense',
      category: categorize(description),
      description,
      transactionDate: parseDate(dateStr),
      rawData: JSON.stringify({ date: dateStr, description, amount: amountStr }),
    })
  }

  return {
    transactions,
    detectedFormat: 'Cal / ויזה כאל (PDF)',
    skipped,
  }
}

/**
 * Parse PDF statement text: first try as CSV/tab-separated (many exports),
 * then fall back to Visa Cal line-by-line regex.
 */
export function parsePdfStatementText(text: string): CSVParseResult {
  if (!text || text.length < 10) {
    return { transactions: [], detectedFormat: 'Unknown', skipped: 0 }
  }

  const csvResult = parseCSV(text)
  if (csvResult.transactions.length > 0) {
    return {
      ...csvResult,
      detectedFormat: csvResult.detectedFormat + ' (PDF)',
    }
  }

  return parseVisaCalLines(text)
}

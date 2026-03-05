/**
 * One-time import script: Notion People CSV -> SQLite people table.
 * Usage:  DATABASE_PATH=apps/web/data/ak_system.sqlite npx tsx scripts/import-notion-people.ts
 */
import { getDb, people, eq } from '../packages/database/src/index'
import * as fs from 'fs'
import * as path from 'path'

// ── CSV parser (handles quoted fields with commas/newlines) ──────────────────

function parseCSV(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (ch === '"') {
        inQuotes = false
      } else {
        field += ch
      }
    } else {
      if (ch === '"') {
        inQuotes = true
      } else if (ch === ',') {
        row.push(field)
        field = ''
      } else if (ch === '\n' || (ch === '\r' && text[i + 1] === '\n')) {
        row.push(field)
        field = ''
        if (row.some((c) => c.trim())) rows.push(row)
        row = []
        if (ch === '\r') i++
      } else {
        field += ch
      }
    }
  }
  // last row
  row.push(field)
  if (row.some((c) => c.trim())) rows.push(row)
  return rows
}

// ── Data cleaning helpers ────────────────────────────────────────────────────

/** "INT College (https://www.notion.so/...)" -> "INT College" */
function extractName(raw: string): string {
  if (!raw) return ''
  const m = raw.match(/^(.+?)\s*\(https?:\/\//)
  return m ? m[1].trim() : raw.trim()
}

/** Extracts readable titles from Notion link fields:
 *  "Coffee with Tomer (https://notion.so/...), 1:1 (https://notion.so/...)" -> "Coffee with Tomer, 1:1" */
function extractInteractionTitles(raw: string): string {
  if (!raw) return ''
  const parts = raw.split(/,\s*(?=[A-Za-z@\u0590-\u05FF])/)
  return parts
    .map((p) => extractName(p))
    .filter((t) => t && t !== 'Untitled')
    .join(', ')
}

/** "January 24, 2023 4:19 PM" or "01/03/2023" or "June 3, 2025" -> ISO date string */
function parseDate(raw: string): string {
  if (!raw) return ''
  const trimmed = raw.trim()

  // DD/MM/YYYY format
  const ddmm = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/)
  if (ddmm) {
    const [, d, m, y] = ddmm
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // DD/MM/YYYY HH:MM ... format
  const ddmmTime = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s/)
  if (ddmmTime) {
    const [, d, m, y] = ddmmTime
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // "Month DD, YYYY" or "Month DD, YYYY HH:MM AM/PM"
  const d = new Date(trimmed)
  if (!isNaN(d.getTime())) {
    return d.toISOString().slice(0, 10)
  }
  return ''
}

// ── Main ─────────────────────────────────────────────────────────────────────

const CSV_PATH = path.resolve(
  __dirname,
  '../',
  process.argv[2] ||
    path.join(
      process.env.HOME || '',
      'Downloads/ExportBlock-b7cc2db3-b585-4147-a390-914d63d1c7a5-Part-1',
      'People 20ee7d50cb8e81bbab5be27f92be00e5_all.csv',
    ),
)

console.log(`Reading CSV from: ${CSV_PATH}`)
const raw = fs.readFileSync(CSV_PATH, 'utf-8')
const rows = parseCSV(raw)

const headers = rows[0].map((h) => h.trim())
console.log(`Headers: ${headers.join(' | ')}`)
console.log(`Data rows: ${rows.length - 1}`)

// Map header names to column indices
const col = (name: string) => headers.indexOf(name)

const db = getDb()

let inserted = 0
let skipped = 0

for (let i = 1; i < rows.length; i++) {
  const r = rows[i]
  const name = (r[col('Name')] ?? '').trim()
  if (!name) continue

  // Check for duplicate by name
  const existing = db.select().from(people).where(eq(people.name, name)).get()
  if (existing) {
    skipped++
    continue
  }

  const addedRaw = (r[col('Added')] ?? '').trim()
  const createdAt = parseDate(addedRaw) || new Date().toISOString().slice(0, 10)

  const email = (r[col('Email')] ?? '').trim() || null
  const phone = (r[col('Phone')] ?? '').trim() || null
  const companyRaw = (r[col('Company')] ?? '').trim()
  const company = extractName(companyRaw) || null
  const jobTitle = (r[col('Job Title')] ?? '').trim() || null
  const linkedin = (r[col('Linkedin')] ?? '').trim() || null
  const expertIn = (r[col('Expert in')] ?? '').trim() || null
  const tagsRaw = (r[col('Tags')] ?? '').trim() || null
  const goal = (r[col('Goal')] ?? '').trim() || null
  const freqRaw = (r[col('💬 Frequency (Days)')] ?? '').trim()
  const contactFrequencyDays = freqRaw ? parseInt(freqRaw, 10) || null : null

  const lastContactRaw = (r[col('Last Contact')] ?? '').trim()
  const lastMtgRaw = (r[col('Last Mtg')] ?? '').trim()
  // Use the most recent of Last Contact / Last Mtg
  const lc = parseDate(lastContactRaw)
  const lm = parseDate(lastMtgRaw)
  const lastContact = (lc && lm) ? (lc > lm ? lc : lm) : (lc || lm || null)

  const interactionRaw = (r[col('Interaction')] ?? '').trim()
  const notes = extractInteractionTitles(interactionRaw) || null

  const id = 'p_imp_' + Date.now() + '_' + i

  db.insert(people).values({
    id,
    name,
    role: null,
    email,
    color: '#e8c547',
    phone,
    company,
    jobTitle,
    linkedin,
    tags: tagsRaw,
    expertIn,
    lastContact,
    goal,
    contactFrequencyDays,
    notes,
    createdAt,
  }).run()

  inserted++
}

console.log(`\nDone! Inserted: ${inserted}, Skipped (duplicate): ${skipped}`)

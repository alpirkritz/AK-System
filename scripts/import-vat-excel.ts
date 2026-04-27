/**
 * Import VAT entries from Excel "ספר תגבולים תשלומים" (ינואר פברואר sheet).
 *
 * Usage:
 *   pnpm exec tsx scripts/import-vat-excel.ts [path-to-xlsx]
 *
 * Default path: .../Maam/2026/ספר תגבולים תשלומים 2026.xlsx
 * Set DATABASE_PATH or run from repo root (uses apps/web/data/ak_system.sqlite).
 */

import * as path from 'path'
import * as fs from 'fs'
import XLSX from 'xlsx'
import { getDb, runMutation, vatEntries, eq, and } from '@ak-system/database'
import { VAT_CATEGORIES } from '@ak-system/types'

const DEFAULT_EXCEL =
  '/Users/alpir/Library/CloudStorage/GoogleDrive-alpirkritz@gmail.com/My Drive/Alpir/Jobs/Alpir Consulting/2 - Finanace/Maam/2026/ספר תגבולים תשלומים 2026.xlsx'

const YEAR = 2026
const PERIOD = 1 // ינואר פברואר

// Excel column indices (0-based) from header row "סידורי","קטגוריה","תאריך","חשבונית","פרטים",...
const COL = {
  serial: 0,
  category: 1,
  date: 2,
  invoice: 3,
  description: 4,
  incomeInclVat: 5,
  vatExemptIncome: 7,
  deductionPct: 9,
  expenseInclVat: 10,
  vatExemptExpense: 13,
} as const

function excelDateToISO(excelNum: number): string {
  if (!excelNum || typeof excelNum !== 'number') return new Date().toISOString().slice(0, 10)
  // Excel serial: 1 = 1900-01-01. 25569 = 1970-01-01
  const d = new Date((excelNum - 25569) * 86400 * 1000)
  return d.toISOString().slice(0, 10)
}

function mapCategory(sheetCategory: string): { taxCode: string; label: string } {
  const s = String(sheetCategory || '').trim()
  if (!s) return { taxCode: '2', label: 'קניות - עלות המכירות' }
  for (const c of VAT_CATEGORIES) {
    if (c.label === s) return { taxCode: c.taxCode, label: c.label }
    if (s.includes(c.label) || c.label.includes(s)) return { taxCode: c.taxCode, label: c.label }
  }
  // Fallback by keyword
  if (/הכנסות/.test(s)) return { taxCode: '1', label: 'הכנסות' }
  if (/רכב|דלק|תיקונים/.test(s)) return { taxCode: '12', label: 'רכב דלק ותיקונים' }
  if (/קניות|עלות|מכירות/.test(s)) return { taxCode: '2', label: 'קניות - עלות המכירות' }
  if (/חניה|תחבצ/.test(s)) return { taxCode: '12', label: 'חניה ותחבצ' }
  if (/מיסים|ארנונה/.test(s)) return { taxCode: '13', label: 'מיסים (ארנונה)' }
  if (/אחזקה|חשמל|מים/.test(s)) return { taxCode: '8', label: 'אחזקה תיקונים שוטפים (חשמל, מים)' }
  if (/משרדיות|דאר|טלפון/.test(s)) return { taxCode: '9', label: 'משרדיות (דואר, טלפון)' }
  if (/הנהלה|חשבונות/.test(s)) return { taxCode: '10', label: 'הנהלת חשבונות' }
  if (/נסיעה|אשל/.test(s)) return { taxCode: '12', label: 'נסיעה אשל חניה' }
  return { taxCode: '2', label: s || 'אחר' }
}

function num(val: unknown): number {
  if (val === '' || val === null || val === undefined) return 0
  const n = Number(val)
  return Number.isFinite(n) ? n : 0
}

async function main() {
  const excelPath = process.argv[2] || DEFAULT_EXCEL
  if (!fs.existsSync(excelPath)) {
    console.error('Excel file not found:', excelPath)
    process.exit(1)
  }

  const wb = XLSX.readFile(excelPath)
  const sheetName = 'ינואר פברואר'
  const sheet = wb.Sheets[sheetName]
  if (!sheet) {
    console.error('Sheet not found:', sheetName, '- available:', wb.SheetNames.join(', '))
    process.exit(1)
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as unknown[][]
  const db = getDb()

  // Remove existing entries for this year+period so re-run does not create duplicates
  await runMutation(
    db.delete(vatEntries).where(and(eq(vatEntries.year, YEAR), eq(vatEntries.period, PERIOD)))
  )
  console.log('Cleared existing entries for', YEAR, 'period', PERIOD)

  let inserted = 0
  let skipped = 0

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row || !Array.isArray(row)) continue

    const serial = row[COL.serial]
    if (serial === '' || serial === undefined || serial === null) continue
    const serialNum = typeof serial === 'number' ? serial : parseInt(String(serial), 10)
    if (!Number.isFinite(serialNum) || serialNum < 1) continue

    const sheetCategory = row[COL.category]
    const { taxCode, label: category } = mapCategory(String(sheetCategory || ''))
    const dateRaw = row[COL.date]
    const date = excelDateToISO(num(dateRaw) || (typeof dateRaw === 'number' ? dateRaw : 0))
    const invoiceNumber = row[COL.invoice] != null && row[COL.invoice] !== '' ? String(row[COL.invoice]) : null
    const description = String(row[COL.description] || '').trim() || category

    const incomeIncl = num(row[COL.incomeInclVat])
    const vatExemptInc = num(row[COL.vatExemptIncome])
    const expenseIncl = num(row[COL.expenseInclVat])
    const vatExemptExp = num(row[COL.vatExemptExpense])
    const deductionPct = row[COL.deductionPct]
    const deduction = typeof deductionPct === 'number' ? deductionPct : num(deductionPct)

    let entryType: 'income' | 'expense'
    let amount: number
    let isVatExempt: boolean
    let deductionPercent: number

    if (incomeIncl > 0) {
      entryType = 'income'
      amount = incomeIncl
      isVatExempt = false
      deductionPercent = 1
    } else if (vatExemptInc > 0) {
      entryType = 'income'
      amount = vatExemptInc
      isVatExempt = true
      deductionPercent = 1
    } else if (expenseIncl > 0) {
      entryType = 'expense'
      amount = expenseIncl
      isVatExempt = false
      deductionPercent = Number.isFinite(deduction) && deduction > 0 ? deduction : 0.67
    } else if (vatExemptExp > 0) {
      entryType = 'expense'
      amount = vatExemptExp
      isVatExempt = true
      deductionPercent = Number.isFinite(deduction) && deduction > 0 ? deduction : 0.67
    } else {
      skipped++
      continue
    }

    const id = 've' + Date.now() + '-' + i + '-' + Math.random().toString(36).slice(2, 6)
    const createdAt = new Date().toISOString()

    try {
      await runMutation(
        db.insert(vatEntries).values({
          id,
          year: YEAR,
          period: PERIOD,
          taxCode,
          category,
          entryType,
          date,
          invoiceNumber,
          description,
          amount: String(amount),
          isVatExempt: isVatExempt ? 1 : 0,
          deductionPercent: String(deductionPercent),
          dollarRate: null,
          invoiceFileUrl: null,
          createdAt,
        })
      )
      inserted++
    } catch (e) {
      console.error('Row', i + 1, e)
    }
  }

  console.log('Done. Inserted:', inserted, 'Skipped:', skipped)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})

import { describe, it, expect, beforeEach, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { getDb, vatEntries } from '@ak-system/database'
import { createTestCaller } from '../test-utils'

let baseDir: string
const prevEnv = process.env.EXPENSES_DIR

beforeAll(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vat-router-test-'))
  process.env.EXPENSES_DIR = baseDir
  const jun = path.join(baseDir, '2026_06')
  fs.mkdirSync(jun)
  fs.writeFileSync(path.join(jun, 'a.pdf'), '%PDF-1.4 test')
  fs.writeFileSync(path.join(jun, 'b.jpg'), 'jpgbytes')
})

afterAll(() => {
  if (prevEnv === undefined) delete process.env.EXPENSES_DIR
  else process.env.EXPENSES_DIR = prevEnv
  fs.rmSync(baseDir, { recursive: true, force: true })
})

beforeEach(async () => {
  await getDb().delete(vatEntries)
})

describe('vat.create period from date', () => {
  it('stores March invoice under period 2 even when client sends May-June period', async () => {
    const caller = await createTestCaller()
    await caller.vat.create({
      year: 2026,
      period: 3, // client was on מאי-יוני
      taxCode: '2',
      category: 'קניות - עלות המכירות',
      entryType: 'expense',
      date: '2026-03-15',
      description: 'חשבונית ממרץ',
      amount: 100,
      isVatExempt: false,
      deductionPercent: 1,
    })

    const wrongPeriod = await caller.vat.list({ year: 2026, period: 3 })
    expect(wrongPeriod.find((r) => r.description === 'חשבונית ממרץ')).toBeUndefined()

    const marchPeriod = await caller.vat.list({ year: 2026, period: 2 })
    const row = marchPeriod.find((r) => r.description === 'חשבונית ממרץ')
    expect(row).toBeTruthy()
    expect(row!.period).toBe(2)
    expect(row!.year).toBe(2026)
  })

  it('moves period when date is updated', async () => {
    const caller = await createTestCaller()
    const { id } = await caller.vat.create({
      year: 2026,
      period: 3,
      taxCode: '2',
      category: 'קניות - עלות המכירות',
      entryType: 'expense',
      date: '2026-06-01',
      description: 'זז לתקופה',
      amount: 50,
      isVatExempt: false,
      deductionPercent: 1,
    })
    await caller.vat.update({ id, date: '2026-01-20' })
    const jan = await caller.vat.list({ year: 2026, period: 1 })
    expect(jan.find((r) => r.id === id)).toBeTruthy()
    const jun = await caller.vat.list({ year: 2026, period: 3 })
    expect(jun.find((r) => r.id === id)).toBeUndefined()
  })
})

describe('vat.createBatch', () => {
  it('inserts multiple entries and list returns them', async () => {
    const caller = await createTestCaller()
    const res = await caller.vat.createBatch({
      entries: [
        {
          year: 2026,
          period: 3,
          taxCode: '2',
          category: 'קניות - עלות המכירות',
          entryType: 'expense',
          date: '2026-06-03',
          description: 'קניות פתרון',
          amount: 101,
          isVatExempt: false,
          deductionPercent: 1,
          invoiceFileUrl: path.join(baseDir, '2026_06', 'a.pdf'),
        },
        {
          year: 2026,
          period: 3,
          taxCode: '12',
          category: 'חניה ותחבצ',
          entryType: 'expense',
          date: '2026-06-06',
          description: 'חניה',
          amount: 30,
          isVatExempt: false,
          deductionPercent: 1,
          invoiceFileUrl: path.join(baseDir, '2026_06', 'b.jpg'),
        },
      ],
    })
    expect(res.inserted).toBe(2)

    const list = await caller.vat.list({ year: 2026, period: 3 })
    expect(list.length).toBe(2)
    expect(list.map((r) => r.description).sort()).toEqual(['חניה', 'קניות פתרון'])
    expect(list.every((r) => r.invoiceFileUrl != null)).toBe(true)
  })

  it('assigns unique ids across a batch', async () => {
    const caller = await createTestCaller()
    const entries = Array.from({ length: 5 }, (_, i) => ({
      year: 2026,
      period: 1,
      taxCode: '2',
      category: 'קניות - עלות המכירות',
      entryType: 'expense' as const,
      date: '2026-01-10',
      description: `פריט ${i}`,
      amount: 10 + i,
      isVatExempt: false,
      deductionPercent: 1,
    }))
    const res = await caller.vat.createBatch({ entries })
    expect(res.inserted).toBe(5)
    const rows = await getDb().select().from(vatEntries)
    const ids = new Set(rows.map((r) => r.id))
    expect(ids.size).toBe(5)
  })
})

describe('vat.listExpenseFolders + listFolderFiles', () => {
  it('marks files as imported once committed via createBatch', async () => {
    const caller = await createTestCaller()

    const before = await caller.vat.listExpenseFolders()
    expect(before.available).toBe(true)
    const junBefore = before.folders.find((f) => f.folder === '2026_06')!
    expect(junBefore.fileCount).toBe(2)
    expect(junBefore.importedCount).toBe(0)

    await caller.vat.createBatch({
      entries: [
        {
          year: 2026,
          period: 3,
          taxCode: '2',
          category: 'קניות - עלות המכירות',
          entryType: 'expense',
          date: '2026-06-03',
          description: 'a',
          amount: 100,
          isVatExempt: false,
          deductionPercent: 1,
          invoiceFileUrl: path.join(baseDir, '2026_06', 'a.pdf'),
        },
      ],
    })

    const after = await caller.vat.listExpenseFolders()
    const junAfter = after.folders.find((f) => f.folder === '2026_06')!
    expect(junAfter.importedCount).toBe(1)

    const files = await caller.vat.listFolderFiles({ folder: '2026_06' })
    const a = files.find((f) => f.fileName === 'a.pdf')!
    const b = files.find((f) => f.fileName === 'b.jpg')!
    expect(a.alreadyImported).toBe(true)
    expect(b.alreadyImported).toBe(false)
  })

  it('rejects a folder name that fails validation', async () => {
    const caller = await createTestCaller()
    await expect(caller.vat.listFolderFiles({ folder: '../etc' })).rejects.toThrow()
  })

  it('reports unavailable when the base dir is missing', async () => {
    const saved = process.env.EXPENSES_DIR
    process.env.EXPENSES_DIR = path.join(baseDir, 'nope')
    const caller = await createTestCaller()
    const res = await caller.vat.listExpenseFolders()
    expect(res.available).toBe(false)
    expect(res.folders).toEqual([])
    process.env.EXPENSES_DIR = saved
  })
})

describe('vat.exportExcel', () => {
  it('exports current period entries as CSV with Hebrew headers', async () => {
    const caller = await createTestCaller()
    await caller.vat.create({
      year: 2026,
      period: 3,
      taxCode: '2',
      category: 'קניות - עלות המכירות',
      entryType: 'expense',
      date: '2026-06-03',
      invoiceNumber: '1',
      description: 'בדיקה',
      amount: 118,
      isVatExempt: false,
      deductionPercent: 1,
    })

    const res = await caller.vat.exportExcel({ year: 2026, period: 3 })
    expect(res.fileName).toContain('2026')
    expect(res.fileName).toContain('.csv')
    expect(res.csv.charCodeAt(0)).toBe(0xfeff)
    expect(res.csv).toContain('בדיקה')
    expect(res.csv).toContain('100.00') // excl VAT at 18%
  })

  it('annual export omits period filter', async () => {
    const caller = await createTestCaller()
    await caller.vat.create({
      year: 2026,
      period: 1,
      taxCode: '2',
      category: 'קניות - עלות המכירות',
      entryType: 'expense',
      date: '2026-01-10',
      description: 'ינואר',
      amount: 10,
      isVatExempt: false,
      deductionPercent: 1,
    })
    await caller.vat.create({
      year: 2026,
      period: 3,
      taxCode: '2',
      category: 'קניות - עלות המכירות',
      entryType: 'expense',
      date: '2026-06-10',
      description: 'יוני',
      amount: 20,
      isVatExempt: false,
      deductionPercent: 1,
    })

    const res = await caller.vat.exportExcel({ year: 2026 })
    expect(res.fileName).toContain('שנתי')
    expect(res.csv).toContain('ינואר')
    expect(res.csv).toContain('יוני')
  })
})

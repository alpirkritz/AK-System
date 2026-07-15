import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { TRPCError } from '@trpc/server'
import {
  folderToPeriod,
  resolveSafeFolder,
  resolveSafeFile,
  extAllowed,
  mimeForFile,
  listExpenseFolders,
  listFolderFiles,
  readInvoiceFile,
  isExpensesDirAvailable,
} from './expense-folders'

let baseDir: string
const prevEnv = process.env.EXPENSES_DIR

beforeAll(() => {
  baseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expenses-test-'))
  process.env.EXPENSES_DIR = baseDir

  // 2026_06 with two invoice files + a stray non-invoice file
  const jun = path.join(baseDir, '2026_06')
  fs.mkdirSync(jun)
  fs.writeFileSync(path.join(jun, 'a.pdf'), '%PDF-1.4 test')
  fs.writeFileSync(path.join(jun, 'b.jpg'), 'jpgbytes')
  fs.writeFileSync(path.join(jun, 'notes.txt'), 'ignore me')

  // 2026_07 with one file
  const jul = path.join(baseDir, '2026_07')
  fs.mkdirSync(jul)
  fs.writeFileSync(path.join(jul, 'c.png'), 'pngbytes')

  // Non-matching folders that must be excluded
  fs.mkdirSync(path.join(baseDir, 'Archive'))
  fs.mkdirSync(path.join(baseDir, 'random'))
})

afterAll(() => {
  if (prevEnv === undefined) delete process.env.EXPENSES_DIR
  else process.env.EXPENSES_DIR = prevEnv
  fs.rmSync(baseDir, { recursive: true, force: true })
})

describe('folderToPeriod', () => {
  it('maps YYYY_MM to year/month/bimonthly period', () => {
    expect(folderToPeriod('2026_06')).toEqual({ year: 2026, month: 6, period: 3 })
    expect(folderToPeriod('2026_01')).toEqual({ year: 2026, month: 1, period: 1 })
    expect(folderToPeriod('2026_12')).toEqual({ year: 2026, month: 12, period: 6 })
  })

  it('rejects malformed or out-of-range folder names', () => {
    expect(() => folderToPeriod('2026-06')).toThrow(TRPCError)
    expect(() => folderToPeriod('202606')).toThrow(TRPCError)
    expect(() => folderToPeriod('2026_13')).toThrow(TRPCError)
    expect(() => folderToPeriod('../etc')).toThrow(TRPCError)
  })
})

describe('extAllowed / mimeForFile', () => {
  it('accepts pdf/jpg/jpeg/png only', () => {
    expect(extAllowed('a.pdf')).toBe(true)
    expect(extAllowed('a.JPG')).toBe(true)
    expect(extAllowed('a.jpeg')).toBe(true)
    expect(extAllowed('a.png')).toBe(true)
    expect(extAllowed('a.txt')).toBe(false)
    expect(extAllowed('a.exe')).toBe(false)
  })

  it('maps extensions to mime types', () => {
    expect(mimeForFile('a.pdf')).toBe('application/pdf')
    expect(mimeForFile('a.png')).toBe('image/png')
    expect(mimeForFile('a.jpg')).toBe('image/jpeg')
    expect(mimeForFile('a.jpeg')).toBe('image/jpeg')
  })
})

describe('resolveSafeFolder path safety', () => {
  it('resolves a valid folder inside the base dir', () => {
    const resolved = resolveSafeFolder('2026_06')
    expect(resolved).toBe(path.join(baseDir, '2026_06'))
  })

  it('rejects traversal and invalid names', () => {
    expect(() => resolveSafeFolder('..')).toThrow(TRPCError)
    expect(() => resolveSafeFolder('../secrets')).toThrow(TRPCError)
    expect(() => resolveSafeFolder('2026_06/../..')).toThrow(TRPCError)
  })
})

describe('resolveSafeFile path safety', () => {
  it('resolves a valid file inside the folder', () => {
    const resolved = resolveSafeFile('2026_06', 'a.pdf')
    expect(resolved).toBe(path.join(baseDir, '2026_06', 'a.pdf'))
  })

  it('rejects path traversal in the file name', () => {
    expect(() => resolveSafeFile('2026_06', '../../etc/passwd')).toThrow(TRPCError)
    expect(() => resolveSafeFile('2026_06', '..%2f..%2fx.pdf')).toThrow(TRPCError)
    expect(() => resolveSafeFile('2026_06', 'sub/a.pdf')).toThrow(TRPCError)
    expect(() => resolveSafeFile('2026_06', 'a\\b.pdf')).toThrow(TRPCError)
  })

  it('rejects disallowed extensions', () => {
    expect(() => resolveSafeFile('2026_06', 'notes.txt')).toThrow(TRPCError)
    expect(() => resolveSafeFile('2026_06', 'evil.sh')).toThrow(TRPCError)
  })

  it('rejects empty / dot file names', () => {
    expect(() => resolveSafeFile('2026_06', '')).toThrow(TRPCError)
    expect(() => resolveSafeFile('2026_06', '.')).toThrow(TRPCError)
    expect(() => resolveSafeFile('2026_06', '..')).toThrow(TRPCError)
  })
})

describe('listExpenseFolders', () => {
  it('lists only YYYY_MM folders with invoice file counts, newest first', () => {
    const folders = listExpenseFolders()
    expect(folders.map((f) => f.folder)).toEqual(['2026_07', '2026_06'])
    const jun = folders.find((f) => f.folder === '2026_06')!
    expect(jun.fileCount).toBe(2) // .pdf + .jpg, not the .txt
    expect(jun.period).toBe(3)
    const jul = folders.find((f) => f.folder === '2026_07')!
    expect(jul.fileCount).toBe(1)
  })

  it('filters by year when provided', () => {
    expect(listExpenseFolders(2025)).toEqual([])
    expect(listExpenseFolders(2026).length).toBe(2)
  })
})

describe('listFolderFiles', () => {
  it('lists invoice files with size + mime, ignoring non-invoice files', () => {
    const files = listFolderFiles('2026_06')
    expect(files.map((f) => f.fileName)).toEqual(['a.pdf', 'b.jpg'])
    expect(files[0].mimeType).toBe('application/pdf')
    expect(files[1].mimeType).toBe('image/jpeg')
    expect(files[0].sizeBytes).toBeGreaterThan(0)
  })
})

describe('readInvoiceFile', () => {
  it('reads a file and returns base64 + mime', () => {
    const res = readInvoiceFile('2026_06', 'a.pdf')
    expect(res.mimeType).toBe('application/pdf')
    expect(Buffer.from(res.base64, 'base64').toString()).toBe('%PDF-1.4 test')
    expect(res.filePath).toBe(path.join(baseDir, '2026_06', 'a.pdf'))
  })

  it('rejects unsafe file names before touching the disk', () => {
    expect(() => readInvoiceFile('2026_06', '../../etc/passwd')).toThrow(TRPCError)
  })
})

describe('isExpensesDirAvailable', () => {
  it('is true for an existing base dir', () => {
    expect(isExpensesDirAvailable()).toBe(true)
  })

  it('is false when the base dir does not exist', () => {
    const saved = process.env.EXPENSES_DIR
    process.env.EXPENSES_DIR = path.join(baseDir, 'does-not-exist')
    expect(isExpensesDirAvailable()).toBe(false)
    process.env.EXPENSES_DIR = saved
  })
})

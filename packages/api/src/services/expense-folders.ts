import { TRPCError } from '@trpc/server'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Bulk invoice import reads invoice files directly from the local Google Drive
 * mount ("Expenses/YYYY_MM" folders). This only works when the server process
 * has filesystem access to that mount (e.g. running locally).
 */

const DEFAULT_EXPENSES_DIR =
  '/Users/alpir/Library/CloudStorage/GoogleDrive-alpirkritz@gmail.com/My Drive/Alpir/Jobs/Alpir Consulting/2 - Finanace/Expenses'

export const FOLDER_REGEX = /^\d{4}_\d{2}$/

const ALLOWED_EXT = ['.pdf', '.jpg', '.jpeg', '.png'] as const

export type InvoiceMimeType = 'application/pdf' | 'image/jpeg' | 'image/png'

export function getExpensesDir(): string {
  return process.env.EXPENSES_DIR?.trim() || DEFAULT_EXPENSES_DIR
}

export function isExpensesDirAvailable(): boolean {
  try {
    return fs.statSync(getExpensesDir()).isDirectory()
  } catch {
    return false
  }
}

export function extAllowed(fileName: string): boolean {
  return ALLOWED_EXT.includes(path.extname(fileName).toLowerCase() as (typeof ALLOWED_EXT)[number])
}

export function mimeForFile(fileName: string): InvoiceMimeType {
  const ext = path.extname(fileName).toLowerCase()
  if (ext === '.pdf') return 'application/pdf'
  if (ext === '.png') return 'image/png'
  return 'image/jpeg'
}

/** Parse a "YYYY_MM" folder name into calendar + bimonthly period parts. */
export function folderToPeriod(folder: string): { year: number; month: number; period: number } {
  if (!FOLDER_REGEX.test(folder)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'שם תיקייה לא חוקי' })
  }
  const [yearStr, monthStr] = folder.split('_')
  const year = Number(yearStr)
  const month = Number(monthStr)
  if (month < 1 || month > 12) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'חודש לא חוקי בשם התיקייה' })
  }
  return { year, month, period: Math.ceil(month / 2) }
}

/** Resolve a folder name to an absolute path, guaranteed to live inside the base dir. */
export function resolveSafeFolder(folder: string): string {
  if (!FOLDER_REGEX.test(folder)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'שם תיקייה לא חוקי' })
  }
  const base = path.resolve(getExpensesDir())
  const resolved = path.resolve(base, folder)
  const rel = path.relative(base, resolved)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'נתיב לא חוקי' })
  }
  return resolved
}

/** Resolve a file inside a folder to an absolute path, traversal-safe + extension-checked. */
export function resolveSafeFile(folder: string, fileName: string): string {
  if (
    typeof fileName !== 'string' ||
    fileName.length === 0 ||
    fileName.includes('/') ||
    fileName.includes('\\') ||
    fileName.includes('\0') ||
    fileName === '.' ||
    fileName === '..'
  ) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'שם קובץ לא חוקי' })
  }
  if (!extAllowed(fileName)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'סוג קובץ לא נתמך' })
  }
  const folderDir = resolveSafeFolder(folder)
  const resolved = path.resolve(folderDir, fileName)
  const rel = path.relative(folderDir, resolved)
  if (rel !== fileName || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: 'נתיב קובץ לא חוקי' })
  }
  return resolved
}

export type ExpenseFolderInfo = {
  folder: string
  year: number
  month: number
  period: number
  fileCount: number
}

/** List "YYYY_MM" folders under the base dir (Archive and non-matching entries excluded). */
export function listExpenseFolders(year?: number): ExpenseFolderInfo[] {
  const base = getExpensesDir()
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(base, { withFileTypes: true })
  } catch {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'תיקיית ההוצאות אינה נגישה מהשרת',
    })
  }

  const folders: ExpenseFolderInfo[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!FOLDER_REGEX.test(entry.name)) continue
    const { year: y, month, period } = folderToPeriod(entry.name)
    if (year != null && y !== year) continue
    let fileCount = 0
    try {
      fileCount = fs
        .readdirSync(path.join(base, entry.name), { withFileTypes: true })
        .filter((f) => f.isFile() && extAllowed(f.name))
        .length
    } catch {
      fileCount = 0
    }
    folders.push({ folder: entry.name, year: y, month, period, fileCount })
  }

  folders.sort((a, b) => b.folder.localeCompare(a.folder))
  return folders
}

export type ExpenseFileInfo = {
  fileName: string
  sizeBytes: number
  mimeType: InvoiceMimeType
  filePath: string
}

/** List invoice files in a folder (allowed extensions only). */
export function listFolderFiles(folder: string): ExpenseFileInfo[] {
  const folderDir = resolveSafeFolder(folder)
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(folderDir, { withFileTypes: true })
  } catch {
    throw new TRPCError({
      code: 'PRECONDITION_FAILED',
      message: 'תיקיית ההוצאות אינה נגישה מהשרת',
    })
  }

  const files: ExpenseFileInfo[] = []
  for (const entry of entries) {
    if (!entry.isFile() || !extAllowed(entry.name)) continue
    const filePath = path.join(folderDir, entry.name)
    let sizeBytes = 0
    try {
      sizeBytes = fs.statSync(filePath).size
    } catch {
      sizeBytes = 0
    }
    files.push({
      fileName: entry.name,
      sizeBytes,
      mimeType: mimeForFile(entry.name),
      filePath,
    })
  }

  files.sort((a, b) => a.fileName.localeCompare(b.fileName))
  return files
}

/** Read an invoice file and return its base64 payload + mime type. */
export function readInvoiceFile(folder: string, fileName: string): {
  filePath: string
  base64: string
  mimeType: InvoiceMimeType
} {
  const filePath = resolveSafeFile(folder, fileName)
  let buffer: Buffer
  try {
    buffer = fs.readFileSync(filePath)
  } catch {
    throw new TRPCError({ code: 'NOT_FOUND', message: 'הקובץ לא נמצא' })
  }
  return {
    filePath,
    base64: buffer.toString('base64'),
    mimeType: mimeForFile(fileName),
  }
}

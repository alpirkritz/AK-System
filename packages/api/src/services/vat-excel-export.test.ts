import { describe, it, expect } from 'vitest'
import { buildVatExcelExport, buildVatExcelFileName } from './vat-excel-export'

describe('buildVatExcelFileName', () => {
  it('names period and annual files', () => {
    expect(buildVatExcelFileName(2026, 3)).toBe('ספר-תגבולים-2026-מאי-יוני.csv')
    expect(buildVatExcelFileName(2026)).toBe('ספר-תגבולים-2026-שנתי.csv')
  })
})

describe('buildVatExcelExport', () => {
  it('includes BOM and Hebrew headers even when empty', () => {
    const { csv, fileName } = buildVatExcelExport([], 2026, 3)
    expect(fileName).toContain('2026')
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('סידורי')
    expect(csv).toContain('מעמ מהוצאות')
    expect(csv).toContain('סהכ הוצאות ללא מעמ')
  })

  it('computes expense VAT columns like the ledger', () => {
    const { csv } = buildVatExcelExport(
      [
        {
          taxCode: '2',
          category: 'קניות - עלות המכירות',
          entryType: 'expense',
          date: '2026-06-03',
          invoiceNumber: '3170167',
          description: 'קניות פתרון',
          amount: '101',
          isVatExempt: 0,
          deductionPercent: '1',
        },
      ],
      2026,
      3,
    )
    // 101 / 1.18 ≈ 85.59 excl VAT, VAT ≈ 15.41
    expect(csv).toContain('קניות פתרון')
    expect(csv).toContain('3170167')
    expect(csv).toContain('85.59')
    expect(csv).toContain('15.41')
  })

  it('puts VAT-exempt expense in the exempt column', () => {
    const { csv } = buildVatExcelExport(
      [
        {
          taxCode: '12',
          category: 'חניה ותחבצ',
          entryType: 'expense',
          date: '2026-06-01',
          invoiceNumber: null,
          description: 'פנגו',
          amount: '66',
          isVatExempt: 1,
          deductionPercent: null,
        },
      ],
      2026,
      3,
    )
    expect(csv).toContain('פנגו')
    // totalExpenseForAnnual = 66 in exempt path
    expect(csv).toContain('66.00')
  })

  it('fills income columns for income entries', () => {
    const { csv } = buildVatExcelExport(
      [
        {
          taxCode: '1',
          category: 'הכנסות',
          entryType: 'income',
          date: '2026-01-15',
          invoiceNumber: '10028',
          description: 'הרצאה',
          amount: '2950',
          isVatExempt: false,
          deductionPercent: null,
        },
      ],
      2026,
      1,
    )
    expect(csv).toContain('הרצאה')
    expect(csv).toContain('2950.00')
    expect(csv).toContain('2500.00') // excl VAT
    expect(csv).toContain('450.00') // VAT
  })
})

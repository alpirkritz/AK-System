import { test, expect, type Locator, type Page } from '@playwright/test'

async function openDocumentsTab(page: Page) {
  await page.goto('/finance?tab=documents')
  await expect(page.getByRole('heading', { name: 'פיננסים' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: '+ מסמך חדש' })).toBeVisible({ timeout: 15000 })
}

async function openNewDocument(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: '+ מסמך חדש' }).click()
  const dialog = page.getByRole('dialog', { name: 'מסמך חדש' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function createClientInline(dialog: Locator, name: string, taxId?: string) {
  await dialog.getByRole('button', { name: '+ חברה חדשה' }).click()
  await dialog.getByLabel('שם החברה').fill(name)
  if (taxId) await dialog.getByLabel('ח.פ. / עוסק מורשה').fill(taxId)
  await dialog.getByRole('button', { name: 'צור והמשך' }).click()
  await expect(dialog.getByLabel('לקוח')).toHaveValue(/.+/, { timeout: 30000 })
}

async function fillFirstLine(page: Page, description: string, unitPrice: string) {
  await page.getByLabel('פירוט').first().fill(description)
  await page.getByLabel('מחיר יחידה').first().fill(unitPrice)
}

test.describe('sales documents', () => {
  test('creates a client and saves a quote draft', async ({ page }) => {
    await openDocumentsTab(page)
    const dialog = await openNewDocument(page)

    await dialog.getByLabel('סוג מסמך').selectOption('quote')
    await createClientInline(dialog, 'לקוח הצעות מחיר', '515151515')

    await fillFirstLine(page, 'ליווי אסטרטגי', '2000')
    await expect(dialog.getByText(/2,360\.00/).first()).toBeVisible()

    await dialog.getByRole('button', { name: 'שמור טיוטה' }).click()
    await expect(dialog).toBeHidden({ timeout: 30000 })

    const row = page.getByRole('row', { name: /לקוח הצעות מחיר/ })
    await expect(row).toBeVisible({ timeout: 30000 })
    await expect(row).toContainText('הצעת מחיר')
    await expect(row).toContainText('טיוטה')
  })

  test('issues a tax invoice, numbers it and locks it for editing', async ({ page }) => {
    await openDocumentsTab(page)
    const dialog = await openNewDocument(page)

    await dialog.getByLabel('סוג מסמך').selectOption('tax_invoice')
    await createClientInline(dialog, 'לקוח חשבוניות')
    await fillFirstLine(page, 'ייעוץ חודשי', '1000')

    page.once('dialog', (confirmation) => confirmation.accept())
    await dialog.getByRole('button', { name: 'הנפק' }).click()
    await expect(dialog).toBeHidden({ timeout: 30000 })

    const row = page.getByRole('row', { name: /לקוח חשבוניות/ })
    await expect(row).toBeVisible({ timeout: 30000 })
    await expect(row).toContainText('הונפק')
    await expect(row).toContainText(/1,180\.00/)
    // Issued documents cannot be edited or deleted — only paid, credited or printed.
    await expect(row.getByRole('button', { name: 'ערוך' })).toHaveCount(0)
    await expect(row.getByRole('button', { name: 'מחק' })).toHaveCount(0)
    await expect(row.getByRole('button', { name: 'תשלום' })).toBeVisible()
  })

  test('records a payment against an issued invoice', async ({ page }) => {
    await openDocumentsTab(page)
    const row = page.getByRole('row', { name: /לקוח חשבוניות/ }).first()
    await expect(row).toBeVisible({ timeout: 30000 })
    await expect(row.getByRole('cell').nth(5)).toHaveText('—')

    await row.getByRole('button', { name: 'תשלום' }).click()
    const paymentDialog = page.getByRole('dialog', { name: 'הוספת תשלום' })
    await expect(paymentDialog).toBeVisible()
    await paymentDialog.getByRole('button', { name: 'שמור תשלום' }).click()
    await expect(paymentDialog).toBeHidden({ timeout: 30000 })

    await expect(row.getByRole('cell').nth(5)).toContainText(/1,180\.00/)
  })

  test('asks for an exchange rate before a foreign-currency document can be issued', async ({
    page,
  }) => {
    await openDocumentsTab(page)
    const dialog = await openNewDocument(page)

    await dialog.getByLabel('מטבע').selectOption('USD')
    await fillFirstLine(page, 'Consulting', '500')

    await expect(dialog.getByText('הזן שער המרה — נדרש לרישום המע"מ בשקלים.')).toBeVisible()
    await expect(dialog.getByRole('button', { name: 'הנפק' })).toBeDisabled()

    await dialog.getByLabel('שער המרה ל-₪').fill('3.7')
    await expect(dialog.getByRole('button', { name: 'הנפק' })).toBeEnabled()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('renders a printable document with the issuer branding', async ({ page }) => {
    await openDocumentsTab(page)
    const row = page.getByRole('row', { name: /לקוח חשבוניות/ }).first()
    await expect(row).toBeVisible({ timeout: 30000 })

    const [printPage] = await Promise.all([
      page.context().waitForEvent('page'),
      row.getByRole('link', { name: 'הדפס' }).click(),
    ])

    await printPage.waitForLoadState('domcontentloaded')
    await expect(printPage.getByText('חשבונית מס').first()).toBeVisible({ timeout: 30000 })
    await expect(printPage.getByText('לקוח חשבוניות').first()).toBeVisible()
    await expect(printPage.getByText('סה"כ לתשלום').first()).toBeVisible()
    await printPage.close()
  })

  test('shows an empty state that invites the first document', async ({ page }) => {
    await page.goto('/finance?tab=documents')
    await expect(page.getByRole('heading', { name: 'פיננסים' })).toBeVisible({ timeout: 15000 })
    // Filter to a year with no documents so the empty state is reachable deterministically.
    await page.getByLabel('סינון לפי שנה').selectOption(String(new Date().getFullYear() - 5))
    await expect(page.getByText('עדיין אין מסמכים')).toBeVisible({ timeout: 30000 })
    await expect(page.getByRole('button', { name: 'צור הצעת מחיר ראשונה' })).toBeVisible()
  })
})

import { test, expect, type Locator, type Page } from '@playwright/test'

const CATALOG_ITEM = 'הרצאה'
const CLIENT = 'לקוח תמחור'

async function openDocumentsTab(page: Page) {
  await page.goto('/finance?tab=documents')
  await expect(page.getByRole('heading', { name: 'פיננסים' })).toBeVisible({ timeout: 15000 })
  await expect(page.getByRole('button', { name: '+ מסמך חדש' })).toBeVisible({ timeout: 15000 })
}

/** Prices are resolved server-side per client; typing before they land would read a stale map. */
function waitForPrices(page: Page) {
  return page.waitForResponse(
    (response) => response.url().includes('pricesForClient') && response.status() === 200,
    { timeout: 30000 }
  )
}

/** The line editor autocompletes against this datalist, so the catalog must be loaded first. */
async function waitForCatalog(page: Page) {
  await expect(page.locator('#service-item-options option')).toHaveCount(1, { timeout: 30000 })
}

async function openNewDocument(page: Page): Promise<Locator> {
  await page.getByRole('button', { name: '+ מסמך חדש' }).click()
  const dialog = page.getByRole('dialog', { name: 'מסמך חדש' })
  await expect(dialog).toBeVisible()
  return dialog
}

async function createClientInline(page: Page, dialog: Locator, name: string) {
  await dialog.getByRole('button', { name: '+ חברה חדשה' }).click()
  await dialog.getByLabel('שם החברה').fill(name)
  await Promise.all([
    waitForPrices(page),
    dialog.getByRole('button', { name: 'צור והמשך' }).click(),
  ])
  await expect(dialog.getByLabel('לקוח')).toHaveValue(/.+/, { timeout: 30000 })
}

test.describe('pricing memory', () => {
  test('adds a catalog item with a default price', async ({ page }) => {
    await page.goto('/settings/pricing')
    await expect(page.getByRole('heading', { name: 'קטלוג פריטים ותמחור' })).toBeVisible({
      timeout: 15000,
    })

    await page.getByLabel('שם הפריט').fill(CATALOG_ITEM)
    await page.getByLabel('יחידה').selectOption('session')
    await page.getByLabel('מחיר ברירת מחדל').fill('3000')
    await page.getByRole('button', { name: '+ הוסף לקטלוג' }).click()

    const row = page.getByRole('row', { name: new RegExp(CATALOG_ITEM) })
    await expect(row).toBeVisible({ timeout: 30000 })
    await expect(row).toContainText(/3,000\.00/)
    await expect(row).toContainText('מפגש')
  })

  test('fills the catalog default for a new client and remembers what was charged', async ({
    page,
  }) => {
    await openDocumentsTab(page)
    const dialog = await openNewDocument(page)
    await waitForCatalog(page)
    await createClientInline(page, dialog, CLIENT)

    await page.getByLabel('פירוט').first().fill(CATALOG_ITEM)
    await expect(page.getByLabel('מחיר יחידה').first()).toHaveValue('3000')
    await expect(dialog.getByText('ברירת מחדל מהקטלוג')).toBeVisible()

    // Charge this client a different price and issue it, so there is history to remember.
    await page.getByLabel('מחיר יחידה').first().fill('3500')
    await expect(dialog.getByText('הוזן ידנית')).toBeVisible()

    page.once('dialog', (confirmation) => confirmation.accept())
    await dialog.getByRole('button', { name: 'הנפק' }).click()
    await expect(dialog).toBeHidden({ timeout: 30000 })
  })

  test('offers the last price charged to this client, with the catalog price alongside', async ({
    page,
  }) => {
    await openDocumentsTab(page)
    const dialog = await openNewDocument(page)
    await waitForCatalog(page)
    await Promise.all([
      waitForPrices(page),
      dialog.getByLabel('לקוח').selectOption({ label: CLIENT }),
    ])

    await page.getByLabel('פירוט').first().fill(CATALOG_ITEM)
    await expect(page.getByLabel('מחיר יחידה').first()).toHaveValue('3500')
    await expect(dialog.getByText(/מחיר אחרון ללקוח זה/)).toBeVisible()
    // The catalog default stays on screen so the difference is never silent.
    await expect(dialog.getByText(/מחיר הקטלוג/)).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('keeps a different client on the catalog default', async ({ page }) => {
    await openDocumentsTab(page)
    const dialog = await openNewDocument(page)
    await waitForCatalog(page)
    await createClientInline(page, dialog, 'לקוח אחר לגמרי')

    await page.getByLabel('פירוט').first().fill(CATALOG_ITEM)
    await expect(page.getByLabel('מחיר יחידה').first()).toHaveValue('3000')
    await expect(dialog.getByText('ברירת מחדל מהקטלוג')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })
})

import { test, expect } from '@playwright/test'

test.describe('VAT bulk import from folder', () => {
  test('opens the folder-import modal from the VAT tab', async ({ page }) => {
    await page.goto('/finance')
    await expect(page.getByRole('heading', { name: 'פיננסים' })).toBeVisible({ timeout: 15000 })

    // Switch to the VAT reporting tab
    await page.getByRole('button', { name: /דיווח מע"מ/ }).click()

    // The bulk-import trigger is present and opens the modal
    const trigger = page.getByRole('button', { name: /ייבוא מתיקייה/ })
    await expect(trigger).toBeVisible({ timeout: 10000 })
    await trigger.click()

    await expect(
      page.getByRole('heading', { name: /ייבוא חשבוניות מתיקייה/ }),
    ).toBeVisible({ timeout: 10000 })

    // Close it again
    await page.getByRole('button', { name: '✕' }).click()
    await expect(
      page.getByRole('heading', { name: /ייבוא חשבוניות מתיקייה/ }),
    ).toHaveCount(0)
  })

  test('exposes the Excel export button on the VAT tab', async ({ page }) => {
    await page.goto('/finance')
    await expect(page.getByRole('heading', { name: 'פיננסים' })).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: /דיווח מע"מ/ }).click()
    await expect(page.getByRole('button', { name: /ייצא לאקסל/ })).toBeVisible({ timeout: 10000 })
  })
})

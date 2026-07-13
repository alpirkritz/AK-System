import { test, expect } from '@playwright/test'

test.describe('Trading journal tab', () => {
  test('opens the journal tab and shows the daily summary + ranking', async ({ page }) => {
    await page.goto('/finance')
    await expect(page.getByRole('heading', { name: 'פיננסים' })).toBeVisible({ timeout: 15000 })

    // Switch to the trading journal tab
    await page.getByRole('button', { name: /יומן מסחר/ }).click()

    // Period filter and summary cards render
    await expect(page.getByRole('button', { name: 'היום' })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('P&L ממומש')).toBeVisible()
    await expect(page.getByText('סנכרון אחרון')).toBeVisible()

    // Ranking section header is present
    await expect(page.getByText('איפה הרווחתי ואיפה הפסדתי')).toBeVisible()

    // Switching period keeps the tab functional
    await page.getByRole('button', { name: 'הכל' }).click()
    await expect(page.getByText('עסקאות בתקופה')).toBeVisible()
  })

  test('exposes the Notion history import in the import tab', async ({ page }) => {
    await page.goto('/finance')
    await expect(page.getByRole('heading', { name: 'פיננסים' })).toBeVisible({ timeout: 15000 })

    await page.getByRole('button', { name: /ייבוא/ }).first().click()
    await expect(page.getByRole('heading', { name: 'ייבוא היסטוריה מ-Notion' })).toBeVisible({ timeout: 10000 })
  })
})

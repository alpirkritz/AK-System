import { test, expect } from '@playwright/test'

test.describe('Agent triggers panel', () => {
  test('טריגרים panel expands and saves schedule', async ({ page }) => {
    await page.goto('/agents')
    await expect(page.getByRole('heading', { name: 'עוזר', exact: true })).toBeVisible({
      timeout: 15000,
    })

    // The panel only renders for a specific agent, not the general assistant.
    const modeSelect = page.getByLabel('מצב')
    await expect(modeSelect).toBeEnabled({ timeout: 15000 })
    await modeSelect.selectOption('03_morning_briefing')

    await page.getByRole('button', { name: /טריגרים/ }).click()
    await expect(page.getByText('סוכן מלא AI')).toBeVisible()
    await expect(page.getByText('טריגר יומי פעיל')).toBeVisible()

    const timesInput = page.getByPlaceholder('07:00, 20:00')
    await timesInput.fill('07:15')
    await page.getByRole('button', { name: 'שמור', exact: true }).click()
    await expect(page.getByText('נשמר', { exact: true })).toBeVisible({ timeout: 15000 })

    await expect(page.getByRole('button', { name: 'הרץ עכשיו' })).toBeVisible()
  })
})

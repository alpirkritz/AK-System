import { test, expect } from '@playwright/test'

test.describe('Agent triggers panel', () => {
  test('טריגרים panel expands and saves schedule', async ({ page }) => {
    await page.goto('/agents')
    await expect(page.getByRole('heading', { name: 'סוכנים' })).toBeVisible({ timeout: 15000 })

    // Wait for agents to load
    await expect(page.getByText('טוען סוכנים...')).not.toBeVisible({ timeout: 15000 })

    // Expand triggers panel
    await page.getByRole('button', { name: /טריגרים/ }).click()
    await expect(page.getByText('סוכן מלא AI')).toBeVisible()

    // Select schedulable agent if not already selected
    const morningBtn = page.getByRole('button', { name: /תדריך בוקר|Morning|03_morning/i }).first()
    if (await morningBtn.isVisible().catch(() => false)) {
      await morningBtn.click()
    }

    await expect(page.getByText('טריגר יומי פעיל').or(page.getByText('הרצה ידנית בלבד'))).toBeVisible()

    const schedulable = await page.getByText('טריגר יומי פעיל').isVisible().catch(() => false)
    if (schedulable) {
      const timesInput = page.getByPlaceholder('07:00, 20:00')
      await timesInput.fill('07:15')
      await page.getByRole('button', { name: 'שמור' }).click()
      await expect(page.getByText('נשמר')).toBeVisible({ timeout: 10000 })
    }

    await expect(page.getByRole('button', { name: 'הרץ עכשיו' })).toBeVisible()
  })
})

import { test, expect } from '@playwright/test'

test.describe('Notification preferences', () => {
  test('page loads with catalog and channel status', async ({ page }) => {
    await page.goto('/settings/notifications')
    await expect(page.getByTestId('notification-prefs')).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('heading', { name: 'התראות וערוצים' })).toBeVisible()
    await expect(page.getByText('מצב ערוצים')).toBeVisible()
    await expect(page.getByText('תדריך בוקר')).toBeVisible({ timeout: 20000 })
  })

  test('settings links to the notifications hub', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'הגדרות' })).toBeVisible({ timeout: 20000 })
    const link = page.getByRole('link', { name: /התראות וערוצים/ })
    await expect(link).toBeVisible()
    await link.click()
    await expect(page).toHaveURL(/\/settings\/notifications/)
    await expect(page.getByTestId('notification-prefs')).toBeVisible({ timeout: 20000 })
  })
})

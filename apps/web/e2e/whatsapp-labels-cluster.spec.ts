import { test, expect } from '@playwright/test'

test.describe('WhatsApp label cluster parameter', () => {
  test('labels tab keeps add/delete controls and exposes סכם כאשכול as a toggle', async ({ page }) => {
    await page.goto('/settings/whatsapp')
    await expect(page.getByRole('heading', { name: 'WhatsApp' })).toBeVisible({ timeout: 20000 })

    await page.getByRole('button', { name: 'תוויות' }).click()
    await expect(page.getByText('סכם כאשכול')).toBeVisible()
    await expect(page.getByRole('switch')).toBeVisible()
    await expect(page.getByRole('button', { name: 'הוסף תווית' })).toBeVisible()
    await expect(page.getByPlaceholder(/שם תווית/)).toBeVisible()
  })
})

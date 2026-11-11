import { test, expect } from '@playwright/test'

// Google's OAuth consent screen needs these reachable without a session.
test.describe('public legal pages', () => {
  test('/about renders and links to /privacy', async ({ page }) => {
    await page.goto('/about')
    await expect(page.getByRole('heading', { name: 'ARO / AK System' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Privacy policy/ })).toHaveAttribute('href', '/privacy')
  })

  test('/privacy renders and names the drive.file scope', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.getByRole('heading', { name: /Privacy Policy/ })).toBeVisible()
    await expect(page.locator('code', { hasText: 'drive.file' })).toBeVisible()
  })
})

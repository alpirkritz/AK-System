import { test, expect } from '@playwright/test'

// Fold 7 approximate CSS widths
const FOLDED = { width: 380, height: 880 }
const UNFOLDED = { width: 900, height: 1100 }

async function expectChatReady(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { name: /צ.?אט/ })).toBeVisible({ timeout: 20000 })
  // ChatPanel loads dynamically (ssr: false)
  await expect(page.getByPlaceholder('כתוב הודעה...')).toBeVisible({ timeout: 20000 })
}

test.describe('Mobile app + notifications', () => {
  test('chat page loads with input', async ({ page }) => {
    await page.goto('/chat')
    await expectChatReady(page)
    await expect(page.getByRole('button', { name: 'שלח' })).toBeVisible()
  })

  test('settings has an enable-notifications control', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'הגדרות' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('enable-notifications')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('test-notification')).toBeVisible()
  })

  test('notification bell visible in layout', async ({ page }) => {
    await page.goto('/chat')
    await expect(page.getByTestId('notification-bell')).toBeVisible({ timeout: 20000 })
  })

  test('notifications page loads', async ({ page }) => {
    await page.goto('/notifications')
    await expect(page.getByRole('heading', { name: 'התראות' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('notifications-empty')).toBeVisible({ timeout: 20000 })
  })

  test('chat is usable folded (cover screen)', async ({ page }) => {
    await page.setViewportSize(FOLDED)
    await page.goto('/chat')
    await expectChatReady(page)
    await expect(page.locator('nav.fixed')).toBeVisible()
  })

  test('chat is usable unfolded (tablet width)', async ({ page }) => {
    await page.setViewportSize(UNFOLDED)
    await page.goto('/chat')
    await expectChatReady(page)
    await expect(page.getByRole('button', { name: 'שלח' })).toBeVisible()
  })
})

import { test, expect } from '@playwright/test'

test.describe('Web Google calendar connect (regression)', () => {
  test('settings still exposes the Google connect card', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'הגדרות' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('חשבונות Google')).toBeVisible()
    await expect(page.getByRole('link', { name: 'חבר', exact: true }).first()).toBeVisible()
    await page.screenshot({
      path: 'test-results/qa-ui-settings-google-connect.png',
      fullPage: false,
    })
  })

  test('calendar OAuth start redirects to Google', async ({ request }) => {
    const response = await request.get('/api/auth/google-calendar', {
      maxRedirects: 0,
    })
    expect([302, 307]).toContain(response.status())
    const location = response.headers()['location'] ?? ''
    expect(location).toMatch(/accounts\.google\.com/)
  })
})

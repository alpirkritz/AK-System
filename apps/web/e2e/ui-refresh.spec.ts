import { test, expect } from '@playwright/test'

test.describe('UI refresh — unified assistant', () => {
  test('/chat renders the unified assistant with a mode picker', async ({ page }) => {
    await page.goto('/chat')
    await expect(page.getByRole('heading', { name: 'עוזר', exact: true })).toBeVisible({ timeout: 20000 })
    const modeSelect = page.locator('#assistant-mode')
    await expect(modeSelect).toBeVisible()
    await expect(modeSelect.locator('option', { hasText: 'עוזר כללי' })).toHaveCount(1)
  })

  test('/agents redirects into the unified assistant', async ({ page }) => {
    await page.goto('/agents')
    await expect(page).toHaveURL(/\/chat/, { timeout: 20000 })
    await expect(page.getByRole('heading', { name: 'עוזר', exact: true })).toBeVisible({ timeout: 20000 })
  })
})

test.describe('UI refresh — dedup', () => {
  test('/recurring redirects to the meetings recurring filter', async ({ page }) => {
    await page.goto('/recurring')
    await expect(page).toHaveURL(/\/meetings\?filter=recurring/, { timeout: 20000 })
    await expect(page.getByRole('heading', { name: 'פגישות' })).toBeVisible({ timeout: 20000 })
  })

  test('meetings page exposes recurring filter chips', async ({ page }) => {
    await page.goto('/meetings')
    await expect(page.getByRole('button', { name: 'כל הפגישות' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('button', { name: /חוזרות/ })).toBeVisible()
  })
})

test.describe('UI refresh — task filters', () => {
  test('tasks page shows status filters and hides completed by default', async ({ page }) => {
    await page.goto('/tasks')
    await expect(page.getByRole('heading', { name: 'משימות' })).toBeVisible({ timeout: 20000 })
    const openChip = page.getByRole('button', { name: 'פתוחות' })
    await expect(openChip).toBeVisible()
    await expect(openChip).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: 'הושלמו' })).toBeVisible()
    // Cancelled tasks get their own tab so they are never filed under "הושלמו".
    await expect(page.getByRole('button', { name: 'בוטלו' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'הכל' })).toBeVisible()
  })
})

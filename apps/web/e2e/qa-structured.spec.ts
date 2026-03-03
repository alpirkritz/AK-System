import { test, expect } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001'
function nav(page: { goto: (url: string) => Promise<unknown> }, path: string) {
  return page.goto(path === '/' ? BASE + '/' : BASE + path)
}

test.describe('QA מסודר – כפתורים, קשרים, נראות', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /שלום/ })).toBeVisible({ timeout: 15000 })
  })

  test('נראות: דשבורד – כותרות, כרטיסים, ניווט', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /שלום/ })).toBeVisible()
    await expect(page.getByText('פגישות קרובות').first()).toBeVisible()
    await expect(page.getByText(/משימות פתוחות|אין משימות פתוחות/).first()).toBeVisible()
    await expect(page.locator('.card').first()).toBeVisible()
    await expect(page.locator('aside').getByText('דשבורד')).toBeVisible()
    await expect(page.locator('aside').getByText('פרויקטים')).toBeVisible()
    await expect(page.locator('aside').getByText('פגישות')).toBeVisible()
    await expect(page.locator('aside').getByText('אנשים')).toBeVisible()
    await expect(page.locator('aside').getByText('משימות')).toBeVisible()
  })

  test('כפתורים: לחיצה על כפתורי הוספה וסגירת מודלים', async ({ page }) => {
    await nav(page, '/people')
    await page.waitForURL(/\/people/, { timeout: 15000 })
    await expect(page.getByRole('button', { name: /הוסף איש קשר/ })).toBeVisible()
    await page.getByRole('button', { name: /הוסף איש קשר/ }).click()
    await expect(page.locator('.modal').getByRole('button', { name: 'שמור' })).toBeVisible({ timeout: 5000 })
    await expect(page.locator('.modal').getByRole('button', { name: 'ביטול' })).toBeVisible()
    await page.locator('.modal').getByRole('button', { name: 'ביטול' }).click()
    await expect(page.locator('.modal')).not.toBeVisible()

    await nav(page, '/projects')
    await page.waitForURL(/\/projects/, { timeout: 10000 })
    await page.getByRole('button', { name: /פרויקט חדש/ }).click()
    await expect(page.locator('.modal')).toBeVisible()
    await page.locator('.modal').getByRole('button', { name: 'ביטול' }).click()
    await expect(page.locator('.modal')).not.toBeVisible()

    await nav(page, '/meetings')
    await page.waitForURL(/\/meetings/, { timeout: 10000 })
    await page.getByRole('button', { name: /פגישה חדשה/ }).click()
    await expect(page.locator('.modal')).toBeVisible()
    await page.locator('.modal').getByRole('button', { name: 'ביטול' }).click()

    await nav(page, '/tasks')
    await page.waitForURL(/\/tasks/, { timeout: 10000 })
    await page.getByRole('button', { name: /משימה חדשה/ }).click()
    await expect(page.locator('.modal')).toBeVisible()
    await page.locator('.modal').getByRole('button', { name: 'ביטול' }).click()
  })

  test('קשרים: איש קשר ↔ פגישה ↔ משימה ↔ פרויקט – אין ניתוק ישויות', async ({ page }) => {
    await nav(page, '/people')
    await page.waitForURL(/\/people/, { timeout: 15000 })
    await page.getByRole('button', { name: /הוסף איש קשר/ }).click()
    await expect(page.locator('.modal')).toBeVisible({ timeout: 5000 })
    await page.locator('.modal').getByPlaceholder('שם').fill('רונית QA')
    await page.locator('.modal').getByPlaceholder('תפקיד').fill('מנהלת')
    await page.locator('.modal').getByRole('button', { name: 'שמור' }).click()
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText('רונית QA').first()).toBeVisible({ timeout: 10000 })

    await nav(page, '/projects')
    await page.waitForURL(/\/projects/, { timeout: 10000 })
    await page.getByRole('button', { name: /פרויקט חדש/ }).click()
    await expect(page.locator('.modal')).toBeVisible({ timeout: 5000 })
    await page.locator('.modal').getByPlaceholder('שם').fill('פרויקט QA')
    await page.locator('.modal').getByRole('button', { name: 'שמור' }).click()
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText('פרויקט QA').first()).toBeVisible({ timeout: 10000 })

    await nav(page, '/meetings')
    await page.waitForURL(/\/meetings/, { timeout: 10000 })
    await page.getByRole('button', { name: /פגישה חדשה/ }).click()
    await expect(page.locator('.modal')).toBeVisible({ timeout: 5000 })
    await page.locator('.modal').getByPlaceholder('שם הפגישה').fill('פגישת QA')
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    await page.locator('.modal').getByLabel('תאריך').fill(tomorrow.toISOString().slice(0, 10))
    await page.locator('.modal').getByLabel('שעה').fill('14:00')
    await page.locator('.modal').getByLabel('פרויקט').selectOption({ label: 'פרויקט QA' })
    await page.locator('.modal').getByText('רונית QA').click()
    await page.locator('.modal').getByRole('button', { name: 'שמור' }).click()
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText('פגישת QA').first()).toBeVisible({ timeout: 10000 })

    await page.locator('a[href^="/meetings/"]').filter({ hasText: 'פגישת QA' }).first().click()
    await expect(page.getByRole('heading', { name: 'פגישת QA' })).toBeVisible()
    await expect(page.getByText('רונית QA').first()).toBeVisible()
    await expect(page.getByText('פרויקט QA').first()).toBeVisible()

    await page.getByRole('button', { name: '+ משימה' }).click()
    await expect(page.locator('.modal')).toBeVisible({ timeout: 5000 })
    await page.getByPlaceholder('מה צריך לעשות?').fill('משימת QA')
    await page.getByRole('button', { name: 'שמור' }).click()
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText('משימת QA').first()).toBeVisible({ timeout: 10000 })

    await nav(page, '/tasks')
    await expect(page.getByText('משימת QA').first()).toBeVisible()

    await nav(page, '/projects')
    await page.locator('a[href^="/projects/"]').filter({ hasText: 'פרויקט QA' }).first().click()
    await expect(page.getByRole('heading', { name: 'פרויקט QA' })).toBeVisible()
    await expect(page.getByText('פגישת QA').first()).toBeVisible()
    await expect(page.getByText('משימת QA').first()).toBeVisible()
  })

  test('נראות: כל דפי הניווט טוענים ומציגים תוכן', async ({ page }) => {
    const pages: { path: string; heading: string }[] = [
      { path: '/', heading: 'שלום' },
      { path: '/projects', heading: 'פרויקטים' },
      { path: '/meetings', heading: 'פגישות' },
      { path: '/people', heading: 'אנשים' },
      { path: '/tasks', heading: 'משימות' },
      { path: '/recurring', heading: 'פגישות חוזרות' },
    ]
    for (const { path, heading } of pages) {
      await nav(page, path)
      if (path !== '/') await page.waitForURL(new RegExp(path.slice(1)), { timeout: 10000 })
      await expect(page.getByRole('heading', { name: new RegExp(heading) })).toBeVisible({ timeout: 10000 })
    }
    await nav(page, '/calendar')
    await expect(page).toHaveURL(/\/calendar/)
  })
})

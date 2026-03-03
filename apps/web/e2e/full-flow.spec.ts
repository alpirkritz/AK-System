import { test, expect } from '@playwright/test'

const BASE = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3001'
function nav(page: { goto: (url: string) => Promise<unknown> }, path: string) {
  return page.goto(path === '/' ? BASE + '/' : BASE + path)
}

test.describe('E2E – פונקציונליות מלאה', () => {
  test('זרימה מלאה: אנשים → פרויקטים → פגישות → משימות → דשבורד', async ({ page }) => {
    await page.goto('/')

    // —— דשבורד ——
    await expect(page.getByRole('heading', { name: /שלום/ })).toBeVisible()

    // —— ניווט: אנשים ——
    await nav(page, '/people')
    await page.waitForURL(/\/people/, { timeout: 15000 })
    await expect(page.getByRole('button', { name: /הוסף איש קשר/ })).toBeVisible({ timeout: 15000 })

    // הוספת איש קשר
    await page.getByRole('button', { name: /הוסף איש קשר/ }).click()
    await expect(page.locator('.modal')).toBeVisible({ timeout: 5000 })
    await page.locator('.modal').getByPlaceholder('שם').fill('דני בדיקה')
    await page.locator('.modal').getByPlaceholder('תפקיד').fill('מפתח')
    await page.locator('.modal').getByPlaceholder('email').fill('danny@test.com')
    await page.locator('.modal').getByRole('button', { name: 'שמור' }).click()
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText('דני בדיקה').first()).toBeVisible()
    await expect(page.getByText('מפתח').first()).toBeVisible()

    // —— ניווט: פרויקטים ——
    await nav(page, '/projects')
    await page.waitForURL(/\/projects/, { timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'פרויקטים' })).toBeVisible()

    // הוספת פרויקט
    await page.getByRole('button', { name: /פרויקט חדש/ }).click()
    await expect(page.locator('.modal')).toBeVisible({ timeout: 5000 })
    await page.locator('.modal').getByPlaceholder('שם').fill('פרויקט E2E')
    await page.locator('.modal').getByRole('button', { name: 'שמור' }).click()
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText('פרויקט E2E').first()).toBeVisible()

    // —— ניווט: פגישות ——
    await nav(page, '/meetings')
    await page.waitForURL(/\/meetings/, { timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'פגישות' })).toBeVisible()

    // הוספת פגישה
    await page.getByRole('button', { name: /פגישה חדשה/ }).click()
    await expect(page.locator('.modal')).toBeVisible({ timeout: 5000 })
    await page.locator('.modal').getByPlaceholder('שם הפגישה').fill('פגישת סטטוס')
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    const dateStr = tomorrow.toISOString().slice(0, 10)
    await page.locator('.modal').getByLabel('תאריך').fill(dateStr)
    await page.locator('.modal').getByLabel('שעה').fill('10:00')
    await page.locator('.modal').getByLabel('פרויקט').selectOption({ label: 'פרויקט E2E' })
    await page.locator('.modal').getByText('דני בדיקה').click()
    await page.locator('.modal').getByRole('button', { name: 'שמור' }).click()
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText('פגישת סטטוס').first()).toBeVisible()

    // כניסה לפרט פגישה (קישור עם href שמכיל את id הפגישה)
    await page.locator('a[href^="/meetings/"]').filter({ hasText: 'פגישת סטטוס' }).first().click()
    await expect(page.getByRole('heading', { name: 'פגישת סטטוס' })).toBeVisible()
    await expect(page.getByText('דני בדיקה')).toBeVisible()

    // הוספת משימה מהפגישה
    await page.getByRole('button', { name: '+ משימה' }).click()
    await expect(page.locator('.modal')).toBeVisible({ timeout: 5000 })
    await page.locator('.modal').getByPlaceholder('מה צריך לעשות?').fill('לסיים דוח')
    await page.locator('.modal').getByRole('button', { name: 'שמור' }).click()
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText('לסיים דוח').first()).toBeVisible()

    // סימון משימה כבוצעה (checkbox)
    const taskRow = page.locator('.task-row').filter({ hasText: 'לסיים דוח' })
    await taskRow.locator('.checkbox').click()
    await expect(taskRow.locator('.checkbox')).toHaveClass(/checked/, { timeout: 5000 })

    // —— ניווט: משימות ——
    await nav(page, '/tasks')
    await page.waitForURL(/\/tasks/, { timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'משימות' })).toBeVisible()
    await expect(page.getByText('לסיים דוח').first()).toBeVisible()

    // הוספת משימה ישירה מדף משימות
    await page.getByRole('button', { name: /משימה חדשה/ }).click()
    await expect(page.locator('.modal')).toBeVisible({ timeout: 5000 })
    await page.locator('.modal').getByPlaceholder('מה צריך לעשות?').fill('משימה מדף משימות')
    await page.locator('.modal').getByRole('button', { name: 'שמור' }).click()
    await expect(page.locator('.modal')).not.toBeVisible({ timeout: 10000 })
    await expect(page.getByText('משימה מדף משימות').first()).toBeVisible()

    // —— ניווט: חוזרות ——
    await nav(page, '/recurring')
    await page.waitForURL(/\/recurring/, { timeout: 10000 })
    await expect(page.getByRole('heading', { name: 'פגישות חוזרות' })).toBeVisible()

    // —— ניווט: פרויקט → פרט פרויקט ——
    await nav(page, '/projects')
    await page.waitForURL(/\/projects/, { timeout: 10000 })
    await page.locator('a[href^="/projects/"]').filter({ hasText: 'פרויקט E2E' }).first().click()
    await expect(page.getByRole('heading', { name: 'פרויקט E2E' })).toBeVisible()
    await expect(page.getByText('פגישת סטטוס').first()).toBeVisible()
    await expect(page.getByText('לסיים דוח').first()).toBeVisible()

    // —— חזרה לדשבורד ——
    await nav(page, '/')
    await expect(page.getByRole('heading', { name: /שלום/ })).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('פגישות קרובות').first()).toBeVisible()
    await expect(page.getByText('משימות פתוחות').first()).toBeVisible()
  })

  test('ניווט לכל הדפים', async ({ page }) => {
    await page.goto('/')
    await nav(page, '/projects')
    await expect(page.getByRole('heading', { name: 'פרויקטים' })).toBeVisible()
    await nav(page, '/meetings')
    await expect(page.getByRole('heading', { name: 'פגישות' })).toBeVisible()
    await nav(page, '/people')
    await expect(page.getByRole('heading', { name: 'אנשים' })).toBeVisible()
    await nav(page, '/tasks')
    await expect(page.getByRole('heading', { name: 'משימות' })).toBeVisible()
    await nav(page, '/recurring')
    await expect(page.getByRole('heading', { name: 'פגישות חוזרות' })).toBeVisible()
    await nav(page, '/calendar')
    await expect(page).toHaveURL(/\/calendar/)
    await nav(page, '/')
    await expect(page.getByRole('heading', { name: /שלום/ })).toBeVisible()
  })
})

import { test, expect } from '@playwright/test'

test.describe('Reading list', () => {
  test('page loads with its heading and add control', async ({ page }) => {
    await page.goto('/reading-list')
    await expect(page.getByRole('heading', { name: 'רשימת קריאה' })).toBeVisible({
      timeout: 20000,
    })
    await expect(page.getByRole('button', { name: 'הוסף קישור' }).first()).toBeVisible()
  })

  test('nav links to the reading list', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('link', { name: 'רשימת קריאה' }).first()).toBeVisible({
      timeout: 20000,
    })
  })

  test('add form validates a malformed URL before saving', async ({ page }) => {
    await page.goto('/reading-list')
    await page.getByRole('button', { name: 'הוסף קישור' }).first().click()

    await page.locator('#reading-url').fill('not-a-url')
    await page.locator('#reading-title').fill('כותרת')
    await page.getByRole('button', { name: 'שמור לרשימה' }).click()

    await expect(page.getByText(/כתובת לא תקינה/)).toBeVisible()
  })

  test('add form requires a title', async ({ page }) => {
    await page.goto('/reading-list')
    await page.getByRole('button', { name: 'הוסף קישור' }).first().click()

    await page.locator('#reading-url').fill('https://example.com/article')
    await page.getByRole('button', { name: 'שמור לרשימה' }).click()

    await expect(page.getByText('צריך כותרת לפריט')).toBeVisible()
  })

  test('saves an item, marks it read, then deletes it', async ({ page }) => {
    const title = `כתבה לבדיקה ${Date.now()}`
    await page.goto('/reading-list')

    await page.getByRole('button', { name: 'הוסף קישור' }).first().click()
    await page.locator('#reading-url').fill('https://example.com/e2e-article')
    await page.locator('#reading-title').fill(title)
    await page.getByRole('button', { name: 'שמור לרשימה' }).click()

    await expect(page.getByText('נשמר לרשימה')).toBeVisible({ timeout: 20000 })
    const card = page.locator('.card').filter({ hasText: title })
    await expect(card).toBeVisible()
    await expect(card.getByText('example.com')).toBeVisible()

    await card.getByRole('button', { name: 'סמן כנקרא' }).click()
    await expect(card.getByRole('button', { name: 'סמן כלא נקרא' })).toBeVisible({
      timeout: 20000,
    })

    await card.getByRole('button', { name: 'מחק' }).click()
    await expect(card.getByText(/לא ניתן לשחזר/)).toBeVisible()
    await card.getByRole('button', { name: 'מחק' }).click()

    await expect(page.getByText('הפריט נמחק')).toBeVisible({ timeout: 20000 })
    await expect(page.locator('.card').filter({ hasText: title })).toHaveCount(0)
  })

  test('unread filter hides items already marked read', async ({ page }) => {
    const title = `סינון ${Date.now()}`
    await page.goto('/reading-list')

    await page.getByRole('button', { name: 'הוסף קישור' }).first().click()
    await page.locator('#reading-url').fill('https://example.com/filter-test')
    await page.locator('#reading-title').fill(title)
    await page.getByRole('button', { name: 'שמור לרשימה' }).click()

    const card = page.locator('.card').filter({ hasText: title })
    await expect(card).toBeVisible({ timeout: 20000 })
    await card.getByRole('button', { name: 'סמן כנקרא' }).click()
    await expect(card.getByRole('button', { name: 'סמן כלא נקרא' })).toBeVisible({
      timeout: 20000,
    })

    await page.getByRole('button', { name: 'לא נקרא', exact: true }).click()
    await expect(page.locator('.card').filter({ hasText: title })).toHaveCount(0)

    await page.getByRole('button', { name: 'נקרא', exact: true }).click()
    await expect(page.locator('.card').filter({ hasText: title })).toBeVisible()
  })
})

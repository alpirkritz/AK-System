import { test, expect } from '@playwright/test'

test.describe('Meeting types & people review', () => {
  test('create a meeting type in settings and see it in the meeting form', async ({ page }) => {
    const typeName = 'בדיקה-סוג-' + Date.now()

    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'הגדרות' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('סוגי פגישות')).toBeVisible({ timeout: 20000 })

    const addInput = page.getByPlaceholder('שם סוג חדש…')
    await addInput.scrollIntoViewIfNeeded()
    await addInput.fill(typeName)
    const addBtn = page.getByRole('button', { name: '+ סוג חדש' })
    await expect(addBtn).toBeEnabled()
    await addBtn.click()
    await expect(page.getByText(typeName)).toBeVisible({ timeout: 10000 })

    // The type filter chip and the meeting-form selector now reflect the new type
    await page.goto('/meetings')
    await expect(page.getByRole('button', { name: 'כל הסוגים' })).toBeVisible({ timeout: 20000 })

    await page.getByRole('button', { name: '+ פגישה חדשה' }).click()
    await expect(page.getByRole('option', { name: typeName })).toBeAttached({ timeout: 10000 })
  })

  test('people review queue shows an empty state when nothing is pending', async ({ page }) => {
    await page.goto('/people')
    await page.getByRole('button', { name: /לאישור/ }).click()
    await expect(page.getByText('אין אנשים שממתינים לאישור ✓')).toBeVisible({ timeout: 15000 })
  })
})

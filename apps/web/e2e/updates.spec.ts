import { test, expect } from '@playwright/test'

test.describe('Updates feed', () => {
  test('page loads with heading and feed tab', async ({ page }) => {
    await page.goto('/updates')
    await expect(page.getByRole('heading', { name: 'עדכונים' })).toBeVisible({
      timeout: 20000,
    })
    await expect(page.getByRole('button', { name: 'פיד', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'מקורות', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'תמצית הפיד' })).toBeVisible()
    await expect(page.getByTestId('feed-digest')).toBeVisible()
    await expect(page.getByText(/לחץ על תמצית הפיד/)).toBeVisible()
  })

  test('sources tab shows the add-source form', async ({ page }) => {
    await page.goto('/updates')
    await page.getByRole('button', { name: 'מקורות', exact: true }).click()
    await expect(page.getByRole('button', { name: 'הוסף מקור' })).toBeVisible()
    await expect(page.getByLabel('שם (תצוגה)')).toBeVisible()
    await expect(page.getByLabel('כתובת RSS')).toBeVisible()
    await expect(page.getByText(/חשבונות X/)).toBeVisible()
  })
})

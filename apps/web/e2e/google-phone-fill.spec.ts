import { test, expect } from '@playwright/test'

test('google phone fill opens a review dialog', async ({ page }) => {
  await page.goto('/people')
  await page.getByTestId('google-phone-fill').click()
  const modal = page.getByTestId('google-phone-fill-modal')
  await expect(modal).toBeVisible()
  await expect(modal.locator('#google-phone-fill-title')).toHaveText('טלפונים מגוגל')
  await expect(modal.getByText('מחפש התאמות…')).toBeHidden({ timeout: 20000 })
  await expect(
    modal.getByTestId('google-phone-fill-error')
      .or(modal.getByTestId('google-phone-fill-empty'))
      .or(modal.getByTestId('google-phone-fill-list')),
  ).toBeVisible()
})

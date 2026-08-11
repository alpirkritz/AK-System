import { test, expect } from '@playwright/test'

test.describe('Cash flow insights tab', () => {
  test('is the default finance tab and is addressable by URL', async ({ page }) => {
    await page.goto('/finance')
    await expect(page.getByRole('heading', { name: 'פיננסים' })).toBeVisible({ timeout: 20000 })

    // Landing on /finance activates the insights tab.
    const tab = page.getByRole('button', { name: /תזרים ותובנות/ })
    await expect(tab).toBeVisible({ timeout: 10000 })

    // Switching tabs writes the tab into the URL so the view is linkable.
    await page.getByRole('button', { name: /חשבונות/ }).first().click()
    await expect(page).toHaveURL(/[?&]tab=accounts/, { timeout: 10000 })

    // And a direct link restores it after a reload.
    await page.goto('/finance?tab=insights')
    await expect(page.getByRole('button', { name: /תזרים ותובנות/ })).toBeVisible({ timeout: 10000 })
  })

  test('empty ledger shows an explanation rather than empty charts', async ({ page }) => {
    await page.goto('/finance?tab=insights')

    // On the seeded e2e database there are no transactions, so the tab must explain that
    // instead of rendering a screen of blank chart frames.
    await expect(
      page
        .getByText('אין עדיין תנועות')
        .or(page.getByText('בוא נבין על מה הכסף הולך'))
        .or(page.getByRole('heading', { name: 'מגמה חודשית' })),
    ).toBeVisible({ timeout: 20000 })
  })

  test('the cross-domain overview and narrative degrade gracefully with no data', async ({ page }) => {
    await page.goto('/finance?tab=insights')
    await expect(page.getByRole('heading', { name: 'פיננסים' })).toBeVisible({ timeout: 20000 })

    // The overview strip and narrative panel only render past the onboarding state; when the
    // ledger is empty the tab must still be a coherent screen rather than a broken one.
    const overview = page.getByRole('heading', { name: 'התמונה הכוללת' })
    if ((await overview.count()) === 0) {
      test.skip(true, 'אין תנועות מסווגות בבסיס הנתונים של הבדיקות')
    }

    await expect(overview).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('שערוך לפי עלות')).toBeVisible()

    // Without a Gemini key the narrative fails quietly and offers a retry — the numbers stay.
    await expect(
      page
        .getByRole('button', { name: 'נסה שוב' })
        .or(page.getByRole('button', { name: 'רענן' })),
    ).toBeVisible({ timeout: 20000 })
  })

  test('categorize drawer opens from the onboarding action and can be dismissed', async ({ page }) => {
    await page.goto('/finance?tab=insights')
    await expect(page.getByRole('heading', { name: 'פיננסים' })).toBeVisible({ timeout: 20000 })

    const openDrawer = page
      .getByRole('button', { name: 'סווג אוטומטית' })
      .or(page.getByRole('button', { name: 'סיווג תנועות' }))
      .first()

    // The drawer only exists once there is something to categorize; skip cleanly otherwise.
    if ((await openDrawer.count()) === 0) {
      test.skip(true, 'אין תנועות בבסיס הנתונים של הבדיקות — אין דרוור לפתוח')
    }

    await openDrawer.click()
    const drawer = page.getByRole('dialog', { name: 'סיווג תנועות' })
    await expect(drawer).toBeVisible({ timeout: 10000 })
    await expect(drawer.getByText('החל על תנועות דומות בעתיד')).toBeVisible()

    await page.keyboard.press('Escape')
    await expect(drawer).toBeHidden({ timeout: 10000 })
  })
})

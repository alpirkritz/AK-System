import { test, expect } from '@playwright/test'

// Tabs are addressable by URL since the cash-flow insights tab landed, and insights — not
// accounts — is now the default landing tab, so these navigate explicitly.
test.describe('Bank accounts snapshot (finance)', () => {
  test('Accounts tab shows the snapshot cards and the empty state', async ({ page }) => {
    await page.goto('/finance?tab=accounts')

    const tabBar = page.locator('button', { hasText: 'חשבונות' }).first()
    await expect(tabBar).toBeVisible({ timeout: 20000 })

    // Snapshot summary cards render
    await expect(page.getByText('יתרה בבנקים')).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('חיובי אשראי')).toBeVisible()
    await expect(page.getByText('חשבונות מחוברים')).toBeVisible()

    // Empty state before any connection exists
    await expect(page.getByText('אין חשבונות מחוברים עדיין')).toBeVisible()
  })

  test('add-connection modal opens, adapts fields per provider, and closes', async ({ page }) => {
    await page.goto('/finance?tab=accounts')

    await page.getByRole('button', { name: '+ הוסף חשבון' }).click()
    const modal = page.locator('.modal')
    await expect(modal).toBeVisible({ timeout: 10000 })
    await expect(modal.getByText('חיבור חשבון חדש')).toBeVisible()

    // Default provider: Hapoalim → userCode field
    await expect(modal.getByText('קוד משתמש')).toBeVisible()

    // Switch to Isracard → id + card6Digits fields
    await modal.locator('select').selectOption('isracard')
    await expect(modal.getByText('תעודת זהות')).toBeVisible()
    await expect(modal.getByText('6 ספרות אחרונות של הכרטיס')).toBeVisible()

    // Switch to Visa Cal → username field
    await modal.locator('select').selectOption('visaCal')
    await expect(modal.getByText('שם משתמש')).toBeVisible()

    // Read-only hint present
    await expect(modal.getByText(/לקריאה בלבד/)).toBeVisible()

    // Cancel closes without creating anything
    await modal.getByRole('button', { name: 'ביטול' }).click()
    await expect(modal).toBeHidden({ timeout: 10000 })
    await expect(page.getByText('אין חשבונות מחוברים עדיין')).toBeVisible()
  })

  test('cash-flow tab still renders (source pill regression)', async ({ page }) => {
    // By URL rather than by clicking /תזרים/, which now also matches "תזרים ותובנות".
    await page.goto('/finance?tab=cashflow')
    // Either the empty state or the transactions table renders
    await expect(
      page.getByText('אין רשומות עדיין').or(page.locator('table')),
    ).toBeVisible({ timeout: 20000 })
  })
})

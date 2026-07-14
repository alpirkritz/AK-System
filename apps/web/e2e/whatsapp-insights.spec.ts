import { test, expect } from '@playwright/test'

test.describe('WhatsApp insights', () => {
  test('insights tab renders the cross-group briefing and per-group panel', async ({ page }) => {
    await page.goto('/settings/whatsapp')
    await expect(page.getByRole('heading', { name: 'WhatsApp' })).toBeVisible({ timeout: 20000 })

    await page.getByRole('button', { name: 'תובנות' }).click()

    await expect(page.getByText('מה קורה עכשיו בקבוצות')).toBeVisible()
    await expect(page.getByRole('button', { name: /רענן תובנות/ })).toBeVisible()

    // Per-group panel with the three insight actions.
    await expect(page.getByText('תובנות על קבוצה מסוימת')).toBeVisible()
    await expect(page.getByRole('button', { name: 'סיכום' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'על מה מדברים' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'תובנות בסגנון שלי' })).toBeVisible()
  })

  test('group actions require selecting a group first', async ({ page }) => {
    await page.goto('/settings/whatsapp')
    await expect(page.getByRole('heading', { name: 'WhatsApp' })).toBeVisible({ timeout: 20000 })
    await page.getByRole('button', { name: 'תובנות' }).click()

    // The three per-group buttons are disabled until a group is chosen.
    await expect(page.getByRole('button', { name: 'סיכום' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'על מה מדברים' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'תובנות בסגנון שלי' })).toBeDisabled()
  })
})

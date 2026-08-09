import { test, expect } from '@playwright/test'

test.describe('Agent configuration tab', () => {
  test('configures a schedule and an event subscription from the UI', async ({ page }) => {
    await page.goto('/agents/manage')
    await expect(page.getByRole('heading', { name: 'ניהול סוכנים' })).toBeVisible({
      timeout: 15000,
    })
    await expect(page.getByText('טוען סוכנים...')).not.toBeVisible({ timeout: 15000 })

    // Configuration is the default tab.
    const panel = page.getByTestId('agent-config-panel')
    await expect(panel).toBeVisible({ timeout: 15000 })
    await expect(panel.getByRole('heading', { name: 'הרצה לפי שעה' })).toBeVisible()
    await expect(panel.getByRole('heading', { name: 'הרצה לפי אירוע' })).toBeVisible()

    // Event catalog is rendered as checkboxes, including the 15-min pre-meeting trigger.
    await expect(panel.getByText('הכנה לפגישה')).toBeVisible()
    await expect(panel.getByText('15 דקות לפני כל פגישה')).toBeVisible()

    // Add a schedule time and enable the clock trigger.
    await panel.getByLabel('שעה להוספה').fill('06:45')
    await panel.getByRole('button', { name: 'הוסף שעה' }).click()
    await expect(panel.getByText('06:45')).toBeVisible()

    await panel.getByRole('switch', { name: 'הרצה לפי שעה' }).click()
    await expect(page.getByText('שינויים שלא נשמרו').first()).toBeVisible()

    await panel.getByRole('button', { name: 'שמור הגדרות' }).click()
    await expect(panel.getByText('ההגדרות נשמרו')).toBeVisible({ timeout: 15000 })

    // The saved state survives a reload.
    await page.reload()
    const reloaded = page.getByTestId('agent-config-panel')
    await expect(reloaded).toBeVisible({ timeout: 15000 })
    await expect(reloaded.getByText('06:45')).toBeVisible()
    await expect(reloaded.getByRole('switch', { name: 'הרצה לפי שעה' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    // Removing the last time turns the clock trigger off rather than trapping it on.
    await reloaded.getByRole('button', { name: 'הסר את השעה 06:45' }).click()
    await expect(reloaded.getByRole('switch', { name: 'הרצה לפי שעה' })).toHaveAttribute(
      'aria-checked',
      'false',
    )
    await reloaded.getByRole('button', { name: 'שמור הגדרות' }).click()
    await expect(reloaded.getByText('ההגדרות נשמרו')).toBeVisible({ timeout: 15000 })
  })

  test('switches between configuration, agent card and workflow tabs', async ({ page }) => {
    await page.goto('/agents/manage')
    await expect(page.getByText('טוען סוכנים...')).not.toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('agent-config-panel')).toBeVisible({ timeout: 15000 })

    await page.getByRole('button', { name: 'כרטיס סוכן' }).click()
    await expect(page.getByTestId('agent-config-panel')).not.toBeVisible()
    await expect(page.getByPlaceholder('תוכן markdown של הסוכן...')).toBeVisible({
      timeout: 15000,
    })

    await page.getByRole('button', { name: 'הגדרות והרצה' }).click()
    await expect(page.getByTestId('agent-config-panel')).toBeVisible()
  })
})

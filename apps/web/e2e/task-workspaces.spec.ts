import { test, expect } from '@playwright/test'

test.describe('Task workspaces', () => {
  test('quick-add FAB creates a task from any page', async ({ page }) => {
    const title = `משימה מהירה ${Date.now()}`

    await page.goto('/people')
    const fab = page.getByRole('button', { name: 'הוסף משימה' })
    await expect(fab).toBeVisible({ timeout: 20000 })
    await fab.click()

    const modal = page.locator('.modal')
    await expect(modal).toBeVisible({ timeout: 10000 })
    await expect(modal.getByLabel('כותרת')).toBeFocused()

    await modal.getByLabel('כותרת').fill(title)
    await modal.getByLabel('עולם').selectOption({ label: 'Dragontail' })
    await modal.getByRole('button', { name: 'הוסף' }).click()

    await expect(modal).toBeHidden({ timeout: 10000 })
    await expect(page.getByText('נוספה משימה')).toBeVisible()

    await page.goto('/tasks')
    const row = page.locator('.task-row').filter({ hasText: title })
    await expect(row).toBeVisible({ timeout: 20000 })
    await expect(row.getByText('Dragontail')).toBeVisible()
  })

  test('quick-add closes on Escape without creating a task', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: 'הוסף משימה' }).click()
    const modal = page.locator('.modal')
    await expect(modal).toBeVisible({ timeout: 10000 })
    await modal.getByLabel('כותרת').fill('לא אמורה להישמר')
    await page.keyboard.press('Escape')
    await expect(modal).toBeHidden()

    await page.goto('/tasks')
    await expect(page.getByRole('heading', { name: 'משימות' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('לא אמורה להישמר')).toHaveCount(0)
  })

  test('workspace chips filter the tasks list', async ({ page }) => {
    const dazTitle = `DAZ ${Date.now()}`
    const personalTitle = `פרטי ${Date.now()}`

    for (const [title, workspace] of [[dazTitle, 'DAZ'], [personalTitle, 'פרטי']] as const) {
      await page.goto('/tasks')
      await page.getByRole('button', { name: 'הוסף משימה' }).click()
      const modal = page.locator('.modal')
      await expect(modal).toBeVisible({ timeout: 10000 })
      await modal.getByLabel('כותרת').fill(title)
      await modal.getByLabel('עולם').selectOption({ label: workspace })
      await modal.getByRole('button', { name: 'הוסף' }).click()
      await expect(modal).toBeHidden({ timeout: 10000 })
    }

    await page.goto('/tasks')
    await expect(page.locator('.task-row').filter({ hasText: dazTitle })).toBeVisible({ timeout: 20000 })
    await expect(page.locator('.task-row').filter({ hasText: personalTitle })).toBeVisible()

    await page.getByTestId('world-switcher').click()
    const panel = page.getByTestId('world-switcher-panel')
    await panel.getByRole('option', { name: 'DAZ', exact: true }).click()
    await expect(page.getByTestId('filtered-world-chip')).toContainText('DAZ')
    await expect(page.locator('.task-row').filter({ hasText: dazTitle })).toBeVisible()
    await expect(page.locator('.task-row').filter({ hasText: personalTitle })).toHaveCount(0)

    await page.getByTestId('filtered-world-chip').click()
    await expect(page.locator('.task-row').filter({ hasText: personalTitle })).toBeVisible()
  })

  test('workspaces settings page lists the seeded sources and saves a notion label', async ({ page }) => {
    await page.goto('/settings')
    const link = page.getByRole('link', { name: /עולמות/ })
    await expect(link).toBeVisible({ timeout: 20000 })
    await link.click()

    await expect(page).toHaveURL(/\/settings\/workspaces/)
    await expect(page.getByTestId('workspaces-settings')).toBeVisible({ timeout: 20000 })
    for (const name of ['Alpir Consulting', 'Dragontail', 'DAZ', 'פרטי']) {
      await expect(page.getByRole('button', { name: `ערוך את ${name}`, exact: true })).toBeVisible()
    }

    await page.getByRole('button', { name: 'ערוך את Dragontail' }).click()
    const modal = page.locator('.modal')
    await expect(modal).toBeVisible({ timeout: 10000 })
    await modal.getByLabel('תווית Notion').fill('DT - Action items')
    await modal.getByRole('button', { name: 'שמור' }).click()
    await expect(modal).toBeHidden({ timeout: 10000 })

    await expect(page.getByText('Notion: DT - Action items')).toBeVisible({ timeout: 10000 })
  })

  test('editing a source offers paste-a-link and rejects a link with no database id', async ({ page }) => {
    await page.goto('/settings/workspaces')
    await expect(page.getByTestId('workspaces-settings')).toBeVisible({ timeout: 20000 })
    await page.getByRole('button', { name: 'ערוך את DAZ', exact: true }).click()
    const modal = page.locator('.modal').first()
    await expect(modal.getByRole('button', { name: 'הוסף בסיס נתונים' })).toBeVisible()
    await modal.getByRole('button', { name: 'הוסף בסיס נתונים' }).click()

    const add = page.getByRole('dialog', { name: 'הוסף בסיס נתונים של משימות' })
    await expect(add.getByLabel('קישור לבסיס הנתונים ב-Notion')).toBeVisible()
    await add.getByLabel('קישור לבסיס הנתונים ב-Notion').fill('not-a-database-link')
    const check = add.getByRole('button', { name: 'בדוק' })
    if (await check.isEnabled()) {
      await check.click()
      await expect(add.getByRole('alert')).toContainText('לא זיהיתי מזהה')
    } else {
      await expect(add.getByText('לא נמצאו חשבונות Notion')).toBeVisible()
    }
  })
})

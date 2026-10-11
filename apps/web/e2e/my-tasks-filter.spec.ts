import { test, expect, type Page } from '@playwright/test'

async function createTask(page: Page, title: string, clearAssignee: boolean) {
  await page.getByRole('button', { name: '+ משימה חדשה' }).click()
  const modal = page.locator('.modal')
  await expect(modal).toBeVisible({ timeout: 20000 })
  await modal.getByPlaceholder('מה צריך לעשות?').fill(title)
  if (clearAssignee) {
    const assignee = modal.getByRole('combobox', { name: 'אחראי' })
    await assignee.click()
    await modal.getByRole('listbox', { name: 'אחראי' }).getByRole('option', { name: 'ללא אחראי' }).click()
  }
  await modal.getByRole('button', { name: 'שמור' }).click()
  await expect(modal).toBeHidden({ timeout: 10000 })
}

test.describe('My tasks filter', () => {
  test('opens on my tasks and כולם reveals the rest', async ({ page }) => {
    const mine = `משימה שלי ${Date.now()}`
    const unassigned = `משימה ללא אחראי ${Date.now()}`

    await page.goto('/tasks')
    const ownerFilter = page.getByRole('group', { name: 'סינון לפי אחראי' })
    await expect(ownerFilter.getByRole('button', { name: 'שלי' })).toHaveAttribute('aria-pressed', 'true', {
      timeout: 20000,
    })

    await createTask(page, mine, false)
    await expect(page.locator('.task-row').filter({ hasText: mine })).toBeVisible({ timeout: 20000 })

    await createTask(page, unassigned, true)
    await expect(page.locator('.task-row').filter({ hasText: unassigned })).toHaveCount(0)
    await expect(page.locator('.task-row').filter({ hasText: mine })).toBeVisible()

    await ownerFilter.getByRole('button', { name: 'כולם' }).click()
    await expect(page).toHaveURL(/owner=all/)
    await expect(page.locator('.task-row').filter({ hasText: unassigned })).toBeVisible()
    await expect(page.locator('.task-row').filter({ hasText: mine })).toBeVisible()
  })
})

import { test, expect, type Page } from '@playwright/test'

async function openNewTaskModal(page: Page) {
  await page.goto('/tasks')
  await page.getByRole('button', { name: '+ משימה חדשה' }).click()
  const modal = page.locator('.modal')
  await expect(modal).toBeVisible({ timeout: 20000 })
  return modal
}

test.describe('Dashboard open tasks — open modal + sort', () => {
  /**
   * Warm `people.me` so the first real create is not racing owner bootstrap
   * (same pattern as task-related-people / task-assignee).
   */
  test.beforeEach(async ({ page }) => {
    await openNewTaskModal(page)
    await page.goto('/tasks')
  })

  test('clicking task title opens TaskModal; checkbox does not', async ({ page }) => {
    const title = `משימת דשבורד ${Date.now()}`

    const createModal = await openNewTaskModal(page)
    await createModal.getByPlaceholder('מה צריך לעשות?').fill(title)
    const saveBtn = createModal.getByRole('button', { name: 'שמור' })
    await expect(saveBtn).toBeEnabled({ timeout: 10000 })
    await saveBtn.click()
    await expect(createModal).toBeHidden({ timeout: 20000 })
    await expect(page.locator('.task-row').filter({ hasText: title })).toBeVisible({ timeout: 20000 })

    await page.goto('/')
    await expect(page.getByRole('heading', { name: /בוקר|צהריים|ערב|לילה/ })).toBeVisible({
      timeout: 15000,
    })

    const section = page.getByRole('region', { name: 'משימות פתוחות' })
    await expect(section.getByLabel('מיון משימות')).toBeVisible()
    await expect(section.getByRole('button', { name: title })).toBeVisible({ timeout: 15000 })

    // No horizontal page scroll — content must fit the viewport width
    const overflow = await page.evaluate(() => {
      const doc = document.documentElement
      return {
        scrollWidth: doc.scrollWidth,
        clientWidth: doc.clientWidth,
      }
    })
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1)

    await section.getByRole('button', { name: title }).click()
    const editModal = page.locator('.modal')
    await expect(editModal).toBeVisible({ timeout: 15000 })
    await expect(editModal.getByPlaceholder('מה צריך לעשות?')).toHaveValue(title)

    await editModal.getByRole('button', { name: 'ביטול' }).click()
    await expect(editModal).toBeHidden({ timeout: 10000 })

    const row = section.locator('.task-row').filter({ hasText: title })
    await row.getByRole('checkbox').click()
    await expect(page.locator('.modal')).toHaveCount(0)
  })
})

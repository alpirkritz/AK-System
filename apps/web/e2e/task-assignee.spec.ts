import { test, expect, type Page } from '@playwright/test'

/** `NOTION_USER_NAME` is unset in e2e, so the owner falls back to this name. */
const OWNER_NAME = 'Alpir Kritzler'

async function openNewTaskModal(page: Page) {
  await page.goto('/tasks')
  await page.getByRole('button', { name: '+ משימה חדשה' }).click()
  const modal = page.locator('.modal')
  await expect(modal).toBeVisible({ timeout: 20000 })
  return modal
}

test.describe('Task assignee', () => {
  test('new task defaults to the owner and filters as you type', async ({ page }) => {
    const modal = await openNewTaskModal(page)
    const assignee = modal.getByRole('combobox', { name: 'אחראי' })
    await expect(assignee).toContainText(OWNER_NAME, { timeout: 30000 })

    await assignee.click()
    const search = modal.getByLabel('חיפוש אחראי')
    await expect(search).toBeFocused()

    const listbox = modal.getByRole('listbox', { name: 'אחראי' })
    await search.fill(OWNER_NAME.slice(0, 4))
    await expect(listbox.getByRole('option', { name: new RegExp(OWNER_NAME) })).toBeVisible()

    await search.fill('קקקקק')
    await expect(listbox.getByText('לא נמצא איש קשר')).toBeVisible()
  })

  test('assignee can be cleared and the choice survives a reopen', async ({ page }) => {
    const title = `משימה ללא אחראי ${Date.now()}`

    const modal = await openNewTaskModal(page)
    await modal.getByPlaceholder('מה צריך לעשות?').fill(title)

    const assignee = modal.getByRole('combobox', { name: 'אחראי' })
    await expect(assignee).toContainText(OWNER_NAME, { timeout: 30000 })
    await assignee.click()
    await modal
      .getByRole('listbox', { name: 'אחראי' })
      .getByRole('option', { name: 'ללא אחראי' })
      .click()
    await expect(assignee).toContainText('ללא אחראי')

    await modal.getByRole('button', { name: 'שמור' }).click()
    await expect(modal).toBeHidden({ timeout: 10000 })

    const row = page.locator('.task-row').filter({ hasText: title })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByText(title).click()

    const editModal = page.locator('.modal')
    await expect(editModal).toBeVisible({ timeout: 10000 })
    await expect(editModal.getByRole('combobox', { name: 'אחראי' })).toContainText('ללא אחראי')
  })

  test('keyboard selects from the list and Escape leaves the value alone', async ({ page }) => {
    const modal = await openNewTaskModal(page)
    const assignee = modal.getByRole('combobox', { name: 'אחראי' })
    await expect(assignee).toContainText(OWNER_NAME, { timeout: 30000 })

    await assignee.click()
    await expect(modal.getByLabel('חיפוש אחראי')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(modal.getByRole('listbox', { name: 'אחראי' })).toHaveCount(0)
    await expect(assignee).toContainText(OWNER_NAME)

    await assignee.click()
    await expect(modal.getByLabel('חיפוש אחראי')).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(modal.getByRole('listbox', { name: 'אחראי' })).toHaveCount(0)
    await expect(assignee).toContainText(OWNER_NAME)
  })
})

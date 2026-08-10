import { test, expect, type Page } from '@playwright/test'

/**
 * Related people now travel to the Notion People relation on save, so `setTaskPeople` does more
 * work than it used to. e2e has no Notion configured, which is exactly the case that must stay
 * silent: the task is local-only, so there is nothing to sync and nothing to report.
 */

async function openNewTaskModal(page: Page) {
  await page.goto('/tasks')
  await page.getByRole('button', { name: '+ משימה חדשה' }).click()
  const modal = page.locator('.modal')
  await expect(modal).toBeVisible({ timeout: 20000 })
  return modal
}

function relatedPeopleBox(modal: ReturnType<Page['locator']>) {
  return modal.getByRole('group', { name: 'קשור לאנשים' })
}

test.describe('Task related people', () => {
  /**
   * On a fresh e2e database nobody exists until `people.me` lazily creates the owner, which first
   * happens when a task modal opens — after `people.list` has already returned empty. Opening once
   * and reloading makes the list populated regardless of which test runs first.
   */
  test.beforeEach(async ({ page }) => {
    await openNewTaskModal(page)
    await page.goto('/tasks')
  })

  test('related people are saved and survive a reopen', async ({ page }) => {
    const title = `משימה עם אנשים קשורים ${Date.now()}`

    const modal = await openNewTaskModal(page)
    await modal.getByPlaceholder('מה צריך לעשות?').fill(title)

    const box = relatedPeopleBox(modal)
    const firstPerson = box.locator('label').first()
    await expect(firstPerson).toBeVisible({ timeout: 45000 })
    const personName = (await firstPerson.locator('span').first().innerText()).trim()
    await firstPerson.locator('input[type="checkbox"]').check()

    await modal.getByRole('button', { name: 'שמור' }).click()
    await expect(modal).toBeHidden({ timeout: 15000 })

    const row = page.locator('.task-row').filter({ hasText: title })
    await expect(row).toBeVisible({ timeout: 20000 })
    await row.getByText(title).click()

    const editModal = page.locator('.modal')
    await expect(editModal).toBeVisible({ timeout: 10000 })
    const checked = relatedPeopleBox(editModal)
      .locator('label')
      .filter({ hasText: personName })
      .locator('input[type="checkbox"]')
    await expect(checked).toBeChecked({ timeout: 20000 })
  })

  test('a task with no Notion database reports nothing about people sync', async ({ page }) => {
    const title = `משימה מקומית עם אנשים ${Date.now()}`

    const modal = await openNewTaskModal(page)
    await modal.getByPlaceholder('מה צריך לעשות?').fill(title)

    const firstPerson = relatedPeopleBox(modal).locator('label').first()
    await expect(firstPerson).toBeVisible({ timeout: 45000 })
    await firstPerson.locator('input[type="checkbox"]').check()

    await modal.getByRole('button', { name: 'שמור' }).click()
    await expect(modal).toBeHidden({ timeout: 15000 })
    await expect(page.locator('.task-row').filter({ hasText: title })).toBeVisible({ timeout: 20000 })

    await expect(page.getByText('לא נמצאו בספריית האנשים')).toHaveCount(0)
    await expect(page.getByText('השיוך שלהם ב-Notion נכשל')).toHaveCount(0)
  })
})

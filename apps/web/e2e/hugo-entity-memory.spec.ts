import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

const dbPath = path.join(__dirname, '../data/e2e.sqlite')

function seedPerson() {
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  const stamp = Date.now()
  const personId = `p_mem_${stamp}`
  const name = `זוכר ${stamp}`
  db.prepare(`INSERT INTO people (id, name, status, source, created_at) VALUES (?, ?, 'confirmed', 'manual', ?)`).run(personId, name, now)
  db.close()
  return { name, stamp }
}

test('a memory added from the person drawer is linked to that person on /memory', async ({ page }) => {
  const { name, stamp } = seedPerson()
  const content = `מעדיף עדכונים בכתב ${stamp}`

  await page.goto('/people')
  await page.getByPlaceholder('חיפוש אנשים...').fill(name)
  await page.getByText(name, { exact: true }).first().click()

  await page.getByRole('tab', { name: 'פרטים' }).click()
  const block = page.getByTestId('entity-memories-person')
  await expect(block).toBeVisible({ timeout: 20000 })
  await expect(block.getByText('אין זיכרונות על האדם הזה עדיין.')).toBeVisible()
  await block.getByLabel('זיכרון חדש').fill(content)
  await block.getByRole('button', { name: 'זכור' }).click()
  await expect(block.getByText(content)).toBeVisible()

  await page.goto('/memory')
  const card = page.locator('.card', { hasText: content })
  await expect(card).toBeVisible({ timeout: 20000 })
  await expect(card.getByTestId('memory-link-chip').filter({ hasText: name })).toBeVisible()

  // Filter by the chip: only this person's memories remain.
  await card.getByTestId('memory-link-chip').filter({ hasText: name }).getByRole('button').first().click()
  await expect(page.getByText('מסונן לפי:')).toBeVisible()
  await expect(page.locator('.card', { hasText: content })).toBeVisible()

  // The tester shows the person as an anchor and the memory in the block.
  await page.getByText('מה הוגו יראה').click()
  await page.getByPlaceholder('לדוגמה: תכין אותי לפגישה עם דן על DD').fill(`פגישה עם ${name}`)
  await page.getByRole('button', { name: 'בדוק' }).click()
  await expect(page.getByTestId('memory-tester').locator('pre')).toContainText(content)
})

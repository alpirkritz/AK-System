import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

const dbPath = path.join(__dirname, '../data/e2e.sqlite')

function seedPerson(prefix: string) {
  const db = new Database(dbPath)
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const personId = `p_dom_${stamp}`
  const name = `${prefix} ${stamp}`
  db.prepare(
    `INSERT INTO people (id, name, status, source, created_at) VALUES (?, ?, 'confirmed', 'manual', ?)`,
  ).run(personId, name, new Date().toISOString())
  db.close()
  return { personId, name }
}

test('links a person to a life domain from the drawer and filters by it', async ({ page }) => {
  const { name } = seedPerson('שותפה')
  await page.goto('/people')
  await page.getByPlaceholder('חיפוש אנשים...').fill(name)
  await page.getByText(name, { exact: true }).first().click()

  await page.getByTestId('person-tab-details').click()
  const section = page.getByTestId('person-affiliations')
  await expect(section).toBeVisible({ timeout: 20000 })
  await section.getByRole('button', { name: 'שייך לעולם' }).click()

  const form = page.getByTestId('affiliation-form')
  await form.getByLabel('עולם').selectOption({ label: 'DAZ · חברה / סטארטאפ שלי' })
  await form.getByRole('button', { name: 'שותף מייסד' }).click()
  await expect(form.getByLabel('סוג הקשר')).toHaveValue('co_founder')
  await form.getByRole('button', { name: 'שמור שיוך' }).click()

  await expect(form).toBeHidden()
  await expect(section.getByText('שותף מייסד')).toBeVisible()
  await expect(section.getByRole('heading', { name: 'שיוכים (1)' })).toBeVisible()

  // A second, concurrent domain — custom free-text relationship.
  await section.getByRole('button', { name: 'שייך לעולם' }).click()
  await form.getByLabel('עולם').selectOption({ label: 'פרטי · אישי' })
  await form.getByLabel('סוג הקשר').fill('חברה מהתיכון')
  await form.getByRole('button', { name: 'שמור שיוך' }).click()
  await expect(section.getByText('חברה מהתיכון')).toBeVisible()
  await expect(section.getByRole('heading', { name: 'שיוכים (2)' })).toBeVisible()

  await page.keyboard.press('Escape')
  await page.getByTestId('world-switcher').click()
  const filter = page.getByTestId('world-switcher-panel')
  await filter.getByRole('option', { name: 'DAZ', exact: true }).click()
  await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 20000 })
  await expect(page.getByTestId('workspace-badges').first()).toContainText('DAZ')

  await page.getByTestId('world-switcher').click()
  await page.getByTestId('world-switcher-panel').getByRole('option', { name: 'Dragontail', exact: true }).click()
  await expect(page.getByText(name, { exact: true })).toHaveCount(0, { timeout: 20000 })
})

test('Google profile fill opens a review dialog', async ({ page }) => {
  await page.goto('/people')
  await page.getByTestId('google-profile-fill').click()
  const modal = page.getByTestId('google-profile-fill-modal')
  await expect(modal).toBeVisible()
  await expect(modal.locator('#google-profile-fill-title')).toHaveText('פרטים מגוגל')
  await expect(modal.getByText('מחפש התאמות…')).toBeHidden({ timeout: 20000 })
})

test.describe('folded phone (Z Fold cover screen)', () => {
  test.use({ viewport: { width: 390, height: 844 } })

  test('people page fits the narrow screen and the drawer is full width', async ({ page }) => {
    const { name } = seedPerson('מקופל')
    await page.goto('/people')
    await expect(page.getByTestId('world-switcher')).toBeVisible({ timeout: 20000 })

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    expect(overflow).toBeLessThanOrEqual(1)

    await page.getByPlaceholder('חיפוש אנשים...').fill(name)
    await page.getByText(name, { exact: true }).first().click()
    await expect(page.getByTestId('person-panel')).toBeVisible({ timeout: 20000 })
    const drawerWidth = await page.locator('.drawer').evaluate((el) => el.getBoundingClientRect().width)
    expect(drawerWidth).toBeGreaterThanOrEqual(388)
  })
})

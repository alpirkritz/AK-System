import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

const dbPath = path.join(__dirname, '../data/e2e.sqlite')

function seed() {
  const db = new Database(dbPath)
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const now = new Date().toISOString()
  const insert = db.prepare(`INSERT INTO people (id, name, status, source, created_at) VALUES (?, ?, 'confirmed', 'manual', ?)`)
  const person = { id: `p_mail_${stamp}`, name: `שני ${stamp}` }
  const manager = { id: `p_mgr_${stamp}`, name: `דוד מנהל ${stamp}` }
  insert.run(person.id, person.name, now)
  insert.run(manager.id, manager.name, now)
  db.close()
  return { stamp, person, manager }
}

async function openPerson(page: import('@playwright/test').Page, name: string) {
  await page.goto('/people')
  await page.getByPlaceholder('חיפוש אנשים...').fill(name)
  await page.getByText(name, { exact: true }).first().click()
}

test('adds and removes email addresses on the person card', async ({ page }) => {
  const { stamp, person } = seed()
  await openPerson(page, person.name)

  const addresses = page.getByTestId('person-email-addresses')
  await expect(addresses).toContainText('אין כתובת מייל', { timeout: 20000 })

  await page.getByTestId('add-email-toggle').click()
  await page.getByLabel('כתובת מייל').fill(`shani.${stamp}@work.com`)
  await page.getByRole('button', { name: 'הוסף', exact: true }).click()
  await expect(addresses).toContainText(`shani.${stamp}@work.com`)

  await page.getByTestId('add-email-toggle').click()
  await page.getByLabel('כתובת מייל').fill(`shani.${stamp}@gmail.com`)
  await page.getByRole('button', { name: 'הוסף', exact: true }).click()
  await expect(addresses).toContainText(`shani.${stamp}@gmail.com`)

  await addresses.getByRole('button', { name: `הסר כתובת shani.${stamp}@work.com` }).click()
  await expect(addresses).not.toContainText(`shani.${stamp}@work.com`)
  await expect(addresses).toContainText(`shani.${stamp}@gmail.com`)
})

test('reports to someone outside the workspace, who then joins it', async ({ page }) => {
  const { person, manager } = seed()
  await openPerson(page, person.name)

  await page.getByTestId('person-tab-details').click()
  const section = page.getByTestId('person-affiliations')
  await expect(section).toBeVisible({ timeout: 20000 })
  await section.getByRole('button', { name: 'שייך לעולם' }).click()
  const form = page.getByTestId('affiliation-form')
  await form.getByLabel('עולם').selectOption({ label: 'DAZ · חברה / סטארטאפ שלי' })
  await form.getByLabel('סוג הקשר').fill('עובדת')

  const picker = form.getByRole('combobox', { name: 'מדווח ל (לא חובה)' })
  await picker.fill(manager.name)
  await form.getByRole('option', { name: new RegExp(manager.name) }).click()
  await expect(form.getByTestId('manager-picker-selected')).toContainText(manager.name)
  await form.getByRole('button', { name: 'שמור שיוך' }).click()

  await expect(form).toBeHidden()
  await expect(section.getByText(`מדווח ל: ${manager.name}`)).toBeVisible()

  const db = new Database(dbPath, { readonly: true })
  const row = db.prepare(`SELECT relationship_type FROM person_workspaces WHERE person_id = ? AND workspace_id = 'ws_daz'`).get(manager.id) as
    | { relationship_type: string }
    | undefined
  db.close()
  expect(row?.relationship_type).toBe('עובדת')
})

import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

const dbPath = path.join(__dirname, '../data/e2e.sqlite')

function seedCircle() {
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  const stamp = Date.now()
  const seriesId = `ms_e2e_${stamp}`
  const meetingId = `m_e2e_circle_${stamp}`
  const participants = Array.from({ length: 12 }, (_, i) => ({
    name: `משתתף ${i + 1}`,
    email: `p${i + 1}_${stamp}@dt.com`,
    source: 'description',
  }))
  db.prepare(
    `INSERT INTO meeting_series (id, title, cadence, recurrence_day, created_at, updated_at)
     VALUES (?, ?, 'weekly', 'Monday', ?, ?)`,
  ).run(seriesId, `חוג בדיקה ${stamp}`, now, now)
  db.prepare(
    `INSERT INTO meetings (id, title, date, time, series_id, recurring, calendar_participants, created_at, updated_at)
     VALUES (?, ?, ?, '10:00', ?, 'weekly', ?, ?, ?)`,
  ).run(meetingId, `חוג בדיקה ${stamp}`, now.slice(0, 10), seriesId, JSON.stringify(participants), now, now)
  db.close()
  return { meetingId }
}

function seedEmptyCircle() {
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  const stamp = Date.now()
  const seriesId = `ms_e2e_pick_${stamp}`
  const meetingId = `m_e2e_pick_${stamp}`
  const personName = `עומרי בדיקה ${stamp}`
  db.prepare(
    `INSERT INTO meeting_series (id, title, cadence, recurrence_day, created_at, updated_at)
     VALUES (?, ?, 'weekly', 'Monday', ?, ?)`,
  ).run(seriesId, `חוג בחירה ${stamp}`, now, now)
  db.prepare(
    `INSERT INTO meetings (id, title, date, time, series_id, recurring, created_at, updated_at)
     VALUES (?, ?, ?, '10:00', ?, 'weekly', ?, ?)`,
  ).run(meetingId, `חוג בחירה ${stamp}`, now.slice(0, 10), seriesId, now, now)
  db.prepare(
    `INSERT INTO people (id, name, email, status, source, created_at) VALUES (?, ?, NULL, 'confirmed', 'manual', ?)`,
  ).run(`p_e2e_pick_${stamp}`, personName, now)
  db.close()
  return { meetingId, personName, newName: `חדש בחוג ${stamp}` }
}

function seedDuplicates() {
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  const stamp = Date.now()
  const email = `dup_${stamp}@dt.com`
  const insert = db.prepare(
    `INSERT INTO people (id, name, email, status, source, created_at) VALUES (?, ?, ?, 'confirmed', 'manual', ?)`,
  )
  insert.run(`p_dup_a_${stamp}`, `כפיל ${stamp}`, email, now)
  insert.run(`p_dup_b_${stamp}`, `כפיל ${stamp} ב`, email.toUpperCase(), now)
  db.close()
  return { name: `כפיל ${stamp}` }
}

test.describe('Circles and duplicates', () => {
  test('saves a recurring meeting roster from the calendar once, and marks an absence', async ({ page }) => {
    const { meetingId } = seedCircle()
    await page.goto(`/meetings/${meetingId}`)

    const card = page.getByTestId('circle-card')
    await expect(card).toBeVisible({ timeout: 20000 })
    await expect(card.getByText('12 משתתפים ביומן', { exact: false })).toBeVisible()
    await card.getByRole('button', { name: 'שמור חוג מהיומן' }).click()

    await expect(card.getByTestId('circle-count')).toHaveText('12 בחוג')
    await expect(card.getByTestId('circle-recommendation')).toBeVisible()

    await card.getByTestId('circle-roster').getByRole('button', { name: 'חסר היום' }).first().click()
    await expect(card.getByText('11 צפויים היום')).toBeVisible()
  })

  test('builds a circle from People, creating a missing person from the picker', async ({ page }) => {
    const { meetingId, personName, newName } = seedEmptyCircle()
    await page.goto(`/meetings/${meetingId}`)

    const card = page.getByTestId('circle-card')
    await expect(card).toBeVisible({ timeout: 60000 })
    await expect(card.getByTestId('circle-names')).toHaveCount(0)
    const form = card.getByTestId('circle-people-form')
    const search = form.getByTestId('meeting-people-search')

    await search.fill(personName)
    await form.getByTestId('meeting-people-suggestion').filter({ hasText: personName }).click()
    await search.fill(newName)
    await form.getByTestId('meeting-people-create').click()
    await expect(form.getByText(newName, { exact: true })).toBeVisible()

    await form.getByTestId('circle-save-people').click()
    await expect(card.getByTestId('circle-count')).toHaveText('2 בחוג')
    const roster = card.getByTestId('circle-roster')
    await expect(roster.getByTestId('circle-member-link').filter({ hasText: personName })).toBeVisible()
    await expect(roster.getByTestId('circle-member-link').filter({ hasText: newName })).toBeVisible()

    // The created member is a real People record.
    await expect(roster.getByTestId('circle-member-link').filter({ hasText: newName })).toHaveAttribute('href', /\/people\?person=p_circle_/)
  })

  test('reviews a duplicate pair and merges it', async ({ page }) => {
    const { name } = seedDuplicates()
    await page.goto('/people/duplicates')
    const list = page.getByTestId('duplicates-list')
    await expect(list).toBeVisible({ timeout: 20000 })
    await list.getByRole('button', { name: new RegExp(name) }).first().click()

    const compare = page.getByTestId('duplicates-compare')
    await expect(compare.getByText('אותו אימייל', { exact: false })).toBeVisible()
    await compare.getByRole('button', { name: 'השאר את הכרטיס הזה' }).first().click()
    await compare.getByRole('button', { name: 'מזג וזכור את השם', exact: true }).click()

    await expect(list.getByRole('button', { name: new RegExp(name) })).toHaveCount(0)
  })
})

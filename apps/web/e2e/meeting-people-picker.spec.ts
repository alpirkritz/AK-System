import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

function seedPeople() {
  const dbPath = path.join(__dirname, '../data/e2e.sqlite')
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  const suffix = Date.now()
  const recentId = `person_recent_${suffix}`
  const directoryId = `person_dir_${suffix}`
  const meetingId = `m_picker_${suffix}`

  db.prepare(
    `INSERT INTO people (id, name, company, role, color, created_at)
     VALUES (?, 'Recent Picker', 'RecentCo', 'PM', '#2dd4bf', ?)`,
  ).run(recentId, now)
  db.prepare(
    `INSERT INTO people (id, name, company, role, color, created_at)
     VALUES (?, 'Zzz Directory Only', 'DirectoryCo', 'QA', '#38bdf8', ?)`,
  ).run(directoryId, now)
  db.prepare(
    `INSERT INTO meetings (id, title, date, time, source, created_at, updated_at)
     VALUES (?, 'Picker Recent', '9999-12-31', '09:00', 'manual', ?, ?)`,
  ).run(meetingId, now, now)
  db.prepare(`INSERT INTO meeting_people (meeting_id, person_id) VALUES (?, ?)`).run(meetingId, recentId)
  db.close()
  return { recentId, directoryId }
}

test.describe('Meeting people picker', () => {
  test('dashboard stays quiet when no relationship moved', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('attention-banner')).toHaveCount(0)
  })

  test('search adds a person without listing the whole directory', async ({ page }) => {
    seedPeople()
    await page.goto('/meetings')
    const openMeeting = page.getByRole('button', { name: '+ פגישה חדשה' })
    await expect(openMeeting).toBeVisible({ timeout: 20000 })
    await openMeeting.click()

    const dialog = page.locator('.modal').filter({ hasText: 'פגישה חדשה' })
    await expect(dialog.getByText('עדיין אין משתתפים')).toBeVisible()
    await expect(dialog.getByText('Zzz Directory Only')).toHaveCount(0)
    await expect(dialog.getByRole('button', { name: 'שמור' })).toBeDisabled()

    const search = dialog.getByTestId('meeting-people-search')
    await search.click()
    await expect(dialog.getByTestId('meeting-people-recent')).toBeVisible({ timeout: 20000 })
    await expect(dialog.getByRole('option', { name: /Recent Picker/ })).toBeVisible()
    await expect(dialog.getByText('Zzz Directory Only')).toHaveCount(0)
    expect(await dialog.getByTestId('meeting-people-suggestion').count()).toBeLessThanOrEqual(6)

    await search.fill('Zzz Directory')
    await dialog.getByRole('option', { name: /Zzz Directory Only/ }).click()
    await expect(dialog.getByRole('button', { name: 'הסר את Zzz Directory Only' })).toBeVisible()
    await expect(search).toHaveValue('')

    await search.fill('Zzz Directory Only')
    await expect(dialog.getByText('Zzz Directory Only כבר בפגישה')).toBeVisible()

    await search.fill('zzzz-nope')
    await expect(dialog.getByText('אין אנשי קשר תואמים')).toBeVisible()

    await search.fill('')
    await search.press('Escape')
    await expect(dialog.getByTestId('meeting-people-recent')).toHaveCount(0)
  })
})

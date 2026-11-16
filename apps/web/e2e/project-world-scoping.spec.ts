import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

const dbPath = path.join(__dirname, '../data/e2e.sqlite')

function seed() {
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  const s = Date.now()
  const worldA = `wA_${s}`
  const worldB = `wB_${s}`
  const insertWs = db.prepare(`INSERT INTO workspaces (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`)
  insertWs.run(worldA, `עולם א ${s}`, now, now)
  insertWs.run(worldB, `עולם ב ${s}`, now, now)
  const insertProject = db.prepare(`INSERT INTO projects (id, name, source, workspace_id, workspace_source, created_at, updated_at) VALUES (?, ?, 'manual', ?, 'manual', ?, ?)`)
  insertProject.run(`pA_${s}`, `פרויקט א ${s}`, worldA, now, now)
  insertProject.run(`pB_${s}`, `פרויקט ב ${s}`, worldB, now, now)
  const calendarId = `google:e2e@example.com:cal_${s}`
  db.prepare(`INSERT INTO meetings (id, title, date, time, calendar_id, created_at, updated_at) VALUES (?, ?, ?, '10:00', ?, ?, ?)`)
    .run(`m_${s}`, `פגישת עולם ${s}`, '2026-11-20', calendarId, now, now)
  // An existing cross-world link, to be fixed from settings.
  db.prepare(`INSERT INTO meetings (id, title, date, time, workspace_id, workspace_source, project_id, created_at, updated_at) VALUES (?, ?, ?, '11:00', ?, 'manual', ?, ?, ?)`)
    .run(`mx_${s}`, `פגישה חוצה ${s}`, '2026-11-21', worldB, `pA_${s}`, now, now)
  db.close()
  return { s, worldA, calendarId }
}

test('a calendar mapped to a world scopes its meetings, and a cross-world link can be unlinked', async ({ page }) => {
  const { s } = seed()

  await page.goto('/settings/workspaces')
  const panel = page.getByTestId('world-scope-panel')
  await expect(panel).toBeVisible({ timeout: 20000 })
  const row = panel.getByTestId('world-calendar-row').filter({ hasText: `cal_${s}` })
  await row.getByRole('combobox').selectOption({ label: `עולם א ${s}` })
  await expect(row.getByRole('combobox')).toHaveValue(`wA_${s}`)

  const conflict = panel.getByTestId('world-conflict-row').filter({ hasText: `פגישה חוצה ${s}` })
  await expect(conflict).toBeVisible()
  await conflict.getByRole('button', { name: 'נתק פרויקט' }).click()
  await expect(conflict).toHaveCount(0)

  await page.goto(`/meetings/m_${s}`)
  await page.getByRole('button', { name: '✏ ערוך' }).click()
  const select = page.locator('.modal select').filter({ has: page.locator('option', { hasText: 'ללא פרויקט' }) })
  await expect(select.locator('option', { hasText: `פרויקט א ${s}` })).toHaveCount(1)
  await expect(select.locator('option', { hasText: `פרויקט ב ${s}` })).toHaveCount(0)
})

import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

const dbPath = path.join(__dirname, '../data/e2e.sqlite')

function db() {
  return new Database(dbPath)
}

test('priorities saved on /memory survive a reload', async ({ page }) => {
  const stamp = Date.now()
  await page.goto('/memory')
  const card = page.getByTestId('owner-profile-card')
  await expect(card).toBeVisible({ timeout: 20000 })
  await page.waitForLoadState('networkidle')
  await card.getByLabel('עדיפות חדשה').fill(`גיוס ${stamp}`)
  await card.getByLabel('עדיפות חדשה').press('Enter')
  await expect(card.getByTestId('owner-priority').filter({ hasText: `גיוס ${stamp}` })).toBeVisible()
  const saved = page.waitForResponse((r) => r.url().includes('ownerProfile.set') && r.ok())
  await card.getByRole('button', { name: 'שמור', exact: true }).click()
  await saved
  await expect(card.getByText('שינויים לא שמורים')).toHaveCount(0)
  await page.reload()
  await expect(page.getByTestId('owner-priority').filter({ hasText: `גיוס ${stamp}` })).toBeVisible({ timeout: 20000 })
})

test('a proposed memory is accepted from the proposals tab', async ({ page }) => {
  const stamp = Date.now()
  const content = `הוחלט לדחות ${stamp}`
  const conn = db()
  const now = new Date().toISOString()
  conn
    .prepare(`INSERT INTO memories (id, content, kind, source, pinned, status, evidence, created_at, updated_at) VALUES (?, ?, 'memory', 'auto', 0, 'proposed', ?, ?, ?)`)
    .run(`mem_e2e_${stamp}`, content, JSON.stringify([{ sourceKind: 'meeting_analysis', sourceId: 'x', sourceDate: '2026-11-15', label: 'פגישת בדיקה' }]), now, now)
  conn.close()

  await page.goto('/memory')
  await page.getByTestId('memory-proposals-tab').click()
  const proposal = page.getByTestId('memory-proposal').filter({ hasText: content })
  await expect(proposal).toBeVisible({ timeout: 20000 })
  await expect(proposal.getByText('מתוך: פגישת בדיקה')).toBeVisible()
  await proposal.getByRole('button', { name: 'שמור', exact: true }).click()
  await expect(proposal).toHaveCount(0)
  await page.getByRole('button', { name: 'הכל', exact: true }).nth(1).click()
  await expect(page.locator('.card', { hasText: content }).first()).toBeVisible()
})

test('a pending agent correction is applied as a rule for that agent only', async ({ page }) => {
  const stamp = Date.now()
  const rule = `אל תציע פגישות אחרי 18:00 ${stamp}`
  const conn = db()
  const now = new Date().toISOString()
  // Whichever agent the screen selects first gets a pending correction.
  const agentIds = conn.prepare(`SELECT DISTINCT agent_id AS id FROM agent_schedules`).all() as Array<{ id: string }>
  const ids = new Set(['01_Hugo_orchestrator', ...agentIds.map((a) => a.id)])
  const insert = conn.prepare(
    `INSERT INTO agent_feedback (id, agent_id, feedback, status, suggested_rule, created_at, updated_at) VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
  )
  for (const id of ids) insert.run(`afb_e2e_${stamp}_${id}`, id, `שוב הציע ערב ${stamp}`, rule, now, now)
  conn.close()

  await page.goto('/agents/manage')
  await expect(page.getByTestId('agent-config-panel')).toBeVisible({ timeout: 20000 })
  const panel = page.getByTestId('agent-rules-panel')
  await expect(panel).toBeVisible({ timeout: 20000 })
  const pending = panel.getByTestId('agent-feedback-pending').filter({ hasText: String(stamp) })
  await expect(pending.getByLabel('כלל מוצע')).toHaveValue(rule)
  await pending.getByRole('button', { name: 'החל' }).click()
  await expect(panel.getByTestId('agent-rule').filter({ hasText: rule })).toBeVisible()
})

import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

const dbPath = path.join(__dirname, '../data/e2e.sqlite')

function seedTraits() {
  const db = new Database(dbPath)
  try { db.exec('ALTER TABLE people ADD COLUMN traits_at TEXT') } catch { /* column already exists */ }
  const now = new Date().toISOString()
  const stamp = Date.now()
  const personId = `p_traits_${stamp}`
  const name = `אופי ${stamp}`
  db.exec(`
    CREATE TABLE IF NOT EXISTS person_observations (
      id TEXT PRIMARY KEY NOT NULL,
      person_id TEXT NOT NULL,
      claim TEXT NOT NULL,
      quote TEXT,
      source_kind TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_date TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS person_traits (
      id TEXT PRIMARY KEY NOT NULL,
      person_id TEXT NOT NULL,
      label TEXT NOT NULL,
      line TEXT NOT NULL,
      reasoning TEXT NOT NULL,
      support_count INTEGER NOT NULL,
      latest_source_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'shown',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS person_trait_evidence (
      id TEXT PRIMARY KEY NOT NULL,
      trait_id TEXT NOT NULL,
      observation_id TEXT NOT NULL
    );
  `)
  db.prepare(`INSERT INTO people (id, name, status, source, created_at, traits_at) VALUES (?, ?, 'confirmed', 'manual', ?, ?)`).run(personId, name, now, now)
  const insertObs = db.prepare(`INSERT INTO person_observations (id, person_id, claim, quote, source_kind, source_id, source_date, created_at) VALUES (?, ?, ?, ?, 'meeting_analysis', ?, '2026-08-01', ?)`)
  const insertEv = db.prepare(`INSERT INTO person_trait_evidence (id, trait_id, observation_id) VALUES (?, ?, ?)`)
  db.prepare(`INSERT INTO person_traits (id, person_id, label, line, reasoning, support_count, latest_source_date, status, created_at, updated_at) VALUES (?, ?, 'ישיר', 'ישיר אומר מה שהוא רוצה', 'חזר על זה בשלוש שיחות.', 3, '2026-08-20', 'shown', ?, ?)`).run(`ptr_a_${stamp}`, personId, now, now)
  db.prepare(`INSERT INTO person_traits (id, person_id, label, line, reasoning, support_count, latest_source_date, status, created_at, updated_at) VALUES (?, ?, 'יסודי', 'יסודי בודק לפני שמתחייב', 'שתי שיחות של בדיקה.', 2, '2026-08-01', 'shown', ?, ?)`).run(`ptr_b_${stamp}`, personId, now, now)
  insertObs.run(`po_${stamp}`, personId, 'אומר מה שהוא רוצה', 'בוא נחליט', `m_${stamp}`, now)
  insertEv.run(`pte_${stamp}`, `ptr_a_${stamp}`, `po_${stamp}`)
  db.close()
  return { name }
}

test('shows character traits strongest first and hides one from the detail', async ({ page }) => {
  const { name } = seedTraits()
  await page.goto('/people')
  await page.getByPlaceholder('חיפוש אנשים...').fill(name)
  await page.getByText(name, { exact: true }).first().click()

  const block = page.getByTestId('person-traits')
  await expect(block).toBeVisible({ timeout: 20000 })
  const lines = block.locator('li')
  await expect(lines.nth(0)).toContainText('ישיר')
  await expect(lines.nth(1)).toContainText('יסודי')
  await expect(block.getByText(/לפי 1 שיחות/)).toBeVisible()

  await block.getByRole('button', { name: 'פירוט תכונות' }).click()
  const detail = page.getByTestId('person-traits-detail')
  await expect(detail.getByText('חזר על זה בשלוש שיחות.')).toBeVisible()
  await detail.getByRole('button', { name: 'הסתר תכונה' }).first().click()
  await expect(block.getByRole('status')).toContainText('התכונה הוסתרה')
  await expect(lines.filter({ hasText: 'ישיר' })).toHaveCount(0)
})

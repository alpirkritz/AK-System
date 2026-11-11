/** docs/specs/waiting-commitment-open.md — open an accepted commitment on "חייבים לי" and turn it into a task. */
import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

const dbPath = path.join(__dirname, '../data/e2e.sqlite')

function seed(source: 'voice' | 'whatsapp_dm') {
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  const stamp = `${Date.now()}_${source}`
  const personId = `p_wco_${stamp}`
  const commitmentId = `cm_wco_${stamp}`
  const title = `פידבק לירדן ${stamp}`
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
  db.prepare(`INSERT INTO people (id, name, status, source, created_at) VALUES (?, ?, 'confirmed', 'manual', ?)`)
    .run(personId, `טל ${stamp}`, now)
  db.prepare(
    `INSERT INTO commitments (id, person_id, owner, content, source, status, due_inferred, created_at, updated_at)
     VALUES (?, ?, 'them', ?, ?, 'accepted', ?, ?, ?)`,
  ).run(commitmentId, personId, title, source, today, now, now)
  db.close()
  return { commitmentId, title }
}

function linkedTaskId(commitmentId: string): string | null {
  const db = new Database(dbPath, { readonly: true })
  const row = db.prepare('SELECT task_id FROM commitments WHERE id = ?').get(commitmentId) as { task_id: string | null }
  db.close()
  return row.task_id
}

test.describe('Waiting list — open a commitment', () => {
  test('clicking a commitment opens a prefilled TaskModal and saving turns it into a task', async ({ page }) => {
    const { commitmentId, title } = seed('voice')
    await page.goto('/waiting')

    const open = page.getByTestId('waiting-commitment-open').filter({ hasText: title })
    await expect(open).toBeVisible({ timeout: 20_000 })
    await open.click()

    const titleInput = page.locator(`input[value="${title}"]`)
    await expect(titleInput).toBeVisible({ timeout: 10_000 })
    await page.getByRole('button', { name: 'שמור' }).click()

    await expect.poll(() => linkedTaskId(commitmentId), { timeout: 10_000 }).not.toBeNull()
    const taskId = linkedTaskId(commitmentId)!

    // The same row now opens as a task, not a commitment.
    await expect(page.getByTestId('waiting-commitment-open').filter({ hasText: title })).toHaveCount(0)
    const taskLink = page.getByRole('link', { name: title })
    await expect(taskLink).toHaveAttribute('href', `/tasks?task=${taskId}`)
  })

  test('a WhatsApp commitment shows a source-context toggle; a voice one does not', async ({ page }) => {
    const wa = seed('whatsapp_dm')
    const voice = seed('voice')
    await page.goto('/waiting')

    const waRow = page.getByTestId('waiting-row').filter({ hasText: wa.title })
    await expect(waRow).toBeVisible({ timeout: 20_000 })
    await waRow.getByTestId('commitment-context-toggle').click()
    await expect(waRow.getByTestId('commitment-context')).toBeVisible()

    const voiceRow = page.getByTestId('waiting-row').filter({ hasText: voice.title })
    await expect(voiceRow.getByTestId('commitment-context-toggle')).toHaveCount(0)
  })
})

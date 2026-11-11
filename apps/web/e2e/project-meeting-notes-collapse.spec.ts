import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

function seedProjectWithNote() {
  const dbPath = path.join(__dirname, '../data/e2e.sqlite')
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  const projectId = `p_collapse_${Date.now()}`
  const noteId = `mn_collapse_${Date.now()}`
  const noteTitle = 'Quarterly Planning Sync'

  db.prepare(
    `INSERT INTO projects (id, name, color, source, created_at, updated_at)
     VALUES (?, ?, '#47b8e8', 'manual', ?, ?)`,
  ).run(projectId, 'Collapse Test Project', now, now)

  db.prepare(
    `INSERT INTO meeting_notes (id, title, date, snippet, body_text, meeting_id, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, NULL, 'notion', ?, ?)`,
  ).run(noteId, noteTitle, now.slice(0, 10), 'Short snippet', 'Full note body text for the collapse test.', now, now)

  db.prepare(
    `INSERT INTO meeting_note_projects (meeting_note_id, project_id) VALUES (?, ?)`,
  ).run(noteId, projectId)

  db.close()
  return { projectId, noteId, noteTitle }
}

test.describe('Project meeting-notes collapsible section', () => {
  test('starts collapsed and toggles open/closed', async ({ page }) => {
    const { projectId, noteTitle } = seedProjectWithNote()

    await page.goto(`/projects/${projectId}`)
    await expect(page.getByRole('heading', { name: 'Collapse Test Project' })).toBeVisible({ timeout: 20000 })

    const header = page.getByRole('button', { name: /סיכומי ישיבות/ })
    await expect(header).toBeVisible()
    await expect(header).toHaveAttribute('aria-expanded', 'false')

    // Collapsed: note content is not rendered at all
    await expect(page.getByText(noteTitle)).not.toBeVisible()

    await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'true')
    await expect(page.getByText(noteTitle)).toBeVisible()

    await header.click()
    await expect(header).toHaveAttribute('aria-expanded', 'false')
    await expect(page.getByText(noteTitle)).not.toBeVisible()
  })
})

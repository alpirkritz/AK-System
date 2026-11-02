import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

const dbPath = path.join(__dirname, '../data/e2e.sqlite')
const suffix = Date.now()
const personId = `p_needs_${suffix}`
const personName = `Needs Oneonone ${suffix}`
const meetingIds = [0, 1, 2, 3].map((i) => `m_needs_${suffix}_${i}`)

function iso(daysAgo: number) {
  return new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10)
}

test.beforeAll(() => {
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  db.prepare(`INSERT INTO people (id, name, color, created_at) VALUES (?, ?, '#2dd4bf', ?)`).run(personId, personName, now)
  // Two weak 1:1s after two strong ones.
  const history: [number, number][] = [[5, 3], [20, 3], [80, 9], [110, 9]]
  history.forEach(([daysAgo, score], i) => {
    db.prepare(
      `INSERT INTO meetings (id, title, date, time, source, created_at, updated_at) VALUES (?, '1:1', ?, '10:00', 'manual', ?, ?)`,
    ).run(meetingIds[i], iso(daysAgo), now, now)
    db.prepare(`INSERT INTO meeting_people (meeting_id, person_id) VALUES (?, ?)`).run(meetingIds[i], personId)
    db.prepare(
      `INSERT INTO meeting_analyses (id, meeting_id, source, score, status, created_at, updated_at) VALUES (?, ?, 'transcript', ?, 'completed', ?, ?)`,
    ).run(`a_${meetingIds[i]}`, meetingIds[i], score, now, now)
  })
  db.close()
})

test.afterAll(() => {
  const db = new Database(dbPath)
  for (const id of meetingIds) {
    db.prepare(`DELETE FROM meeting_analyses WHERE meeting_id = ?`).run(id)
    db.prepare(`DELETE FROM meeting_people WHERE meeting_id = ?`).run(id)
    db.prepare(`DELETE FROM meetings WHERE id = ?`).run(id)
  }
  db.prepare(`DELETE FROM people WHERE id = ?`).run(personId)
  db.close()
})

test('a person who needs a 1:1 can be marked as seen and brought back', async ({ page }) => {
  await page.goto('/relationships')
  const card = page.getByTestId('relationship-card').filter({ hasText: personName })
  await expect(card).toBeVisible({ timeout: 20000 })
  await expect(card).toHaveAttribute('data-status', 'needs_1on1')
  await expect(card.getByText('1:1 חלש')).toBeVisible()
  await expect(card.getByRole('link', { name: 'קבע 1:1' })).toHaveAttribute('href', /calendar\.google\.com/)

  await card.getByRole('button', { name: 'ראיתי' }).click()
  const handled = page.locator('section').filter({ hasText: 'בטיפול' }).getByTestId('relationship-card').filter({ hasText: personName })
  await expect(handled).toBeVisible()
  await expect(handled.getByText('סימנת שראית')).toBeVisible()

  await handled.getByRole('button', { name: 'החזר לרשימה' }).click()
  await expect(
    page.locator('section').filter({ hasText: 'צריך 1:1' }).getByTestId('relationship-card').filter({ hasText: personName }),
  ).toBeVisible()
})

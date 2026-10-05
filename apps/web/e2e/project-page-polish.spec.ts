import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

function seedScenario() {
  const dbPath = path.join(__dirname, '../data/e2e.sqlite')
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  const suffix = Date.now()

  const companyId = `co_polish_${suffix}`
  const projectId = `p_polish_${suffix}`
  const personId = `person_polish_${suffix}`
  const notionPageId = '3cce7d50-cb8e-809c-8f7c-da639bce5478'

  db.prepare(
    `INSERT INTO companies (id, name, tax_id_type, country, preferred_language, created_at, updated_at)
     VALUES (?, ?, 'company', 'IL', 'he', ?, ?)`,
  ).run(companyId, 'Acme Industries', now, now)

  db.prepare(
    `INSERT INTO projects (id, name, color, notion_page_id, company_id, source, created_at, updated_at)
     VALUES (?, ?, '#47b8e8', ?, ?, 'manual', ?, ?)`,
  ).run(projectId, 'Polish Test Project', notionPageId, companyId, now, now)

  db.prepare(
    `INSERT INTO people (id, name, color, created_at, updated_at) VALUES (?, ?, '#2dd4bf', ?, ?)`,
  ).run(personId, 'Dana Roster', now, now)

  db.prepare(`INSERT INTO project_people (project_id, person_id) VALUES (?, ?)`).run(projectId, personId)

  // Tasks: a low-priority task due sooner should rank before a high-priority task due later.
  const soonTaskId = `t_soon_${suffix}`
  const laterTaskId = `t_later_${suffix}`
  db.prepare(
    `INSERT INTO tasks (id, title, priority, status, done, due_date, project_id, created_at, updated_at)
     VALUES (?, 'Due Soon Low Priority', 'low', 'not_started', 0, '2026-10-01', ?, ?, ?)`,
  ).run(soonTaskId, projectId, now, now)
  db.prepare(
    `INSERT INTO tasks (id, title, priority, status, done, due_date, project_id, created_at, updated_at)
     VALUES (?, 'Due Later High Priority', 'high', 'not_started', 0, '2026-11-15', ?, ?, ?)`,
  ).run(laterTaskId, projectId, now, now)

  // Meetings: one in the past, one upcoming — upcoming should render first.
  const pastMeetingId = `m_past_${suffix}`
  const futureMeetingId = `m_future_${suffix}`
  db.prepare(
    `INSERT INTO meetings (id, title, date, time, project_id, source, created_at, updated_at)
     VALUES (?, 'Old Standup', '2026-01-05', '09:00', ?, 'manual', ?, ?)`,
  ).run(pastMeetingId, projectId, now, now)
  db.prepare(
    `INSERT INTO meetings (id, title, date, time, project_id, source, created_at, updated_at)
     VALUES (?, 'Upcoming Kickoff', '2099-01-05', '09:00', ?, 'manual', ?, ?)`,
  ).run(futureMeetingId, projectId, now, now)

  db.close()
  return { projectId, personId, companyId, pastMeetingId, futureMeetingId, soonTaskId, laterTaskId }
}

test.describe('Project detail page polish', () => {
  test('shows company name and Notion link in the header', async ({ page }) => {
    const { projectId } = seedScenario()

    await page.goto(`/projects/${projectId}`)
    await expect(page.getByRole('heading', { name: 'Polish Test Project' })).toBeVisible({ timeout: 20000 })

    await expect(page.getByText('Acme Industries')).toBeVisible()
    const notionLink = page.getByRole('link', { name: /פתח ב-Notion/ })
    await expect(notionLink).toBeVisible()
    await expect(notionLink).toHaveAttribute('href', 'https://www.notion.so/3cce7d50cb8e809c8f7cda639bce5478')
  })

  test('roster: clicking a name opens the person, a separate control removes them', async ({ page }) => {
    const { projectId } = seedScenario()

    await page.goto(`/projects/${projectId}`)
    await expect(page.getByRole('heading', { name: 'Polish Test Project' })).toBeVisible({ timeout: 20000 })

    await page.getByText('Dana Roster').click()
    await expect(page.getByText('ערוך איש קשר')).toBeVisible()
    await expect(page.getByLabel('שם מלא')).toHaveValue('Dana Roster')
    await page.getByRole('button', { name: 'ביטול' }).click()
    await expect(page.getByText('ערוך איש קשר')).not.toBeVisible()

    const removeButton = page.getByRole('button', { name: /הסר את Dana Roster מהפרויקט/ })
    await removeButton.click()
    await expect(page.getByText('Dana Roster')).not.toBeVisible()
  })

  test('tasks: nearest due date wins over priority', async ({ page }) => {
    const { projectId } = seedScenario()

    await page.goto(`/projects/${projectId}`)
    await expect(page.getByRole('heading', { name: 'Polish Test Project' })).toBeVisible({ timeout: 20000 })

    const taskTitles = page.locator('.task-row .flex-1')
    await expect(taskTitles.first()).toContainText('Due Soon Low Priority')
    await expect(taskTitles.nth(1)).toContainText('Due Later High Priority')
  })

  test('meetings: upcoming meeting listed before past meeting', async ({ page }) => {
    const { projectId } = seedScenario()

    await page.goto(`/projects/${projectId}`)
    await expect(page.getByRole('heading', { name: 'Polish Test Project' })).toBeVisible({ timeout: 20000 })

    const meetingTitles = page.locator('.meeting-card .font-medium')
    await expect(meetingTitles.first()).toContainText('Upcoming Kickoff')
    await expect(meetingTitles.nth(1)).toContainText('Old Standup')
  })

  test('quick add meeting button opens MeetingModal pre-filled with this project', async ({ page }) => {
    const { projectId } = seedScenario()

    await page.goto(`/projects/${projectId}`)
    await expect(page.getByRole('heading', { name: 'Polish Test Project' })).toBeVisible({ timeout: 20000 })

    await page.getByRole('button', { name: '+ פגישה' }).click()
    await expect(page.getByText('פגישה חדשה')).toBeVisible()
    await expect(page.getByLabel('פרויקט')).toHaveValue(projectId)
  })
})

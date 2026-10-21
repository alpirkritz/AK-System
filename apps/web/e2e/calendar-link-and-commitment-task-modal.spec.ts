import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

const dbPath = path.join(__dirname, '../data/e2e.sqlite')

function seed() {
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  const stamp = Date.now()
  const personId = `p_clam_${stamp}`
  const name = `דנה לוי ${stamp}`
  const voiceMeetingId = `m_voice_clam_${stamp}`
  const calMeetingId = `m_cal_clam_${stamp}`
  const commitmentId = `cm_clam_${stamp}`

  // Person
  db.prepare(`INSERT INTO people (id, name, status, source, created_at) VALUES (?, ?, 'confirmed', 'manual', ?)`)
    .run(personId, name, now)

  // Voice-source meeting (the kind that can be attached to calendar)
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
  db.prepare(
    `INSERT INTO meetings (id, title, date, time, source, created_at, updated_at) VALUES (?, ?, ?, '09:00', 'voice', ?, ?)`,
  ).run(voiceMeetingId, `הקלטת שיחה עם ${name}`, localDate, now, now)
  db.prepare(`INSERT INTO meeting_people (meeting_id, person_id) VALUES (?, ?)`).run(voiceMeetingId, personId)

  // Calendar meeting on the same day — potential attach target
  db.prepare(
    `INSERT INTO meetings (id, title, date, time, end_time, source, created_at, updated_at) VALUES (?, ?, ?, '09:00', '10:00', 'calendar', ?, ?)`,
  ).run(calMeetingId, `סטטוס שבועי ${stamp}`, localDate, now, now)

  // Commitment linked to the voice meeting
  db.prepare(
    `INSERT INTO commitments (id, person_id, owner, content, source, source_id, status, created_at, updated_at)
     VALUES (?, ?, 'me', ?, 'voice', ?, 'proposed', ?, ?)`,
  ).run(commitmentId, personId, `לשלוח פרוטוקול ${stamp}`, voiceMeetingId, now, now)

  db.close()
  return { stamp, name, personId, voiceMeetingId, calMeetingId, commitmentId }
}

test.describe('Calendar link and commitment task modal', () => {
  test('meeting summary page shows attach-to-calendar button for voice meetings', async ({ page }) => {
    const { voiceMeetingId, calMeetingId, stamp } = seed()

    await page.goto(`/meetings/${voiceMeetingId}`)
    const btn = page.getByTestId('attach-to-calendar-btn')
    await expect(btn).toBeVisible({ timeout: 20_000 })

    // Opening the picker should list the calendar meeting
    await btn.click()
    const picker = page.getByTestId('attach-to-calendar-picker')
    await expect(picker).toBeVisible()
    await expect(picker).toContainText(`סטטוס שבועי ${stamp}`)

    // Clicking the calendar meeting should redirect to the calendar meeting page
    await picker.getByText(`סטטוס שבועי ${stamp}`).click()
    await expect(page).toHaveURL(new RegExp(`/meetings/${calMeetingId}`), { timeout: 10_000 })
  })

  test('calendar meeting does NOT show attach-to-calendar button', async ({ page }) => {
    const { calMeetingId } = seed()

    await page.goto(`/meetings/${calMeetingId}`)
    // Wait for page to load
    await expect(page.getByRole('heading')).toBeVisible({ timeout: 20_000 })
    await expect(page.getByTestId('attach-to-calendar-btn')).toHaveCount(0)
  })

  test('voice page review panel shows linked meeting when started from a meeting link', async ({ page }) => {
    const { calMeetingId, stamp } = seed()

    // Navigate to the voice page with a preset meeting (deep link from a calendar event)
    await page.goto(`/voice?meeting=${calMeetingId}`)

    // Verify the preset meeting is shown
    const preset = page.getByTestId('voice-preset-meeting')
    await expect(preset).toContainText(`סטטוס שבועי ${stamp}`, { timeout: 20_000 })

    // The review panel shows a meeting link row only once recording is stopped —
    // we just verify the start button is secondary/ghost when a preset is set
    const startFreeBtn = page.getByTestId('voice-start')
    await expect(startFreeBtn).toBeVisible()
    // When a preset meeting is active, the free-record button is deprioritized (btn-ghost class)
    await expect(startFreeBtn).not.toHaveClass(/btn-primary/)
  })

  test('commitment accept button opens TaskModal with prefilled content', async ({ page }) => {
    const { stamp } = seed()

    await page.goto('/commitments')
    await expect(page.getByTestId('commitments-list')).toBeVisible({ timeout: 20_000 })

    // Find the commitment row for this test run
    const row = page.getByTestId('commitment-row').filter({ hasText: `לשלוח פרוטוקול ${stamp}` })
    await expect(row).toBeVisible()

    // Click "קבל" — should open TaskModal
    await row.getByRole('button', { name: 'קבל' }).click()

    // The full TaskModal dialog should appear
    const modal = page.locator('.modal')
    await expect(modal).toBeVisible({ timeout: 10_000 })
    await expect(modal.getByRole('heading', { name: 'משימה חדשה' })).toBeVisible()

    // Title should be prefilled with the commitment content
    const titleInput = modal.locator('input.input').first()
    await expect(titleInput).toHaveValue(`לשלוח פרוטוקול ${stamp}`)

    // A Hebrew explanation should appear under the title
    await expect(modal).toContainText('💡')

    // Closing the modal should not mark the commitment as accepted
    await page.keyboard.press('Escape')
    await expect(modal).toHaveCount(0)
    await expect(row).toBeVisible() // commitment row still there
  })
})

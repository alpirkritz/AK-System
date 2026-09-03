import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

function seedMeetingWithTranscript() {
  const dbPath = path.join(__dirname, '../data/e2e.sqlite')
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  const meetingId = `m_analysis_${Date.now()}`
  const noteId = `mn_analysis_${Date.now()}`
  const transcript = `
דובר 1: אז בואו נתחיל. היום אנחנו צריכים לסגור את הרואדמאפ לרבעון הבא.
דובר 2: נכון, יש לנו כמה פיצ'רים חשובים שצריך לתעדף.
דובר 1: אני חושב שצריך להתחיל עם המודול של הדשבורד החדש.
דובר 2: מסכים. אני אקח את זה על עצמי ואסיים עד יום רביעי.
דובר 1: מצוין. בנוסף צריך לתאם פגישת המשך עם הצוות.
דובר 2: אני אדאג לכך. אשלח הזמנה היום אחר הצהריים.
דובר 1: נהדר. אני חושב שהיינו יעילים היום.
`.repeat(3)

  db.prepare(
    `INSERT INTO meetings (id, title, date, time, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(meetingId, 'תכנון ספרינט Q2', now.slice(0, 10), '10:00', now, now)

  try {
    db.exec('ALTER TABLE meeting_notes ADD COLUMN source_kind TEXT')
  } catch {
    /* already exists */
  }

  db.prepare(
    `INSERT INTO meeting_notes (
      id, title, date, snippet, body_text, meeting_id,
      source, source_kind, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'notion', 'ai_summary', ?, ?)`,
  ).run(
    noteId,
    'תכנון ספרינט Q2',
    now.slice(0, 10),
    transcript.slice(0, 100),
    transcript,
    meetingId,
    now,
    now,
  )

  db.close()
  return { meetingId, transcript }
}

test.describe('Meeting Conversation Analysis', () => {
  test('shows analyze button when no analysis exists', async ({ page }) => {
    const { meetingId } = seedMeetingWithTranscript()

    await page.goto(`/meetings/${meetingId}`)
    await expect(page.getByRole('heading', { name: 'תכנון ספרינט Q2' })).toBeVisible({ timeout: 20000 })

    await expect(page.getByText('ניתוח שיחה עמוק')).toBeVisible()
    await expect(page.getByRole('button', { name: /נתח שיחה/ })).toBeVisible()
  })

  test('triggers analysis and displays results', async ({ page }) => {
    const { meetingId } = seedMeetingWithTranscript()

    await page.goto(`/meetings/${meetingId}`)
    await expect(page.getByRole('heading', { name: 'תכנון ספרינט Q2' })).toBeVisible({ timeout: 20000 })

    // Mock the Gemini API response
    await page.route('**/api/trpc/meetings.analyzeTranscript*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          result: {
            data: {
              status: 'completed',
              hatName: 'White Hat (עובדות וניתוח אובייקטיבי)',
              topic: 'תכנון ספרינט Q2',
              mood: 'ממוקד ומעט לחוץ',
              subtext: 'קיים לחץ עדין להשיג יעדים',
              keyInsight: 'הצוות מחפש בהירות לגבי סדרי עדיפויות',
              score: 7,
              scoreRationale: 'שיחה מעשית אבל חסרה תובנה מפתיעה',
              kaizenKeep: 'הקשבה טובה וסיכום נקודות פעולה',
              kaizenImprove: 'להקדיש זמן לחשיבה יצירתית',
              openQuestion: 'איך נוכל לשפר את היעילות בתקשורת הפנימית?',
              participants: [
                { name: 'אלפיר', confirmed: true },
                { name: 'דנה', confirmed: false },
              ],
              actionItems: [
                { content: 'לעדכן את הרואדמאפ עד יום רביעי', owner: 'אלפיר' },
                { content: 'לתאם פגישת המשך עם הצוות' },
              ],
            },
          },
        }),
      })
    })

    await page.getByRole('button', { name: /נתח שיחה/ }).click()

    // Wait for analysis to complete
    await expect(page.getByText('ממתין לניתוח')).toBeVisible({ timeout: 5000 })

    // Check analysis results are displayed
    await expect(page.getByText('White Hat (עובדות וניתוח אובייקטיבי)')).toBeVisible({ timeout: 15000 })
    await expect(page.getByText('תכנון ספרינט Q2')).toBeVisible()
    await expect(page.getByText('ממוקד ומעט לחוץ')).toBeVisible()
    await expect(page.getByText('7/10')).toBeVisible()
    await expect(page.getByText('לעדכן את הרואדמאפ עד יום רביעי')).toBeVisible()
  })

  test('allows creating tasks from action items', async ({ page }) => {
    const { meetingId } = seedMeetingWithTranscript()

    // Seed an existing analysis
    const dbPath = path.join(__dirname, '../data/e2e.sqlite')
    const db = new Database(dbPath)
    const now = new Date().toISOString()
    const analysisId = `ma_e2e_${Date.now()}`

    db.prepare(
      `INSERT INTO meeting_analyses (
        id, meeting_id, source, status,
        hat_name, topic, mood, subtext, key_insight,
        score, score_rationale, kaizen_keep, kaizen_improve, open_question,
        participants_json, action_items_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      analysisId,
      meetingId,
      'notion_transcript',
      'completed',
      'White Hat (עובדות וניתוח אובייקטיבי)',
      'תכנון ספרינט Q2',
      'ממוקד ומעט לחוץ',
      'קיים לחץ עדין להשיג יעדים',
      'הצוות מחפש בהירות לגבי סדרי עדיפויות',
      7,
      'שיחה מעשית אבל חסרה תובנה מפתיעה',
      'הקשבה טובה וסיכום נקודות פעולה',
      'להקדיש זמן לחשיבה יצירתית',
      'איך נוכל לשפר את היעילות בתקשורת הפנימית?',
      JSON.stringify([
        { name: 'אלפיר', confirmed: true },
        { name: 'דנה', confirmed: false },
      ]),
      JSON.stringify([
        { content: 'לעדכן את הרואדמאפ עד יום רביעי', owner: 'אלפיר' },
        { content: 'לתאם פגישת המשך עם הצוות' },
      ]),
      now,
      now,
    )
    db.close()

    await page.goto(`/meetings/${meetingId}`)
    await expect(page.getByRole('heading', { name: 'תכנון ספרינט Q2' })).toBeVisible({ timeout: 20000 })

    // Find and click "Create Task" button for first action item
    const createTaskButtons = page.getByRole('button', { name: /צור משימה/ })
    await expect(createTaskButtons.first()).toBeVisible()
    await createTaskButtons.first().click()

    // Verify task was created (check for success feedback)
    await expect(page.getByText('✓')).toBeVisible({ timeout: 10000 })

    // Navigate to tasks page to verify
    await page.goto('/tasks')
    await expect(page.getByText('לעדכן את הרואדמאפ עד יום רביעי')).toBeVisible({ timeout: 10000 })
  })

  test('can create all tasks at once', async ({ page }) => {
    const { meetingId } = seedMeetingWithTranscript()

    // Seed an existing analysis
    const dbPath = path.join(__dirname, '../data/e2e.sqlite')
    const db = new Database(dbPath)
    const now = new Date().toISOString()
    const analysisId = `ma_e2e_bulk_${Date.now()}`

    db.prepare(
      `INSERT INTO meeting_analyses (
        id, meeting_id, source, status,
        hat_name, topic, action_items_json,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      analysisId,
      meetingId,
      'notion_transcript',
      'completed',
      'White Hat',
      'תכנון',
      JSON.stringify([
        { content: 'משימה א' },
        { content: 'משימה ב' },
        { content: 'משימה ג' },
      ]),
      now,
      now,
    )
    db.close()

    await page.goto(`/meetings/${meetingId}`)
    await expect(page.getByRole('heading', { name: 'תכנון ספרינט Q2' })).toBeVisible({ timeout: 20000 })

    await page.getByRole('button', { name: /צור הכל כמשימות/ }).click()

    // Verify all tasks were created
    await page.goto('/tasks')
    await expect(page.getByText('משימה א')).toBeVisible({ timeout: 10000 })
    await expect(page.getByText('משימה ב')).toBeVisible()
    await expect(page.getByText('משימה ג')).toBeVisible()
  })

  test('shows raw transcript when toggled', async ({ page }) => {
    const { meetingId, transcript } = seedMeetingWithTranscript()

    // Seed an existing analysis with transcript
    const dbPath = path.join(__dirname, '../data/e2e.sqlite')
    const db = new Database(dbPath)
    const now = new Date().toISOString()
    const analysisId = `ma_e2e_transcript_${Date.now()}`

    db.prepare(
      `INSERT INTO meeting_analyses (
        id, meeting_id, source, status, transcript_text,
        hat_name, topic,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      analysisId,
      meetingId,
      'notion_transcript',
      'completed',
      transcript,
      'White Hat',
      'תכנון',
      now,
      now,
    )
    db.close()

    await page.goto(`/meetings/${meetingId}`)
    await expect(page.getByRole('heading', { name: 'תכנון ספרינט Q2' })).toBeVisible({ timeout: 20000 })

    // Transcript should be hidden by default
    await expect(page.getByText('דובר 1: אז בואו נתחיל')).not.toBeVisible()

    // Toggle transcript visibility
    await page.getByRole('button', { name: /הצג תמלול מלא/ }).click()

    // Transcript should now be visible
    await expect(page.getByText('דובר 1: אז בואו נתחיל')).toBeVisible()

    // Can hide it again
    await page.getByRole('button', { name: /הסתר תמלול/ }).click()
    await expect(page.getByText('דובר 1: אז בואו נתחיל')).not.toBeVisible()
  })
})

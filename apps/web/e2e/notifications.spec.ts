import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

// Fold 7 approximate CSS widths
const FOLDED = { width: 380, height: 880 }
const UNFOLDED = { width: 900, height: 1100 }

function seedNotification(opts?: { title?: string; body?: string; url?: string }) {
  const dbPath = path.join(__dirname, '../data/e2e.sqlite')
  const db = new Database(dbPath)
  try {
    db.exec('ALTER TABLE notifications ADD COLUMN archived_at TEXT')
  } catch {
    // column may already exist
  }
  const id = randomUUID()
  db.prepare(
    `INSERT INTO notifications (id, title, body, url, type, read_at, archived_at, created_at)
     VALUES (?, ?, ?, ?, 'system', NULL, NULL, ?)`,
  ).run(
    id,
    opts?.title ?? 'התראת בדיקה',
    opts?.body ?? 'תוכן מלא של ההודעה לבדיקה',
    opts?.url ?? '/chat',
    new Date().toISOString(),
  )
  db.close()
  return id
}

function seedChatMessage(content: string): string {
  const dbPath = path.join(__dirname, '../data/e2e.sqlite')
  const db = new Database(dbPath)
  const id = `msg_${Date.now()}_${randomUUID().slice(0, 5)}`
  db.prepare(
    `INSERT INTO chat_messages (id, role, content, source, created_at)
     VALUES (?, 'assistant', ?, 'cron', ?)`,
  ).run(id, content, new Date().toISOString())
  db.close()
  return id
}

async function expectChatReady(page: import('@playwright/test').Page) {
  await expect(page.getByRole('heading', { name: 'עוזר', exact: true })).toBeVisible({
    timeout: 20000,
  })
  // ChatPanel loads dynamically (ssr: false)
  await expect(page.getByPlaceholder('כתוב הודעה...')).toBeVisible({ timeout: 20000 })
}

test.describe('Mobile app + notifications', () => {
  test('chat page loads with input', async ({ page }) => {
    await page.goto('/chat')
    await expectChatReady(page)
    await expect(page.getByRole('button', { name: 'שלח' })).toBeVisible()
  })

  test('settings has an enable-notifications control', async ({ page }) => {
    await page.goto('/settings')
    await expect(page.getByRole('heading', { name: 'הגדרות' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('enable-notifications')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('test-notification')).toBeVisible()
  })

  test('notification bell visible in layout', async ({ page }) => {
    await page.goto('/chat')
    await expect(page.getByTestId('notification-bell')).toBeVisible({ timeout: 20000 })
  })

  test('notifications page loads', async ({ page }) => {
    await page.goto('/notifications')
    await expect(page.getByRole('heading', { name: 'התראות' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('notifications-empty')).toBeVisible({ timeout: 20000 })
  })

  test('tap opens detail modal and mark-read / archive actions work', async ({ page }) => {
    seedNotification({ title: 'פיצ׳ר דיטייל', body: 'גוף ההודעה המלא', url: '/chat' })
    await page.goto('/notifications')
    await expect(page.getByTestId('notification-item')).toBeVisible({ timeout: 20000 })
    await page.getByTestId('notification-item').getByRole('button', { name: /פתח התראה/ }).click()
    await expect(page.getByTestId('notification-detail')).toBeVisible()
    await expect(page.getByTestId('notification-detail')).toContainText('גוף ההודעה המלא')
    await expect(page.getByTestId('notification-goto-target')).toBeVisible()
    await page.getByTestId('notification-detail-close').click()
    await expect(page.getByTestId('notification-detail')).toHaveCount(0)

    await page.getByTestId('notification-archive-btn').click()
    await expect(page.getByTestId('notification-undo-toast')).toBeVisible()
    await expect(page.getByTestId('notifications-empty')).toBeVisible({ timeout: 10000 })
  })

  test('list stays a compact preview while the detail shows the whole body, scrollable', async ({
    page,
  }) => {
    const body = [
      '🤖 Meeting Prep Herald',
      '',
      '# Pre-meeting brief: Alpir - Tinko 1:1',
      '',
      '## Bottom line',
      '* לדון בהתקדמות אוטומציה של כרטיסי JIRA (דדליין דחוף).',
      '* להבין סטטוס שחרור גרסת Algo 2.64 עבור Doordash 1.4.4.',
      '* לשפר תקשורת פנימית ב-R&D לגבי Algo 4.0.',
      '',
      '## Meeting agenda',
      '1. סטטוס אוטומציה ותהליכי בנייה אוטומטיים בצוות',
      '2. בלוקרים פתוחים מול צוות התשתיות',
      '3. תכנון השבוע הבא וחלוקת משימות',
      '4. סקירת מדדי איכות והחזרות מהשטח',
      '',
      'שורת הסיום המלאה',
    ].join('\n')
    expect(body.length).toBeGreaterThan(300)

    seedNotification({ title: 'תדריך ארוך', body, url: '/chat' })
    await page.goto('/notifications')
    const row = page.getByTestId('notification-item')
    await expect(row).toBeVisible({ timeout: 20000 })

    // Preview is flattened and capped, so the tail never reaches the list row.
    await expect(row).not.toContainText('שורת הסיום המלאה')
    await expect(row).toContainText('Meeting Prep Herald')

    // A clamped row must not grow with body length.
    const rowHeight = (await row.boundingBox())?.height ?? 0
    expect(rowHeight).toBeLessThan(200)

    await row.getByRole('button', { name: /פתח התראה/ }).click()
    const detail = page.getByTestId('notification-detail')
    await expect(detail).toBeVisible()
    // Markdown markers are rendered as structure, not shown raw.
    await expect(detail).toContainText('Meeting agenda')
    await expect(detail).not.toContainText('## Meeting agenda')
    await expect(detail).toContainText('שורת הסיום המלאה')

    // Header and actions stay outside the scroll region.
    await expect(page.getByTestId('notification-detail-close')).toBeVisible()
    await expect(page.getByTestId('notification-goto-target')).toBeVisible()
    const scrollable = page.getByTestId('notification-detail-body')
    await expect(scrollable).toBeVisible()
    const overflowY = await scrollable.evaluate((el) => getComputedStyle(el).overflowY)
    expect(overflowY).toBe('auto')

    // Leave the inbox empty — this suite shares one DB and later tests assert exact counts.
    await page.getByTestId('notification-detail-close').click()
    await expect(detail).toHaveCount(0)
    await page.getByTestId('notification-archive-btn').click()
    await expect(page.getByTestId('notifications-empty')).toBeVisible({ timeout: 10000 })
  })

  test('opening a chat deep link scrolls to and highlights the linked message', async ({ page }) => {
    const messageId = seedChatMessage('תדריך הפגישה המלא שנשלח בהתראה')
    seedNotification({
      title: 'תדריך עם קישור',
      body: 'תדריך הפגישה המלא שנשלח בהתראה',
      url: `/chat?message=${messageId}`,
    })

    await page.goto('/notifications')
    await expect(page.getByTestId('notification-item')).toBeVisible({ timeout: 20000 })
    await page.getByTestId('notification-item').getByRole('button', { name: /פתח התראה/ }).click()
    await page.getByTestId('notification-goto-target').click()

    await expect(page).toHaveURL(new RegExp(`/chat\\?message=${messageId}`))
    const bubble = page.locator(`[data-message-id="${messageId}"]`)
    await expect(bubble).toBeVisible({ timeout: 20000 })
    await expect(bubble).toContainText('תדריך הפגישה המלא שנשלח בהתראה')

    await page.goto('/notifications')
    await page.getByTestId('archive-all').click()
    await expect(page.getByTestId('notifications-empty')).toBeVisible({ timeout: 10000 })
  })

  test('archive-all button clears the inbox and undo restores it', async ({ page }) => {
    seedNotification({ title: 'הודעה ראשונה' })
    seedNotification({ title: 'הודעה שנייה' })
    await page.goto('/notifications')
    await expect(page.getByTestId('notification-item')).toHaveCount(2, { timeout: 20000 })

    await page.getByTestId('archive-all').click()
    await expect(page.getByTestId('notification-archive-all-undo-toast')).toBeVisible()
    await expect(page.getByTestId('notifications-empty')).toBeVisible({ timeout: 10000 })

    await page.getByTestId('notification-archive-all-undo-toast').getByText('בטל').click()
    await expect(page.getByTestId('notification-item')).toHaveCount(2, { timeout: 10000 })
  })

  test('chat is usable folded (cover screen)', async ({ page }) => {
    await page.setViewportSize(FOLDED)
    await page.goto('/chat')
    await expectChatReady(page)
    await expect(page.locator('nav.fixed')).toBeVisible()
  })

  test('chat is usable unfolded (tablet width)', async ({ page }) => {
    await page.setViewportSize(UNFOLDED)
    await page.goto('/chat')
    await expectChatReady(page)
    await expect(page.getByRole('button', { name: 'שלח' })).toBeVisible()
  })
})

import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'
import { randomUUID } from 'node:crypto'

const PHONE = { width: 390, height: 844 }

function seedChatThread(count: number): { lastId: string; lastText: string } {
  const dbPath = path.join(__dirname, '../data/e2e.sqlite')
  const db = new Database(dbPath)
  const insert = db.prepare(
    `INSERT INTO chat_messages (id, role, content, source, created_at)
     VALUES (?, 'assistant', ?, 'cron', ?)`,
  )
  let lastId = ''
  let lastText = ''
  const base = Date.now()
  for (let i = 0; i < count; i++) {
    const id = `ux_${base}_${i}_${randomUUID().slice(0, 6)}`
    const text = i === count - 1 ? `הודעה אחרונה לבדיקת גלילה ${id}` : `הודעת היסטוריה ${i + 1}`
    insert.run(id, text, new Date(base + i * 1000).toISOString())
    lastId = id
    lastText = text
  }
  db.close()
  return { lastId, lastText }
}

test.describe('Assistant chat UX', () => {
  test.use({ viewport: PHONE })

  test('bottom nav עוזר opens the composer', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByRole('heading', { name: /ערב|בוקר|צהריים/ })).toBeVisible({
      timeout: 20000,
    })
    await page.getByTestId('nav-tab-chat').click()
    await expect(page).toHaveURL(/\/chat/, { timeout: 20000 })
    await expect(page.getByRole('heading', { name: 'עוזר', exact: true })).toBeVisible({
      timeout: 20000,
    })
    await expect(page.getByTestId('chat-composer')).toBeVisible({ timeout: 20000 })
    await expect(page.getByPlaceholder('כתוב הודעה...')).toBeVisible()
  })

  test('long history opens on the latest message and שלח is tappable', async ({ page }) => {
    const { lastId, lastText } = seedChatThread(40)
    await page.goto('/chat')
    await expect(page.getByRole('heading', { name: 'עוזר', exact: true })).toBeVisible({
      timeout: 20000,
    })
    await expect(page.getByTestId('chat-composer')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('quick-add-fab')).toHaveCount(0)

    const last = page.locator(`[data-message-id="${lastId}"]`)
    await expect(last).toBeVisible({ timeout: 20000 })
    await expect(last).toContainText(lastText)
    await expect(last).toBeInViewport()

    const send = page.getByTestId('chat-send')
    await expect(send).toBeVisible()
    const box = await send.boundingBox()
    expect(box).toBeTruthy()
    const hitSend = await page.evaluate(({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return el?.closest('[data-testid="chat-send"]') != null
    }, { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 })
    expect(hitSend).toBe(true)
  })

  test('composer stays in the viewport after focusing the input', async ({ page }) => {
    await page.goto('/chat')
    await expect(page.getByTestId('chat-composer')).toBeVisible({ timeout: 20000 })
    await expect(page.getByTestId('chat-composer')).toBeInViewport()
    await page.getByPlaceholder('כתוב הודעה...').focus()
    await expect(page.getByTestId('chat-composer')).toBeInViewport()
    await expect(page.getByPlaceholder('כתוב הודעה...')).toBeInViewport()
  })

  test('composer stays above a simulated on-screen keyboard', async ({ page }) => {
    await page.addInitScript(() => {
      const real = window.visualViewport
      if (!real) return
      let height = real.height
      const fake = {
        get height() {
          return height
        },
        get width() {
          return real.width
        },
        get offsetTop() {
          return 0
        },
        get offsetLeft() {
          return 0
        },
        get scale() {
          return real.scale
        },
        addEventListener: real.addEventListener.bind(real),
        removeEventListener: real.removeEventListener.bind(real),
        dispatchEvent(ev: Event) {
          return real.dispatchEvent(ev)
        },
      }
      Object.defineProperty(window, 'visualViewport', { configurable: true, value: fake })
      Object.defineProperty(window, '__akSetVisibleHeight', {
        value: (next: number) => {
          height = next
          window.dispatchEvent(new Event('resize'))
        },
      })
    })
    await page.goto('/chat')
    await expect(page.getByTestId('chat-composer')).toBeVisible({ timeout: 20000 })
    await page.evaluate(() => {
      ;(window as unknown as { __akSetVisibleHeight: (h: number) => void }).__akSetVisibleHeight(480)
    })
    const composer = page.getByTestId('chat-composer')
    await expect(composer).toBeInViewport()
    const box = await composer.boundingBox()
    expect(box).toBeTruthy()
    expect(box!.y + box!.height).toBeLessThanOrEqual(480 + 8)
    await page.screenshot({
      path: 'test-results/qa-ui-chat-keyboard-simulated.png',
      fullPage: false,
    })
  })
})

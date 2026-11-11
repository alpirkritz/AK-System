/** docs/specs/people-meeting-panel.md — resizable person panel with the "במפגש" view. */
import { test, expect, type Page } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

const dbPath = path.join(__dirname, '../data/e2e.sqlite')

function seed() {
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  const stamp = `${Date.now()}${Math.floor(Math.random() * 1000)}`
  const personId = `p_pmp_${stamp}`
  const name = `נועה ${stamp}`
  db.prepare(`INSERT INTO people (id, name, status, source, created_at) VALUES (?, ?, 'confirmed', 'manual', ?)`)
    .run(personId, name, now)
  db.prepare(
    `INSERT INTO commitments (id, person_id, owner, content, source, status, created_at, updated_at)
     VALUES (?, ?, 'them', ?, 'manual', 'accepted', ?, ?)`,
  ).run(`cm_pmp_${stamp}`, personId, `לשלוח חומרים ${stamp}`, now, now)
  db.close()
  return { name, stamp }
}

async function openPerson(page: Page, name: string) {
  await page.goto('/people')
  await page.getByPlaceholder('חיפוש אנשים...').fill(name)
  await page.getByText(name, { exact: true }).first().click()
  await expect(page.getByTestId('person-panel')).toBeVisible({ timeout: 20_000 })
}

test.describe('People meeting panel', () => {
  test('opens on "במפגש" with both counts, and quick-add moves the "אני חייב/ת" count', async ({ page }) => {
    const { name, stamp } = seed()
    await openPerson(page, name)

    await expect(page.getByTestId('person-tab-meeting')).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByTestId('person-card-they-owe')).toContainText('1')
    await expect(page.getByTestId('person-card-i-owe')).toContainText('0')
    await expect(page.getByTestId('person-owes-me')).toContainText(`לשלוח חומרים ${stamp}`)

    await page.getByTestId('person-add-task').click()
    const title = `להכין הצעה ${stamp}`
    await page.getByLabel('כותרת המשימה').fill(title)
    await page.getByLabel('כותרת המשימה').press('Enter')

    await expect(page.getByTestId('person-card-i-owe')).toContainText('1', { timeout: 10_000 })
    await expect(page.getByTestId('person-i-owe')).toContainText(title)
    // Focus returns to the input for the next item.
    await expect(page.getByLabel('כותרת המשימה')).toBeFocused()
  })

  test('details and history live on their own tabs', async ({ page }) => {
    const { name } = seed()
    await openPerson(page, name)

    await page.getByTestId('person-tab-details').click()
    await expect(page.getByTestId('person-affiliations')).toBeVisible()
    await expect(page.getByRole('button', { name: /^מזג/ })).toBeVisible()

    await page.getByTestId('person-tab-history').click()
    await expect(page.getByTestId('person-history')).toBeVisible()
    await expect(page.getByTestId('person-history')).toContainText('עוד לא היו פגישות')
  })

  test('the width handle resizes by keyboard and the width is remembered', async ({ page }) => {
    const { name } = seed()
    await openPerson(page, name)

    const handle = page.getByTestId('person-panel-resize')
    const panel = page.getByTestId('person-panel')
    const before = (await panel.boundingBox())!.width
    await handle.focus()
    await page.keyboard.press('Shift+ArrowLeft')
    await page.keyboard.press('Shift+ArrowLeft')
    await expect.poll(async () => Math.round((await panel.boundingBox())!.width)).toBe(Math.round(before + 128))
    await expect(handle).toHaveAttribute('aria-valuenow', String(before + 128))

    await page.keyboard.press('Escape')
    await openPerson(page, name)
    expect((await panel.boundingBox())!.width).toBeCloseTo(before + 128, 0)

    // restore the default for the other tests
    await page.evaluate(() => window.localStorage.removeItem('people_panel_width'))
  })

  test('wide panel with room beside it leaves the list usable (no backdrop)', async ({ page }) => {
    const { name } = seed()
    await page.setViewportSize({ width: 1800, height: 900 })
    await page.addInitScript(() => window.localStorage.setItem('people_panel_width', '760'))
    await openPerson(page, name)
    await expect(page.locator('.drawer-backdrop')).toHaveCount(0)
    await page.evaluate(() => window.localStorage.removeItem('people_panel_width'))
  })

  test.describe('Fold 7 cover screen (360px)', () => {
    test.use({ viewport: { width: 360, height: 800 } })

    test('full screen, no handle, cards side by side, nothing overflows', async ({ page }) => {
      const { name } = seed()
      await openPerson(page, name)
      const panel = (await page.getByTestId('person-panel').boundingBox())!
      expect(panel.width).toBe(360)
      await expect(page.getByTestId('person-panel-resize')).toHaveCount(0)
      const a = (await page.getByTestId('person-card-i-owe').boundingBox())!
      const b = (await page.getByTestId('person-card-they-owe').boundingBox())!
      expect(Math.abs(a.y - b.y)).toBeLessThan(2)
      expect(a.height).toBeGreaterThanOrEqual(44)
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
      expect(overflow).toBeLessThanOrEqual(1)
    })
  })
})

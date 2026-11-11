import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

function clearLayout() {
  const db = new Database(path.join(__dirname, '../data/e2e.sqlite'))
  try {
    db.prepare('UPDATE user_settings SET layout_prefs = NULL').run()
  } catch {
    // column or table not created yet: nothing to clear
  }
  db.close()
}

test.describe('Reorderable dashboard', () => {
  test.beforeEach(clearLayout)
  test.afterEach(clearLayout)

  test('hides a block, keeps it hidden after a reload, and brings it back', async ({ page }) => {
    await page.goto('/')
    const block = page.getByTestId('layout-block-actions')
    await expect(block).toBeAttached({ timeout: 20000 })

    await page.getByTestId('layout-edit-toggle').click()
    await page.getByRole('button', { name: 'הסתר פעולות מהירות', exact: true }).click()
    await expect(block).toHaveCount(0)
    await expect(page.getByTestId('layout-hidden-tray')).toBeVisible()

    await page.reload()
    await expect(page.getByTestId('layout-block-kpi')).toBeAttached({ timeout: 20000 })
    await expect(page.getByTestId('layout-block-actions')).toHaveCount(0)

    await page.getByTestId('layout-edit-toggle').click()
    await page.getByRole('button', { name: 'החזר פעולות מהירות', exact: true }).click()
    await expect(page.getByTestId('layout-block-actions')).toBeAttached()
  })

  test('moves a block with the keyboard and keeps the new order after a reload', async ({ page }) => {
    await page.goto('/')
    const order = async () =>
      page.locator('[data-testid^="layout-block-"]').evaluateAll((els) =>
        els.map((e) => (e as HTMLElement).dataset.testid!.replace('layout-block-', '')),
      )
    await expect(page.getByTestId('layout-block-kpi')).toBeAttached({ timeout: 20000 })
    const before = await order()

    await page.getByTestId('layout-edit-toggle').click()
    const handle = page.getByRole('button', { name: /גרור להזזת סיכום מהיר/ })
    await handle.focus()
    // dnd-kit measures between key presses, so each step needs a frame to settle.
    await page.keyboard.press('Space')
    await page.waitForTimeout(300)
    await page.keyboard.press('ArrowDown')
    await page.waitForTimeout(300)
    await page.keyboard.press('Space')

    await expect.poll(order).not.toEqual(before)
    const after = await order()

    await page.reload()
    await expect(page.getByTestId('layout-block-kpi')).toBeAttached({ timeout: 20000 })
    await expect.poll(order).toEqual(after)
  })
})

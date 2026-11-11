import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

const dbPath = path.join(__dirname, '../data/e2e.sqlite')

function seedPersonWithCommitments() {
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  const stamp = Date.now()
  const personId = `p_dm_${stamp}`
  const name = `דנה בדיקה ${stamp}`
  db.prepare(
    `INSERT INTO people (id, name, phone, status, source, created_at) VALUES (?, ?, ?, 'confirmed', 'manual', ?)`,
  ).run(personId, name, `0501${String(stamp).slice(-6)}`, now)
  const insert = db.prepare(
    `INSERT INTO commitments (id, person_id, owner, content, due_inferred, source, source_snippet, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 'whatsapp_dm', ?, 'proposed', ?, ?)`,
  )
  insert.run(`cm_me_${stamp}`, personId, 'me', `לשלוח הצעה ${stamp}`, '2026-10-01', 'אשלח לך מחר את ההצעה', now, now)
  insert.run(`cm_them_${stamp}`, personId, 'them', `לבדוק מספרים ${stamp}`, null, 'תבדוק את המספרים', now, now)
  db.close()
  return { name, stamp }
}

test.describe('WhatsApp 1:1 capture and commitments', () => {
  test('accepts one commitment into a task and dismisses the other', async ({ page }) => {
    const { stamp } = seedPersonWithCommitments()
    await page.goto('/commitments')
    const list = page.getByTestId('commitments-list')
    await expect(list).toBeVisible({ timeout: 20000 })

    await page.getByRole('tab', { name: 'שלהם' }).click()
    await expect(list.getByText(`לבדוק מספרים ${stamp}`)).toBeVisible()
    await expect(list.getByText(`לשלוח הצעה ${stamp}`)).toHaveCount(0)
    await page.getByRole('tab', { name: 'הכול' }).click()

    const mine = page.getByTestId('commitment-row').filter({ hasText: `לשלוח הצעה ${stamp}` })
    await mine.getByRole('button', { name: 'קבל' }).click()
    await expect(mine.getByLabel('תאריך יעד')).toHaveValue('2026-10-01')
    await mine.getByRole('button', { name: 'צור משימה' }).click()
    await expect(page.getByRole('status')).toContainText('נוצרה משימה')
    await expect(page.getByTestId('commitment-row').filter({ hasText: `לשלוח הצעה ${stamp}` })).toHaveCount(0)

    const theirs = page.getByTestId('commitment-row').filter({ hasText: `לבדוק מספרים ${stamp}` })
    await theirs.getByRole('button', { name: 'דחה' }).click()
    await expect(theirs).toHaveCount(0)
  })

  test('turns 1:1 capture on from the person card', async ({ page }) => {
    const { name } = seedPersonWithCommitments()
    await page.goto('/people')
    await page.getByPlaceholder('חיפוש אנשים...').fill(name)
    await page.getByText(name, { exact: true }).first().click()

    const toggle = page.getByTestId('capture-whatsapp-toggle')
    await expect(toggle).toBeVisible({ timeout: 20000 })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(page.getByTestId('person-commitments')).toContainText('התחייבויות לאישור (2)')
    await toggle.click()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByText('הודעות חדשות בצ׳אט הפרטי נשמרות בכרטיס')).toBeVisible()
  })
})

import { test, expect } from '@playwright/test'

// docs/specs/voice-recording-never-lost.md — Chromium's fake mic makes MediaRecorder produce real audio.
test.use({
  launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  permissions: ['microphone'],
})

/** Records until the on-screen timer passes the 10s minimum, then stops into review. */
async function recordPastMinimum(page: import('@playwright/test').Page) {
  await page.getByTestId('voice-start').click()
  await expect(page.getByRole('timer')).toHaveText(/00:1[2-9]/, { timeout: 40_000 })
  await page.getByRole('button', { name: 'עצור ושלח' }).click()
  await expect(page.getByTestId('voice-review-panel')).toBeVisible()
}

test.describe('a browser recording is never lost', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/voice')
    // Clean slate: no recordings left over on this device from earlier runs.
    await page.evaluate(() => new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('ak-voice')
      req.onsuccess = req.onerror = req.onblocked = () => resolve()
    }))
    await page.reload()
  })

  test('survives a reload during review, then uploads through a dropped part', async ({ page }) => {
    test.setTimeout(120_000)
    await recordPastMinimum(page)

    // The tab "crashes" before upload — the audio must still be on the device.
    await page.reload()
    const saved = page.getByTestId('voice-saved-recording')
    await expect(saved).toHaveCount(1)

    // The first attempt at part 0 loses its connection; the upload must resume and finish.
    let dropped = false
    await page.route('**/api/voice/uploads/*/parts/0', async (route) => {
      if (!dropped) {
        dropped = true
        await route.abort('connectionreset')
        return
      }
      await route.continue()
    })
    await page.getByTestId('voice-saved-send').click()
    await expect(page).toHaveURL(/\/voice\?recording=vr_/, { timeout: 30_000 })
    expect(dropped).toBe(true)
    // Confirmed by the server → the device copy is gone.
    await expect(page.getByTestId('voice-saved-recordings')).toHaveCount(0)
  })

  test('deleting a saved recording asks first', async ({ page }) => {
    test.setTimeout(90_000)
    await recordPastMinimum(page)
    await page.reload()
    await expect(page.getByTestId('voice-saved-recording')).toHaveCount(1)

    page.once('dialog', (d) => void d.dismiss())
    await page.getByTestId('voice-saved-delete').click()
    await expect(page.getByTestId('voice-saved-recording')).toHaveCount(1)

    page.once('dialog', (d) => void d.accept())
    await page.getByTestId('voice-saved-delete').click()
    await expect(page.getByTestId('voice-saved-recordings')).toHaveCount(0)
  })
})

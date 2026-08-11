/**
 * One-time interactive login to Outlook Web (OWA).
 *
 * Opens a real Chromium window with a persistent profile at OWA_PROFILE_DIR.
 * You sign in manually (including MFA). Everything the session needs — cookies,
 * local storage, refresh state — stays in that profile directory, so the
 * headless fetch script can reuse it without prompting again.
 *
 * Usage: pnpm exec tsx scripts/owa-login.ts
 */

import { chromium } from 'playwright'
import { homedir } from 'os'
import { join } from 'path'

const PROFILE_DIR = process.env.OWA_PROFILE_DIR || join(homedir(), '.ak-owa-profile')
const CALENDAR_URL = 'https://outlook.office.com/calendar/view/workweek'
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000

async function main(): Promise<void> {
  console.log(`[owa-login] profile: ${PROFILE_DIR}`)
  console.log('[owa-login] opening browser…')

  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  })

  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(CALENDAR_URL, { waitUntil: 'domcontentloaded' })

  console.log('')
  console.log('  Sign in in the browser window that just opened.')
  console.log('  Leave it alone once the calendar is visible — this script closes it for you.')
  console.log('')

  const deadline = Date.now() + LOGIN_TIMEOUT_MS
  let loggedIn = false

  while (Date.now() < deadline) {
    const url = page.url()

    if (url.includes('outlook.office.com/calendar')) {
      // The calendar grid renders its own role=grid once the session is live.
      const hasGrid = await page
        .locator('[role="grid"], [data-app-section="CalendarSurface"]')
        .first()
        .isVisible()
        .catch(() => false)

      if (hasGrid) {
        loggedIn = true
        break
      }
    }

    if (url.includes('/error') || url.includes('AADSTS')) {
      console.error(`[owa-login] blocked at: ${url}`)
      break
    }

    await page.waitForTimeout(2000)
  }

  if (loggedIn) {
    console.log('[owa-login] signed in — calendar rendered')
    console.log(`[owa-login] session stored in ${PROFILE_DIR}`)
    console.log('[owa-login] next: pnpm exec tsx scripts/owa-fetch.ts')
  } else {
    console.error('[owa-login] did not reach the calendar before the timeout')
    console.error(`[owa-login] last url: ${page.url()}`)
  }

  await context.close()
  process.exit(loggedIn ? 0 : 1)
}

main().catch((error) => {
  console.error('[owa-login] failed:', error)
  process.exit(1)
})

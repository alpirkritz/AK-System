/**
 * One-time interactive login to Microsoft Teams web.
 *
 * Opens a real Chromium window with a persistent profile at TEAMS_PROFILE_DIR. Sign in
 * manually (SSO/MFA). The session stays in that profile so the headless bridge can reuse
 * it. Read-only: the bridge never posts. After signing in, confirm the token audience with
 * a dry run of scripts/work-comms-sync.ts (WORK_BRIDGE_SOURCES=teams).
 *
 * Usage: pnpm exec tsx scripts/teams-login.ts
 */
import { chromium } from 'playwright'
import { homedir } from 'os'
import { join } from 'path'

const PROFILE_DIR = process.env.TEAMS_PROFILE_DIR || join(homedir(), '.ak-teams-profile')
const TEAMS_WEB_URL = process.env.TEAMS_WEB_URL || 'https://teams.cloud.microsoft/'
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000

async function main(): Promise<void> {
  console.log(`[teams-login] profile: ${PROFILE_DIR}`)
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(TEAMS_WEB_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })

  console.log('\n  Sign in to Teams in the window that opened.')
  console.log('  Once your chat list is visible, leave it — this script detects it and closes.\n')

  // Consider the session established once we've stayed on a Teams host (not a login/error
  // page) for a couple of consecutive checks — the app shell/selectors vary across the
  // teams.microsoft.com and teams.cloud.microsoft builds, so don't gate on a specific one.
  const deadline = Date.now() + LOGIN_TIMEOUT_MS
  let ok = false
  let settledChecks = 0
  while (Date.now() < deadline) {
    const url = page.url()
    if (url.includes('/error') || url.includes('AADSTS')) {
      console.error(`[teams-login] blocked at: ${url}`)
      break
    }
    const onTeams = url.includes('teams.') && !url.includes('login.') && !url.includes('/auth')
    settledChecks = onTeams ? settledChecks + 1 : 0
    if (settledChecks >= 3) {
      ok = true
      break
    }
    await page.waitForTimeout(2000)
  }

  if (ok) {
    console.log('[teams-login] signed in — Teams rendered')
    console.log(`[teams-login] session stored in ${PROFILE_DIR}`)
    console.log('[teams-login] next: WORK_BRIDGE_SOURCES=teams pnpm exec tsx scripts/work-comms-sync.ts')
  } else {
    console.error('[teams-login] did not reach Teams before the timeout')
    console.error(`[teams-login] last url: ${page.url()}`)
  }
  await context.close()
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error('[teams-login] failed:', err)
  process.exit(1)
})

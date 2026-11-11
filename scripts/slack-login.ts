/**
 * One-time interactive login to Slack web.
 *
 * Opens a real Chromium window with a persistent profile at SLACK_PROFILE_DIR.
 * Sign in to the Dragontail workspace manually (SSO/MFA included). The session —
 * cookies and the localConfig_v2 token blob — stays in that profile so the headless
 * bridge can reuse it. Read-only: the bridge never posts.
 *
 * Usage: pnpm exec tsx scripts/slack-login.ts
 */
import { chromium } from 'playwright'
import { homedir } from 'os'
import { join } from 'path'
import { parseSlackLocalConfig } from './slack-local-source'

const PROFILE_DIR = process.env.SLACK_PROFILE_DIR || join(homedir(), '.ak-slack-profile')
const SLACK_WEB_URL = 'https://app.slack.com/client'
const LOGIN_TIMEOUT_MS = 10 * 60 * 1000

async function main(): Promise<void> {
  console.log(`[slack-login] profile: ${PROFILE_DIR}`)
  const context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(SLACK_WEB_URL, { waitUntil: 'domcontentloaded', timeout: 60000 })

  console.log('\n  Sign in to your workspace in the window that opened.')
  console.log('  Once the channel list is visible, this script detects it and closes.\n')

  const deadline = Date.now() + LOGIN_TIMEOUT_MS
  let ok = false
  while (Date.now() < deadline) {
    // The sign-in flow navigates (SSO redirects), which can destroy the execution
    // context mid-call — treat that as "not ready yet" and poll again.
    let raw: string | null = null
    try {
      raw = await page.evaluate(() => {
        try {
          return window.localStorage.getItem('localConfig_v2')
        } catch {
          return null
        }
      })
    } catch {
      raw = null
    }
    if (parseSlackLocalConfig(raw).length > 0) {
      ok = true
      break
    }
    await page.waitForTimeout(2000)
  }

  if (ok) {
    console.log('[slack-login] signed in — token blob present')
    console.log(`[slack-login] session stored in ${PROFILE_DIR}`)
  } else {
    console.error('[slack-login] no signed-in team found before the timeout')
  }
  await context.close()
  process.exit(ok ? 0 : 1)
}

main().catch((err) => {
  console.error('[slack-login] failed:', err)
  process.exit(1)
})

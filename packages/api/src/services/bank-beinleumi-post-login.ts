/**
 * OTP-aware replacement for israeli-bank-scrapers Beinleumi-group `waitForPostLogin`.
 * The library races on post-login selectors once; Otsar often shows SMS OTP first.
 */

import { getOtpWaitMs, waitForOtp } from './bank-otp-bridge'
import { fillOtpAndSubmit, pageLooksLikeOtp } from './bank-otp-page'
import { sleep } from './bank-chrome-launch'

export type BeinleumiPostLoginOpts = {
  connectionId: string
  onAwaitingOtp?: () => Promise<void>
}

type PuppeteerPageLike = {
  waitForSelector: (
    selector: string,
    options?: { timeout?: number; visible?: boolean },
  ) => Promise<unknown>
  evaluate: <T>(fn: (...args: unknown[]) => T | Promise<T>, ...args: unknown[]) => Promise<T>
}

const POST_LOGIN_SELECTORS: Array<{ selector: string; visible: boolean }> = [
  { selector: '#card-header', visible: false },
  { selector: '#account_num', visible: true },
  { selector: '#matafLogoutLink', visible: true },
  { selector: '#validationMsg', visible: true },
]

async function racePostLoginSelectors(page: PuppeteerPageLike, timeoutMs: number): Promise<void> {
  await Promise.race(
    POST_LOGIN_SELECTORS.map(({ selector, visible }) =>
      page.waitForSelector(selector, { timeout: timeoutMs, visible }),
    ),
  )
}

/**
 * Poll for OTP or post-login dashboard until deadline.
 * Throws the same `#card-header` message the library uses when nothing matches.
 */
export async function waitForPostLoginWithOtp(
  page: PuppeteerPageLike,
  opts: BeinleumiPostLoginOpts,
): Promise<void> {
  const deadline = Date.now() + getOtpWaitMs() + 60_000

  while (Date.now() < deadline) {
    if (await pageLooksLikeOtp(page)) {
      const codePromise = waitForOtp(opts.connectionId)
      await opts.onAwaitingOtp?.()
      const code = await codePromise
      await fillOtpAndSubmit(page, code)
      await sleep(2000)
      continue
    }

    const remaining = deadline - Date.now()
    if (remaining <= 0) break

    try {
      await racePostLoginSelectors(page, Math.min(8000, remaining))
      return
    } catch {
      await sleep(1500)
    }
  }

  throw new Error('Waiting for selector `#card-header` failed')
}

type BeinleumiModule = {
  waitForPostLogin: (page: PuppeteerPageLike) => Promise<void>
  __akPatchedPostLogin?: boolean
}

function nodeRequire(): NodeRequire {
  // eslint-disable-next-line no-eval
  return eval('require') as NodeRequire
}

/**
 * Monkey-patch packaged `waitForPostLogin` for Otsar / Beinleumi group scrapers.
 * Returns restore function (call in finally).
 */
export function patchBeinleumiWaitForPostLogin(opts: BeinleumiPostLoginOpts): () => void {
  try {
    const req = nodeRequire()
    const mod = req(
      req.resolve('israeli-bank-scrapers/lib/scrapers/base-beinleumi-group.js'),
    ) as BeinleumiModule
    const original = mod.waitForPostLogin.bind(mod)
    mod.waitForPostLogin = async (page) => waitForPostLoginWithOtp(page, opts)
    mod.__akPatchedPostLogin = true
    return () => {
      mod.waitForPostLogin = original
      delete mod.__akPatchedPostLogin
    }
  } catch {
    return () => {}
  }
}

/** Providers that use base-beinleumi-group post-login flow. */
export function usesBeinleumiPostLogin(provider: string): boolean {
  return provider === 'otsarHahayal'
}

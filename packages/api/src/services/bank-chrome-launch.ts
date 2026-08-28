import { readdirSync, readFileSync } from 'fs'

/**
 * Chromium flags for Docker on a 1 GB EC2 box (root, tiny /dev/shm, tight nproc).
 * Harmless on macOS local runs — always pass them.
 */
export const CHROMIUM_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--disable-blink-features=AutomationControlled',
  '--no-zygote',
  '--disable-extensions',
  '--disable-background-networking',
  '--renderer-process-limit=1',
] as const

export const BROWSER_LAUNCH_HEBREW_ERROR =
  'לא הצלחנו לפתוח דפדפן לסנכרון הבנק (השרת עמוס או חסר זיכרון). נסה שוב בעוד כמה שניות.'

export const BROWSER_PROFILE_LOCK_HEBREW_ERROR =
  'פרופיל הדפדפן היה נעול אחרי סנכרון קודם. נסה לסנכרן שוב.'

export const POST_LOGIN_TIMEOUT_HEBREW_ERROR =
  'ההתחברות לבנק לא הושלמה — ייתכן שנדרש קוד SMS מהבנק. נסה לסנכרן שוב; אם מופיע "ממתין לקוד אימות", הזן את הקוד שקיבלת.'

export const OTP_TIMEOUT_HEBREW_ERROR = 'לא הוזן קוד אימות בזמן — נסה לסנכרן שוב'

const BROWSER_LAUNCH_ATTEMPTS = 3

export function isChromeProfileLockFailure(message: string): boolean {
  return /profile appears to be in use|Code:\s*21/i.test(message)
}

export function isBrowserLaunchFailure(message: string): boolean {
  return (
    isChromeProfileLockFailure(message) ||
    /Failed to launch the browser|EAGAIN|spawn .*(chrome|chromium)/i.test(message)
  )
}

export function isPostLoginSelectorTimeout(message: string): boolean {
  return /Waiting for selector `#?(card-header|account_num|continueBtn|matafLogoutLink)/i.test(
    message,
  )
}

export function isOtpTimeoutError(message: string): boolean {
  return /לא הוזן קוד אימות בזמן/i.test(message)
}

export function humanizeScrapeError(message: string): string {
  if (isChromeProfileLockFailure(message)) return BROWSER_PROFILE_LOCK_HEBREW_ERROR
  if (isBrowserLaunchFailure(message)) return BROWSER_LAUNCH_HEBREW_ERROR
  if (isOtpTimeoutError(message)) return OTP_TIMEOUT_HEBREW_ERROR
  if (isPostLoginSelectorTimeout(message)) return POST_LOGIN_TIMEOUT_HEBREW_ERROR
  return message
}

/** Kill leftover Puppeteer Chrome processes (Linux only). No-op on macOS/tests. */
export function killStrayPuppeteerChrome(): void {
  if (process.platform !== 'linux') return
  let pids: string[]
  try {
    pids = readdirSync('/proc')
  } catch {
    return
  }
  for (const pid of pids) {
    if (!/^\d+$/.test(pid) || pid === String(process.pid)) continue
    let cmdline = ''
    try {
      cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8')
    } catch {
      continue
    }
    if (!cmdline.includes('puppeteer/chrome')) continue
    try {
      process.kill(Number(pid), 'SIGKILL')
    } catch {
      // already gone
    }
  }
}

let scrapeChain: Promise<void> = Promise.resolve()

/** One Chromium at a time (including OTP wait). Overlapping syncs queue. */
export async function withScrapeLock<T>(fn: () => Promise<T>): Promise<T> {
  const prev = scrapeChain
  let release!: () => void
  scrapeChain = new Promise<void>((resolve) => {
    release = resolve
  })
  await prev
  try {
    return await fn()
  } finally {
    release()
  }
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}

export async function scrapeWithBrowserLaunchRetry<T>(
  run: () => Promise<T>,
  isFailure: (result: T) => boolean,
  opts?: { attempts?: number; sleepMs?: number; kill?: () => void },
): Promise<T> {
  const attempts = opts?.attempts ?? BROWSER_LAUNCH_ATTEMPTS
  const sleepMs = opts?.sleepMs ?? 1500
  const kill = opts?.kill ?? killStrayPuppeteerChrome
  let last!: T
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (attempt > 1) kill()
    try {
      last = await run()
      if (!isFailure(last) || attempt === attempts) return last
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!isBrowserLaunchFailure(msg) || attempt === attempts) throw err
    }
    await sleep(sleepMs * attempt)
  }
  return last
}

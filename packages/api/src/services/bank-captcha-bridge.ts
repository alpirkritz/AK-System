/**
 * In-process handoff for a Radware / hCaptcha page during a bank scrape.
 * Clicks are forwarded only while the bank login form is not on screen,
 * and only from the signed-in user.
 */

export const CAPTCHA_TIMEOUT_HEBREW =
  'אימות האבטחה לא הושלם בזמן. נסה לסנכרן שוב ופתור את החלון שנפתח.'

export type BotCheckSignals = {
  title: string
  url: string
  text: string
  hasLoginForm: boolean
}

export type CaptchaFrame = {
  image: string
  width: number
  height: number
}

export type CaptchaPage = {
  evaluate: <T>(fn: (...args: unknown[]) => T | Promise<T>, ...args: unknown[]) => Promise<T>
  screenshot?: (options: {
    type: 'jpeg'
    quality?: number
    encoding: 'base64'
  }) => Promise<string | Uint8Array>
  mouse?: {
    move: (x: number, y: number) => Promise<void>
    click: (x: number, y: number) => Promise<void>
  }
  viewport?: () => { width: number; height: number } | null
  on?: (event: string, handler: (...args: unknown[]) => void) => void
}

type Session = {
  page: CaptchaPage
  active: boolean
  shown: boolean
  cleared: boolean
  /** After the password submit, keep the page visible so a missed click can be retried. */
  handoff: boolean
  timer: ReturnType<typeof setInterval>
  onAwaitingCaptcha?: () => Promise<void>
  onCaptchaCleared?: () => Promise<void>
}

const sessions = new Map<string, Session>()
/** Survives session teardown so the scrape error can mention the check the user saw. */
const captchaShown = new Set<string>()

/** True when this document is a bot-manager interstitial rather than the bank login form. */
export function pageLooksLikeBotCheck(signals: BotCheckSignals): boolean {
  if (signals.hasLoginForm) return false
  const head = `${signals.title}\n${signals.url}`
  if (/radware|perfdrive|hcaptcha/i.test(head)) return true
  return /פעילות אוטומטית/.test(signals.text)
}

/** Pre-login: only a bot check. After submit: the bank page, including a login form the click missed. */
export function shouldRelayPage(signals: BotCheckSignals, handoff: boolean): boolean {
  if (handoff) return true
  return pageLooksLikeBotCheck(signals)
}

export function clampToViewport(
  x: number,
  y: number,
  width: number,
  height: number,
): { x: number; y: number } | null {
  if (!Number.isFinite(x) || !Number.isFinite(y) || width < 1 || height < 1) return null
  return {
    x: Math.min(width - 1, Math.max(0, x)),
    y: Math.min(height - 1, Math.max(0, y)),
  }
}

export function captchaWasShown(connectionId: string): boolean {
  return captchaShown.has(connectionId) || sessions.get(connectionId)?.shown === true
}

/** Read and clear the "user was shown a check" flag. */
export function consumeCaptchaShown(connectionId: string): boolean {
  const shown = captchaWasShown(connectionId)
  captchaShown.delete(connectionId)
  return shown
}

export function finishCaptchaSession(connectionId: string): void {
  const existing = sessions.get(connectionId)
  if (!existing) return
  if (existing.shown) captchaShown.add(connectionId)
  clearInterval(existing.timer)
  sessions.delete(connectionId)
}

async function readSignals(page: CaptchaPage): Promise<BotCheckSignals | null> {
  try {
    return await page.evaluate(() => {
      const body = document.body?.innerText || ''
      return {
        title: document.title || '',
        url: location.href || '',
        text: body.slice(0, 800),
        hasLoginForm: !!document.querySelector('#username, #password, #userCode, #continueBtn'),
      }
    })
  } catch {
    return null
  }
}

async function tick(connectionId: string): Promise<void> {
  const session = sessions.get(connectionId)
  if (!session) return
  const signals = await readSignals(session.page)
  if (!signals) return

  if (session.handoff) {
    session.active = true
    if (!session.shown) {
      session.shown = true
      try {
        await session.onAwaitingCaptcha?.()
      } catch {
        // the panel can still poll once the flag is set
      }
    }
    return
  }

  if (signals.hasLoginForm) {
    session.active = false
    if (session.shown && !session.cleared) {
      session.cleared = true
      try {
        await session.onCaptchaCleared?.()
      } catch {
        // status update is best-effort; scrape continues
      }
    }
    return
  }

  if (session.shown || !pageLooksLikeBotCheck(signals)) return
  session.shown = true
  session.active = true
  try {
    await session.onAwaitingCaptcha?.()
  } catch {
    // the panel can still poll once the flag is set
  }
}

export function startCaptchaWatch(opts: {
  connectionId: string
  page: CaptchaPage
  onAwaitingCaptcha?: () => Promise<void>
  onCaptchaCleared?: () => Promise<void>
}): void {
  finishCaptchaSession(opts.connectionId)
  const timer = setInterval(() => {
    void tick(opts.connectionId)
  }, 1000)
  const session: Session = {
    page: opts.page,
    active: false,
    shown: false,
    cleared: false,
    handoff: false,
    timer,
    onAwaitingCaptcha: opts.onAwaitingCaptcha,
    onCaptchaCleared: opts.onCaptchaCleared,
  }
  sessions.set(opts.connectionId, session)
  opts.page.on?.('close', () => finishCaptchaSession(opts.connectionId))
  void tick(opts.connectionId)
}

/** Open the bank page in the panel after the password click, even if the form is still there. */
export async function beginPageHandoff(connectionId: string): Promise<void> {
  const session = sessions.get(connectionId)
  if (!session) return
  session.handoff = true
  session.active = true
  if (session.shown) return
  session.shown = true
  try {
    await session.onAwaitingCaptcha?.()
  } catch {
    // the panel can still poll once the flag is set
  }
}

async function hidePasswordValues(page: CaptchaPage): Promise<void> {
  try {
    await page.evaluate(() => {
      document.querySelectorAll('input[type="password"]').forEach((node) => {
        const input = node as HTMLInputElement
        input.setAttribute('data-ak-pw', input.value)
        input.value = ''
      })
    })
  } catch {
    // navigation can detach the document between polls
  }
}

async function restorePasswordValues(page: CaptchaPage): Promise<void> {
  try {
    await page.evaluate(() => {
      document.querySelectorAll('input[type="password"]').forEach((node) => {
        const input = node as HTMLInputElement
        const prev = input.getAttribute('data-ak-pw')
        if (prev != null) input.value = prev
        input.removeAttribute('data-ak-pw')
      })
    })
  } catch {
    // navigation can detach the document between polls
  }
}

export async function readCaptchaFrame(connectionId: string): Promise<CaptchaFrame | null> {
  const session = sessions.get(connectionId)
  if (!session?.active || !session.page.screenshot) return null
  const signals = await readSignals(session.page)
  if (!signals || !shouldRelayPage(signals, session.handoff)) {
    if (signals?.hasLoginForm && !session.handoff) session.active = false
    return null
  }
  await hidePasswordValues(session.page)
  try {
    const vp = session.page.viewport?.() ?? { width: 1024, height: 768 }
    const shot = await session.page.screenshot({ type: 'jpeg', quality: 50, encoding: 'base64' })
    const image = typeof shot === 'string' ? shot : Buffer.from(shot).toString('base64')
    return { image, width: vp.width, height: vp.height }
  } catch {
    return null
  } finally {
    await restorePasswordValues(session.page)
  }
}

export async function relayCaptchaClick(
  connectionId: string,
  x: number,
  y: number,
): Promise<boolean> {
  const session = sessions.get(connectionId)
  if (!session?.active || !session.page.mouse) return false
  const signals = await readSignals(session.page)
  if (!signals || !shouldRelayPage(signals, session.handoff)) {
    if (signals?.hasLoginForm && !session.handoff) session.active = false
    return false
  }
  const vp = session.page.viewport?.() ?? { width: 1024, height: 768 }
  const point = clampToViewport(x, y, vp.width, vp.height)
  if (!point) return false
  try {
    await session.page.mouse.move(point.x, point.y)
    await session.page.mouse.click(point.x, point.y)
    return true
  } catch {
    return false
  }
}

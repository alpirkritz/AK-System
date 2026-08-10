/**
 * Heuristics to detect / fill bank OTP screens (Hapoalim and similar Hebrew UIs).
 * Runs inside Puppeteer page.evaluate — keep logic self-contained (no closures).
 */

export type OtpPageLike = {
  evaluate: <T>(fn: (...args: unknown[]) => T | Promise<T>, ...args: unknown[]) => Promise<T>
}

/** Pure helper for tests: Hapoalim device-trust modal copy. */
export function bodyLooksLikeHapoalimOtpModal(bodyText: string): boolean {
  return /כניסה חדשה ממחשב|קוד האימות|מחשב חדש/.test(bodyText) && /SMS|קוד/.test(bodyText)
}

/** True when the page looks like an OTP challenge. */
export async function pageLooksLikeOtp(page: OtpPageLike): Promise<boolean> {
  return page.evaluate(() => {
    const body = document.body?.innerText || ''
    // Hapoalim: OTP modal overlays the login form (#userCode/#password stay in DOM).
    if (
      /כניסה חדשה ממחשב|קוד האימות|מחשב חדש/.test(body) &&
      /SMS|קוד/.test(body)
    ) {
      return true
    }

    const hasPasswordLogin = !!document.querySelector(
      '#password, #userCode, input[name="password"], input[type="password"]',
    )
    if (hasPasswordLogin) return false

    const placeholders = ['קוד חד פעמי', 'קוד SMS', 'קוד אימות', 'הזן קוד', 'סיסמה חד פעמית']
    const inputs = Array.from(document.querySelectorAll('input')).filter((el) => {
      const input = el as HTMLInputElement
      return input.type !== 'hidden' && input.type !== 'submit' && !input.disabled
    }) as HTMLInputElement[]

    for (const input of inputs) {
      const ph = (input.placeholder || '').trim()
      const aria = (input.getAttribute('aria-label') || '').trim()
      const name = (input.name || '').toLowerCase()
      const id = (input.id || '').toLowerCase()
      if (placeholders.some((p) => ph.includes(p) || aria.includes(p))) return true
      if (name.includes('otp') || id.includes('otp') || id === 'code' || id === 'codeinput') {
        return true
      }
    }

    const otpCopy = /קוד אימות|קוד חד פעמי|קוד שנשלח|סיסמה חד פעמית|קוד SMS/
    if (!otpCopy.test(body)) return false

    return inputs.some(
      (i) =>
        i.type === 'tel' ||
        i.type === 'text' ||
        i.type === 'number' ||
        i.inputMode === 'numeric' ||
        (i.maxLength > 0 && i.maxLength <= 8),
    )
  })
}

/** Type the OTP and click confirm/continue. Returns false if no input found. */
export async function fillOtpAndSubmit(page: OtpPageLike, code: string): Promise<boolean> {
  return page.evaluate((otpCode: unknown) => {
    const code = String(otpCode).replace(/\s+/g, '')
    if (!code) return false

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    const setVal = (input: HTMLInputElement, value: string) => {
      if (setter) setter.call(input, value)
      else input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
      input.dispatchEvent(new KeyboardEvent('keyup', { key: value.slice(-1) || value, bubbles: true }))
    }

    const clickContinue = (): boolean => {
      const buttons = Array.from(
        document.querySelectorAll('button, a[role="button"], input[type="submit"]'),
      ) as HTMLElement[]
      // Prefer המשך / אישור — never the main login "כניסה" while OTP modal is open.
      const preferred = ['המשך', 'אישור', 'אשר', 'שלח קוד', 'אימות']
      for (const label of preferred) {
        const btn = buttons.find((b) => {
          const text = (b.textContent || (b as HTMLInputElement).value || '').trim()
          return text === label || text.includes(label)
        })
        if (btn) {
          btn.click()
          return true
        }
      }
      return false
    }

    const allInputs = Array.from(document.querySelectorAll('input')).filter((el) => {
      const input = el as HTMLInputElement
      return input.type !== 'hidden' && input.type !== 'submit' && !input.disabled
    }) as HTMLInputElement[]

    const nonLogin = allInputs.filter(
      (i) =>
        i.id !== 'userCode' &&
        i.id !== 'password' &&
        !i.className.includes('user-code') &&
        !i.className.includes('password'),
    )

    // Hapoalim: five single-digit boxes (often maxlength=1, empty id).
    const digitBoxes = nonLogin.filter((i) => {
      const max = i.maxLength
      return max === 1 || i.getAttribute('maxlength') === '1'
    })
    if (digitBoxes.length >= Math.min(code.length, 4)) {
      const boxes = digitBoxes.slice(0, code.length)
      boxes.forEach((input, idx) => setVal(input, code[idx] ?? ''))
      return clickContinue()
    }

    // Fallback: N empty-id text inputs excluding login (Hapoalim sometimes omits maxlength).
    const anonText = nonLogin.filter(
      (i) =>
        (i.type === 'text' || i.type === 'tel' || i.type === 'number') &&
        !i.id &&
        !i.name,
    )
    if (anonText.length >= code.length && code.length >= 4 && code.length <= 8) {
      anonText.slice(0, code.length).forEach((input, idx) => setVal(input, code[idx] ?? ''))
      return clickContinue()
    }

    const placeholders = ['קוד חד פעמי', 'קוד SMS', 'קוד אימות', 'הזן קוד', 'סיסמה חד פעמית']
    let target: HTMLInputElement | null = null
    for (const input of nonLogin) {
      const ph = (input.placeholder || '').trim()
      const aria = (input.getAttribute('aria-label') || '').trim()
      const name = (input.name || '').toLowerCase()
      const id = (input.id || '').toLowerCase()
      if (placeholders.some((p) => ph.includes(p) || aria.includes(p))) {
        target = input
        break
      }
      if (name.includes('otp') || id.includes('otp') || id === 'code' || id === 'codeinput') {
        target = input
        break
      }
    }
    if (!target) {
      target =
        nonLogin.find(
          (i) =>
            i.type === 'tel' ||
            i.inputMode === 'numeric' ||
            (i.maxLength > 1 && i.maxLength <= 8),
        ) ?? null
    }
    if (!target) return false

    setVal(target, code)
    if (clickContinue()) return true

    const form = target.closest('form')
    if (form) {
      form.requestSubmit?.()
      return true
    }
    target.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    return true
  }, code)
}

import { describe, expect, it } from 'vitest'
import {
  clampToViewport,
  pageLooksLikeBotCheck,
  readCaptchaFrame,
  relayCaptchaClick,
  shouldRelayPage,
} from './bank-captcha-bridge'

describe('pageLooksLikeBotCheck', () => {
  it('detects the Radware interstitial and ignores the bank login form', () => {
    expect(
      pageLooksLikeBotCheck({
        title: 'Radware Bot Manager Captcha',
        url: 'https://validate.perfdrive.com/check',
        text: 'הפעילות בדף זה נראית לנו כפעילות אוטומטית',
        hasLoginForm: false,
      }),
    ).toBe(true)
    expect(
      pageLooksLikeBotCheck({
        title: 'loginPage',
        url: 'https://online.bankotsar.co.il/MatafLoginService/MatafLoginServlet',
        text: 'כניסה עם סיסמה',
        hasLoginForm: true,
      }),
    ).toBe(false)
  })
})

describe('shouldRelayPage', () => {
  const login = {
    title: 'loginPage',
    url: 'https://online.bankotsar.co.il/MatafLoginService/MatafLoginServlet',
    text: 'כניסה עם סיסמה',
    hasLoginForm: true,
  }

  it('hides the login form until the post-submit handoff starts', () => {
    expect(shouldRelayPage(login, false)).toBe(false)
    expect(shouldRelayPage(login, true)).toBe(true)
  })
})

describe('clampToViewport', () => {
  it('keeps clicks inside the screenshot', () => {
    expect(clampToViewport(-4, 20, 100, 80)).toEqual({ x: 0, y: 20 })
    expect(clampToViewport(140, 90, 100, 80)).toEqual({ x: 99, y: 79 })
    expect(clampToViewport(Number.NaN, 1, 100, 80)).toBeNull()
  })
})

describe('captcha relay without a session', () => {
  it('returns no frame and does not report a click', async () => {
    expect(await readCaptchaFrame('missing')).toBeNull()
    expect(await relayCaptchaClick('missing', 10, 10)).toBe(false)
  })
})

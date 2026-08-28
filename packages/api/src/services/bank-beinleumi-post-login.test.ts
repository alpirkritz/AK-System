import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { bodyLooksLikeFibiOtpStep, bodyLooksLikeHapoalimOtpModal } from './bank-otp-page'
import {
  POST_LOGIN_TIMEOUT_HEBREW_ERROR,
  humanizeScrapeError,
  isPostLoginSelectorTimeout,
} from './bank-chrome-launch'
import { usesBeinleumiPostLogin, waitForPostLoginWithOtp } from './bank-beinleumi-post-login'

vi.mock('./bank-otp-bridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./bank-otp-bridge')>()
  return { ...actual, getOtpWaitMs: () => 500 }
})

describe('bank-otp-page Fibi heuristics', () => {
  it('detects Fibi SMS copy', () => {
    expect(bodyLooksLikeFibiOtpStep('הזן את הקוד שנשלח לטלפון הנייד')).toBe(true)
    expect(bodyLooksLikeFibiOtpStep('שם משתמש\nסיסמה\nכניסה')).toBe(false)
  })

  it('keeps Hapoalim modal detection separate', () => {
    expect(
      bodyLooksLikeHapoalimOtpModal('כניסה חדשה ממחשב — הזן את קוד האימות מ-SMS'),
    ).toBe(true)
  })
})

describe('humanizeScrapeError post-login', () => {
  it('maps card-header timeout to Hebrew OTP hint', () => {
    const raw = 'Waiting for selector `#card-header` failed'
    expect(isPostLoginSelectorTimeout(raw)).toBe(true)
    expect(humanizeScrapeError(raw)).toBe(POST_LOGIN_TIMEOUT_HEBREW_ERROR)
  })
})

describe('usesBeinleumiPostLogin', () => {
  it('includes otsar only', () => {
    expect(usesBeinleumiPostLogin('otsarHahayal')).toBe(true)
    expect(usesBeinleumiPostLogin('hapoalim')).toBe(false)
    expect(usesBeinleumiPostLogin('visaCal')).toBe(false)
  })
})

describe('waitForPostLoginWithOtp', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('resolves when a post-login selector appears', async () => {
    const page = {
      waitForSelector: vi.fn().mockResolvedValue({}),
      evaluate: vi.fn(),
    }
    const p = waitForPostLoginWithOtp(page, { connectionId: 'bc-test' })
    await vi.runAllTimersAsync()
    await expect(p).resolves.toBeUndefined()
  })

  it('throws card-header error when deadline passes', async () => {
    const page = {
      waitForSelector: vi.fn().mockRejectedValue(new Error('timeout')),
      evaluate: vi.fn().mockResolvedValue(false),
    }
    const p = waitForPostLoginWithOtp(page, { connectionId: 'bc-fail' })
    await expect(Promise.all([p, vi.runAllTimersAsync()])).rejects.toThrow(
      'Waiting for selector `#card-header` failed',
    )
  })
})

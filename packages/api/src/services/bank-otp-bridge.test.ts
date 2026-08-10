import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  cancelOtpWait,
  hasPendingOtp,
  submitOtpCode,
  waitForOtp,
} from './bank-otp-bridge'
import {
  ensureBrowserProfileDir,
  resolveBrowserProfileRoot,
  sanitizeConnectionIdForPath,
} from './bank-browser-profile'
import { bodyLooksLikeHapoalimOtpModal } from './bank-otp-page'

describe('bank-otp-bridge', () => {
  afterEach(() => {
    cancelOtpWait('c1')
    cancelOtpWait('c2')
  })

  it('submitOtpCode resolves waitForOtp', async () => {
    const pending = waitForOtp('c1', 5_000)
    expect(hasPendingOtp('c1')).toBe(true)
    expect(submitOtpCode('c1', ' 123456 ')).toBe(true)
    await expect(pending).resolves.toBe('123456')
    expect(hasPendingOtp('c1')).toBe(false)
  })

  it('submitOtpCode returns false when nothing waiting', () => {
    expect(submitOtpCode('missing', '1111')).toBe(false)
  })

  it('cancelOtpWait rejects the pending promise', async () => {
    const pending = waitForOtp('c2', 5_000)
    cancelOtpWait('c2', 'בוטל')
    await expect(pending).rejects.toThrow('בוטל')
    expect(hasPendingOtp('c2')).toBe(false)
  })
})

describe('bank-browser-profile', () => {
  let prevRoot: string | undefined
  let prevDb: string | undefined
  let tmp: string

  beforeEach(() => {
    prevRoot = process.env.BANK_BROWSER_PROFILE_ROOT
    prevDb = process.env.DATABASE_PATH
    tmp = mkdtempSync(join(tmpdir(), 'bank-profile-'))
  })

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.BANK_BROWSER_PROFILE_ROOT
    else process.env.BANK_BROWSER_PROFILE_ROOT = prevRoot
    if (prevDb === undefined) delete process.env.DATABASE_PATH
    else process.env.DATABASE_PATH = prevDb
    rmSync(tmp, { recursive: true, force: true })
  })

  it('sanitizeConnectionIdForPath strips unsafe chars', () => {
    expect(sanitizeConnectionIdForPath('bc-abc/../x')).toBe('bc-abc____x')
  })

  it('resolveBrowserProfileRoot prefers BANK_BROWSER_PROFILE_ROOT', () => {
    process.env.BANK_BROWSER_PROFILE_ROOT = join(tmp, 'custom')
    expect(resolveBrowserProfileRoot()).toBe(join(tmp, 'custom'))
  })

  it('ensureBrowserProfileDir creates per-connection folder', () => {
    process.env.BANK_BROWSER_PROFILE_ROOT = join(tmp, 'profiles')
    const dir = ensureBrowserProfileDir('bc-test1')
    expect(dir).toBe(join(tmp, 'profiles', 'bc-test1'))
  })
})

describe('bank-otp-page heuristics', () => {
  it('detects Hapoalim device-trust OTP modal copy', () => {
    expect(
      bodyLooksLikeHapoalimOtpModal(
        'כניסה חדשה ממחשב זה\nזיהינו ניסיון להיכנס\nקוד האימות\nSMS לטלפון',
      ),
    ).toBe(true)
    expect(bodyLooksLikeHapoalimOtpModal('קוד משתמש\nסיסמה\nכניסה')).toBe(false)
  })
})

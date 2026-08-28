import { describe, it, expect } from 'vitest'
import {
  BROWSER_LAUNCH_HEBREW_ERROR,
  BROWSER_PROFILE_LOCK_HEBREW_ERROR,
  CHROMIUM_LAUNCH_ARGS,
  humanizeScrapeError,
  isBrowserLaunchFailure,
  isChromeProfileLockFailure,
  killStrayPuppeteerChrome,
  scrapeWithBrowserLaunchRetry,
  withScrapeLock,
} from './bank-chrome-launch'

describe('bank-chrome-launch', () => {
  it('includes Docker-safe and low-process Chromium flags', () => {
    expect(CHROMIUM_LAUNCH_ARGS).toContain('--no-sandbox')
    expect(CHROMIUM_LAUNCH_ARGS).toContain('--disable-setuid-sandbox')
    expect(CHROMIUM_LAUNCH_ARGS).toContain('--disable-dev-shm-usage')
    expect(CHROMIUM_LAUNCH_ARGS).toContain('--no-zygote')
    expect(CHROMIUM_LAUNCH_ARGS).toContain('--renderer-process-limit=1')
  })

  it('detects Puppeteer spawn EAGAIN as a browser launch failure', () => {
    expect(
      isBrowserLaunchFailure(
        'Failed to launch the browser process: spawn /root/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome EAGAIN',
      ),
    ).toBe(true)
    expect(isBrowserLaunchFailure('הסיסמה שגויה')).toBe(false)
    expect(isBrowserLaunchFailure('TIMEOUT')).toBe(false)
  })

  it('humanizes launch failures and leaves bank-side errors alone', () => {
    expect(humanizeScrapeError('Failed to launch the browser process: spawn chrome EAGAIN')).toBe(
      BROWSER_LAUNCH_HEBREW_ERROR,
    )
    expect(humanizeScrapeError('הסיסמה שגויה')).toBe('הסיסמה שגויה')
  })

  it('humanizes stale Chrome profile locks separately from memory errors', () => {
    const msg =
      'Failed to launch the browser process:  Code: 21\nThe profile appears to be in use by another Chromium process'
    expect(isChromeProfileLockFailure(msg)).toBe(true)
    expect(isBrowserLaunchFailure(msg)).toBe(true)
    expect(humanizeScrapeError(msg)).toBe(BROWSER_PROFILE_LOCK_HEBREW_ERROR)
  })

  it('humanizes post-login selector timeout to Hebrew OTP hint', () => {
    expect(humanizeScrapeError('Waiting for selector `#card-header` failed')).toBe(
      'ההתחברות לבנק לא הושלמה — ייתכן שנדרש קוד SMS מהבנק. נסה לסנכרן שוב; אם מופיע "ממתין לקוד אימות", הזן את הקוד שקיבלת.',
    )
  })

  it('killStrayPuppeteerChrome is a no-op on non-linux', () => {
    expect(() => killStrayPuppeteerChrome()).not.toThrow()
  })

  it('retries thrown EAGAIN then succeeds', async () => {
    let attempts = 0
    const kills: number[] = []
    const result = await scrapeWithBrowserLaunchRetry(
      async () => {
        attempts++
        if (attempts < 3) {
          throw new Error(
            'Failed to launch the browser process: spawn /root/.cache/puppeteer/chrome/chrome EAGAIN',
          )
        }
        return { success: true, accounts: [] }
      },
      (outcome) => isBrowserLaunchFailure(outcome.errorMessage ?? ''),
      { attempts: 3, sleepMs: 1, kill: () => kills.push(1) },
    )
    expect(attempts).toBe(3)
    expect(kills).toHaveLength(2)
    expect(result.success).toBe(true)
  })

  it('retries failed launch outcomes then succeeds', async () => {
    let attempts = 0
    const result = await scrapeWithBrowserLaunchRetry(
      async () => {
        attempts++
        if (attempts === 1) {
          return {
            success: false,
            errorMessage: 'Failed to launch the browser process: spawn chrome EAGAIN',
          }
        }
        return { success: true, accounts: [] }
      },
      (outcome) => isBrowserLaunchFailure(outcome.errorMessage ?? ''),
      { attempts: 3, sleepMs: 1, kill: () => {} },
    )
    expect(attempts).toBe(2)
    expect(result.success).toBe(true)
  })

  it('does not retry non-launch errors', async () => {
    let attempts = 0
    await expect(
      scrapeWithBrowserLaunchRetry(
        async () => {
          attempts++
          throw new Error('INVALID_PASSWORD')
        },
        () => false,
        { attempts: 3, sleepMs: 1, kill: () => {} },
      ),
    ).rejects.toThrow('INVALID_PASSWORD')
    expect(attempts).toBe(1)
  })

  it('withScrapeLock serializes overlapping work', async () => {
    let inFlight = 0
    let maxInFlight = 0
    const task = async () => {
      return withScrapeLock(async () => {
        inFlight++
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((r) => setTimeout(r, 20))
        inFlight--
      })
    }
    await Promise.all([task(), task(), task()])
    expect(maxInFlight).toBe(1)
  })
})

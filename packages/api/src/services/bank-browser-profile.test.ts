import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { clearChromeProfileLocks, ensureBrowserProfileDir } from './bank-browser-profile'

describe('clearChromeProfileLocks', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bank-profile-'))
    for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
      writeFileSync(join(dir, name), 'stale')
    }
    writeFileSync(join(dir, 'Preferences'), '{}')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('removes Singleton lock files and keeps the rest of the profile', () => {
    clearChromeProfileLocks(dir)
    expect(existsSync(join(dir, 'SingletonLock'))).toBe(false)
    expect(existsSync(join(dir, 'SingletonCookie'))).toBe(false)
    expect(existsSync(join(dir, 'SingletonSocket'))).toBe(false)
    expect(existsSync(join(dir, 'Preferences'))).toBe(true)
  })

  it('does not throw when lock files are already gone', () => {
    clearChromeProfileLocks(dir)
    expect(() => clearChromeProfileLocks(dir)).not.toThrow()
  })
})

describe('ensureBrowserProfileDir', () => {
  const prevRoot = process.env.BANK_BROWSER_PROFILE_ROOT
  let root: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'bank-root-'))
    process.env.BANK_BROWSER_PROFILE_ROOT = root
  })

  afterEach(() => {
    if (prevRoot === undefined) delete process.env.BANK_BROWSER_PROFILE_ROOT
    else process.env.BANK_BROWSER_PROFILE_ROOT = prevRoot
    rmSync(root, { recursive: true, force: true })
  })

  it('clears stale Singleton locks when preparing a profile dir', () => {
    const dir = ensureBrowserProfileDir('bc-test-1')
    writeFileSync(join(dir, 'SingletonLock'), 'stale')
    const again = ensureBrowserProfileDir('bc-test-1')
    expect(again).toBe(dir)
    expect(existsSync(join(dir, 'SingletonLock'))).toBe(false)
  })
})

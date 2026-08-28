import { mkdirSync, unlinkSync } from 'fs'
import { dirname, join, resolve } from 'path'

/** Safe folder name from connection id (alphanumeric + hyphen/underscore). */
export function sanitizeConnectionIdForPath(connectionId: string): string {
  const cleaned = connectionId.replace(/[^a-zA-Z0-9_-]/g, '_')
  if (!cleaned) throw new Error('Invalid connection id for browser profile')
  return cleaned
}

/**
 * Root for Chromium profiles. Prefer BANK_BROWSER_PROFILE_ROOT;
 * else sibling of DATABASE_PATH; else apps/web/data/bank-browser-profiles.
 */
export function resolveBrowserProfileRoot(): string {
  if (process.env.BANK_BROWSER_PROFILE_ROOT?.trim()) {
    return resolve(process.env.BANK_BROWSER_PROFILE_ROOT.trim())
  }
  if (process.env.DATABASE_PATH?.trim()) {
    return join(dirname(resolve(process.env.DATABASE_PATH.trim())), 'bank-browser-profiles')
  }
  return resolve(process.cwd(), 'apps/web/data/bank-browser-profiles')
}

/**
 * Stale Singleton* files left after OOM/reboot make Chrome exit code 21
 * ("profile appears to be in use by another Chromium process").
 */
export function clearChromeProfileLocks(profileDir: string): void {
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket'] as const) {
    try {
      unlinkSync(join(profileDir, name))
    } catch {
      // missing is fine
    }
  }
}

/** Absolute path for one connection's Chromium user-data-dir (created if missing). */
export function ensureBrowserProfileDir(connectionId: string): string {
  const dir = join(resolveBrowserProfileRoot(), sanitizeConnectionIdForPath(connectionId))
  mkdirSync(dir, { recursive: true })
  clearChromeProfileLocks(dir)
  return dir
}

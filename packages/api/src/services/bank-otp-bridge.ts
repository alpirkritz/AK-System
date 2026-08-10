/**
 * In-process OTP waiters for bank scrapes running in this Node process.
 * submitOtp (tRPC) resolves the Promise that preparePage is awaiting.
 */

const OTP_WAIT_MS = 180_000

type Waiter = {
  promise: Promise<string>
  resolve: (code: string) => void
  reject: (err: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const waiters = new Map<string, Waiter>()

export function getOtpWaitMs(): number {
  return OTP_WAIT_MS
}

export function hasPendingOtp(connectionId: string): boolean {
  return waiters.has(connectionId)
}

/** Cancel any in-flight wait (e.g. scrape ended). Safe if none. */
export function cancelOtpWait(connectionId: string, reason = 'סנכרון הסתיים לפני הזנת קוד'): void {
  const existing = waiters.get(connectionId)
  if (!existing) return
  clearTimeout(existing.timer)
  waiters.delete(connectionId)
  // Mark handled so replace/cancel does not surface as unhandledRejection.
  void existing.promise.catch(() => {})
  existing.reject(new Error(reason))
}

/**
 * Blocks until submitOtp(connectionId, code) or timeout.
 * Replaces any previous waiter for the same connection.
 */
export function waitForOtp(connectionId: string, timeoutMs = OTP_WAIT_MS): Promise<string> {
  cancelOtpWait(connectionId, 'החלפת המתנה לקוד אימות')
  let resolve!: (code: string) => void
  let reject!: (err: Error) => void
  const promise = new Promise<string>((res, rej) => {
    resolve = res
    reject = rej
  })
  const timer = setTimeout(() => {
    waiters.delete(connectionId)
    reject(new Error('לא הוזן קוד אימות בזמן — נסה לסנכרן שוב'))
  }, timeoutMs)
  waiters.set(connectionId, { promise, resolve, reject, timer })
  return promise
}

/** Resolve a pending wait. Returns false if nothing is waiting. */
export function submitOtpCode(connectionId: string, code: string): boolean {
  const existing = waiters.get(connectionId)
  if (!existing) return false
  clearTimeout(existing.timer)
  waiters.delete(connectionId)
  existing.resolve(code.trim())
  return true
}

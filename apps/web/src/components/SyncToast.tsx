'use client'

import { useEffect, useRef } from 'react'

/**
 * Transient notice for a background sync outcome, on surfaces that have no banner of their own.
 * Longer-lived than the "task added" toast because the copy names people and needs reading time.
 */
export function SyncToast({
  message,
  onDismiss,
  durationMs = 6000,
}: {
  message: string | null
  onDismiss: () => void
  durationMs?: number
}) {
  // Callers pass an inline arrow, so keeping it out of the effect's deps is what stops an
  // unrelated re-render from restarting the countdown and leaving the toast up forever.
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => dismissRef.current(), durationMs)
    return () => clearTimeout(timer)
  }, [message, durationMs])

  if (!message) return null
  return (
    <div className="toast" role="status">
      {message}
    </div>
  )
}

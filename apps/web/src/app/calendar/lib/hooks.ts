import { useEffect, useRef, useState, useCallback } from 'react'
import type { View } from './types'
import { DAY_START, HOUR_HEIGHT } from './constants'

export function useCurrentTime(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}

export function useAutoScroll(dep: unknown) {
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const now = new Date()
    const targetHour =
      now.getHours() >= DAY_START && now.getHours() < 22 ? now.getHours() - 1 : 8
    el.scrollTop = Math.max(0, (targetHour - DAY_START) * HOUR_HEIGHT - 24)
  }, [dep])

  return scrollRef
}

export function useCalendarKeyboard({
  onToday,
  onSetView,
  onPrev,
  onNext,
  onClosePanel,
}: {
  onToday: () => void
  onSetView: (v: View) => void
  onPrev: () => void
  onNext: () => void
  onClosePanel: () => void
}) {
  const handler = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return

      switch (e.key) {
        case 't':
        case 'T':
          e.preventDefault()
          onToday()
          break
        case 'd':
        case 'D':
          e.preventDefault()
          onSetView('day')
          break
        case 'w':
        case 'W':
          e.preventDefault()
          onSetView('week')
          break
        case 'm':
        case 'M':
          e.preventDefault()
          onSetView('month')
          break
        case 'ArrowLeft':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            onNext()
          }
          break
        case 'ArrowRight':
          if (!e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            onPrev()
          }
          break
        case 'Escape':
          onClosePanel()
          break
      }
    },
    [onToday, onSetView, onPrev, onNext, onClosePanel],
  )

  useEffect(() => {
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [handler])
}

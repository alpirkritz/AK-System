'use client'

import { useEffect, useState } from 'react'
import { keyboardOverlapPx } from './chat-layout'

const NARROW_MQ = '(max-width: 767px)'

export type VisualViewportFrame = {
  height: number
  offsetTop: number
  overlap: number
}

export function useIsNarrowPhone(): boolean {
  const [narrow, setNarrow] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia(NARROW_MQ)
    const update = () => setNarrow(mq.matches)
    update()
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  return narrow
}

export function useVisualViewportFrame(): VisualViewportFrame {
  const [frame, setFrame] = useState<VisualViewportFrame>({
    height: 0,
    offsetTop: 0,
    overlap: 0,
  })

  useEffect(() => {
    const vv = window.visualViewport

    const update = () => {
      const height = vv?.height ?? window.innerHeight
      const offsetTop = vv?.offsetTop ?? 0
      setFrame({
        height,
        offsetTop,
        overlap: keyboardOverlapPx(window.innerHeight, height, offsetTop),
      })
    }

    vv?.addEventListener('resize', update)
    vv?.addEventListener('scroll', update)
    window.addEventListener('resize', update)
    update()
    return () => {
      vv?.removeEventListener('resize', update)
      vv?.removeEventListener('scroll', update)
      window.removeEventListener('resize', update)
    }
  }, [])

  return frame
}

/** @deprecated use useVisualViewportFrame().overlap */
export function useKeyboardOverlap(): number {
  return useVisualViewportFrame().overlap
}

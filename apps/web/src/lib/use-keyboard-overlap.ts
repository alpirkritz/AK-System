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
      const overlap = keyboardOverlapPx(window.innerHeight, height, offsetTop)
      // Only commit a new frame when something moved — resize events can fire on
      // every layout pass (scrollbar toggling, address bar), and a fresh object
      // each time re-rendered the whole shell in a loop.
      setFrame((prev) =>
        prev.height === height && prev.offsetTop === offsetTop && prev.overlap === overlap
          ? prev
          : { height, offsetTop, overlap },
      )
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

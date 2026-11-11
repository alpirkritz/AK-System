'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export const PANEL_MIN = 380
export const PANEL_DEFAULT = 480
export const PANEL_WIDE = 760
/** From this width the panel may stop dimming the page and sit beside the list... */
export const SIDE_BY_SIDE_MIN = 720
/** ...but only while this much of the screen is left for the list and the navigation. */
export const SIDE_BY_SIDE_ROOM = 560
/** Below this viewport the panel is full screen and not resizable (phones, Fold cover screen). */
export const MOBILE_MAX = 767
const STORAGE_KEY = 'people_panel_width'

function maxWidth(viewport: number): number {
  return Math.max(PANEL_MIN, Math.floor(viewport * 0.75))
}

export function clampPanelWidth(width: number, viewport: number): number {
  return Math.min(maxWidth(viewport), Math.max(PANEL_MIN, Math.round(width)))
}

function readStored(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    const n = raw ? Number(raw) : NaN
    return Number.isFinite(n) ? n : PANEL_DEFAULT
  } catch {
    return PANEL_DEFAULT
  }
}

/**
 * Width of the person panel: dragged from its left edge (the panel opens from the right, RTL),
 * remembered per browser, re-clamped when the screen changes size (fold / unfold, rotate).
 */
export function useResizablePanel() {
  const [viewport, setViewport] = useState(() => (typeof window === 'undefined' ? 1280 : window.innerWidth))
  const [stored, setStored] = useState(PANEL_DEFAULT)
  const [dragging, setDragging] = useState(false)
  const viewportRef = useRef(viewport)
  viewportRef.current = viewport

  useEffect(() => {
    setStored(readStored())
    const onResize = () => setViewport(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])

  const isMobile = viewport <= MOBILE_MAX
  const width = clampPanelWidth(stored, viewport)
  const sideBySide = !isMobile && width >= SIDE_BY_SIDE_MIN && viewport - width >= SIDE_BY_SIDE_ROOM

  const commit = useCallback((next: number) => {
    const clamped = clampPanelWidth(next, viewportRef.current)
    setStored(clamped)
    return clamped
  }, [])

  const persist = useCallback((value: number) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, String(value))
    } catch {
      // private mode: the width simply is not remembered
    }
  }, [])

  const onPointerDown = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.button !== undefined && e.button !== 0) return
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    setDragging(true)
  }, [])

  const onPointerMove = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return
    // The panel is anchored to the physical right edge, so its width is the distance from there.
    commit(viewportRef.current - e.clientX)
  }, [commit])

  const onPointerUp = useCallback((e: React.PointerEvent<HTMLElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    setDragging(false)
    setStored((current) => {
      persist(clampPanelWidth(current, viewportRef.current))
      return current
    })
  }, [persist])

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLElement>) => {
    const step = e.shiftKey ? 64 : 16
    // The handle is on the left edge: moving it left makes the panel wider.
    const delta = e.key === 'ArrowLeft' ? step : e.key === 'ArrowRight' ? -step : 0
    if (!delta) return
    e.preventDefault()
    persist(commit(width + delta))
  }, [commit, persist, width])

  const onDoubleClick = useCallback(() => {
    const max = maxWidth(viewportRef.current)
    const next = width < PANEL_WIDE - 8 ? PANEL_WIDE : width < max - 8 ? max : PANEL_DEFAULT
    persist(commit(next))
  }, [commit, persist, width])

  return {
    width,
    min: PANEL_MIN,
    max: maxWidth(viewport),
    isMobile,
    sideBySide,
    dragging,
    handleProps: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp, onKeyDown, onDoubleClick },
  }
}

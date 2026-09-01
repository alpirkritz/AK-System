/** Pixels the on-screen keyboard overlaps the layout viewport. */
export function keyboardOverlapPx(
  innerHeight: number,
  visualViewportHeight: number,
  visualViewportOffsetTop: number,
): number {
  return Math.max(0, innerHeight - visualViewportHeight - visualViewportOffsetTop)
}

/** Pin the mobile chat shell to the visible rectangle (above the keyboard). Desktop must not use this. */
export function mobileAssistantShellStyle(
  isNarrow: boolean,
  viewportHeight: number,
  offsetTop: number,
): { position: 'fixed'; top: number; left: 0; right: 0; height: number; width: '100%' } | undefined {
  if (!isNarrow || viewportHeight <= 0) return undefined
  return {
    position: 'fixed',
    top: offsetTop,
    left: 0,
    right: 0,
    height: viewportHeight,
    width: '100%',
  }
}

export function isKeyboardOpen(overlapPx: number, thresholdPx = 80): boolean {
  return overlapPx > thresholdPx
}

export function scrollElementToBottom(el: { scrollHeight: number; scrollTop: number }): void {
  el.scrollTop = el.scrollHeight
}

export function scrollChildIntoList(
  list: { scrollTop: number; clientHeight: number },
  child: { offsetTop: number; clientHeight: number },
): void {
  list.scrollTop = child.offsetTop - list.clientHeight / 2 + child.clientHeight / 2
}

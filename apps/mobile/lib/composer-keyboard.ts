/**
 * Pixels to pad a view so its resting bottom edge meets the keyboard.
 *
 * `restingBottom` is the view's window bottom while it is not padded.
 * `keyboardTop` is the keyboard frame's `screenY`.
 *
 * Keep the resting bottom stable across keyboard frames. Re-measuring a view
 * that is already padded, then adding that overlap again, stacks the lift.
 */
export function keyboardLiftPx(restingBottom: number, keyboardTop: number): number {
  if (!(keyboardTop > 0) || !(restingBottom > 0)) return 0
  return Math.max(0, Math.round(restingBottom - keyboardTop))
}

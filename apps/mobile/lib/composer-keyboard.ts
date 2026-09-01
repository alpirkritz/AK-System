/**
 * Extra bottom padding so the chat composer stays above the keyboard.
 *
 * Android may shrink the window (`softwareKeyboardLayoutMode: 'resize'`)
 * and the tab bar also hides (`tabBarHideOnKeyboard`). Those shrinks already
 * lift the composer; only the remaining overlap should be padded.
 * A boolean "shrunk by >80px → pad nothing" is wrong: hiding the tab bar
 * alone is ~50–80px while the keyboard is ~300px.
 */
export function composerLiftPx(keyboardHeight: number, windowShrinkPx: number): number {
  if (keyboardHeight <= 0) return 0
  return Math.max(0, Math.round(keyboardHeight - Math.max(0, windowShrinkPx)))
}

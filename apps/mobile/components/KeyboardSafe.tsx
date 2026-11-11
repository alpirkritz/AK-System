import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import {
  Keyboard,
  Platform,
  ScrollView,
  TextInput,
  View,
  type KeyboardEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { keyboardLiftPx } from '../lib/composer-keyboard'

type KeyboardScrollable = {
  scrollResponderScrollNativeHandleToKeyboard?: (
    nodeHandle: object,
    additionalOffset?: number,
    preventNegativeScrollOffset?: boolean,
  ) => void
  getScrollResponder?: () => KeyboardScrollable | null | undefined
}

type Props = {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  /**
   * Scroll view or list that contains the focused field. After the screen
   * shrinks, the focused field is brought above the keyboard.
   */
  scrollRef?: RefObject<ScrollView | null>
}

function keyboardTopFrom(event: KeyboardEvent): number {
  const top = event.endCoordinates?.screenY
  return typeof top === 'number' ? top : 0
}

export function scrollFocusedInputAboveKeyboard(scroll: ScrollView | null | undefined) {
  const target = scroll as KeyboardScrollable | null | undefined
  const responder = target?.getScrollResponder?.() ?? target
  const input = TextInput.State.currentlyFocusedInput?.()
  if (!input || !responder?.scrollResponderScrollNativeHandleToKeyboard) return
  responder.scrollResponderScrollNativeHandleToKeyboard(input, 16, true)
}

export function useBringFocusedFieldIntoView(scrollRef: RefObject<ScrollView | null>) {
  useEffect(() => {
    const eventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const sub = Keyboard.addListener(eventName, () => {
      requestAnimationFrame(() => scrollFocusedInputAboveKeyboard(scrollRef.current))
    })
    return () => sub.remove()
  }, [scrollRef])
}

/**
 * Pads itself so its bottom sits on the keyboard top. Measures in window
 * coordinates, so a resized Android window adds nothing and a covered
 * window (edge-to-edge) still clears the focused field.
 */
export function KeyboardSafe({ children, style, scrollRef }: Props) {
  const viewRef = useRef<View>(null)
  const restingBottom = useRef(0)
  const [lift, setLift] = useState(0)

  useEffect(() => {
    const onFrame = (event: KeyboardEvent) => {
      const keyboardTop = keyboardTopFrom(event)
      const apply = () => {
        viewRef.current?.measureInWindow((_x, y, _w, height) => {
          if (!height) return
          const bottom = y + height
          setLift((prev) => {
            // Capture the unpadded bottom once. Later frames reuse it so a
            // measurement taken before the padding paints cannot stack.
            if (prev <= 0) restingBottom.current = bottom
            const base = restingBottom.current || bottom
            return keyboardLiftPx(base, keyboardTop)
          })
        })
      }
      // Let Android apply adjustResize before we measure, so we don't pad twice.
      if (Platform.OS === 'android') requestAnimationFrame(apply)
      else apply()
    }

    const showEvent = Platform.OS === 'ios' ? 'keyboardWillChangeFrame' : 'keyboardDidShow'
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const shown = Keyboard.addListener(showEvent, onFrame)
    const hidden = Keyboard.addListener(hideEvent, () => {
      restingBottom.current = 0
      setLift(0)
    })
    return () => {
      shown.remove()
      hidden.remove()
    }
  }, [])

  useEffect(() => {
    if (lift <= 0) return
    const id = requestAnimationFrame(() => scrollFocusedInputAboveKeyboard(scrollRef?.current))
    return () => cancelAnimationFrame(id)
  }, [lift, scrollRef])

  return (
    <View
      ref={viewRef}
      collapsable={false}
      style={[styles.flex, style, lift > 0 ? { paddingBottom: lift } : null]}
    >
      {children}
    </View>
  )
}

const styles = {
  flex: { flex: 1 },
} as const

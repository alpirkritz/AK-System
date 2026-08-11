import type { ReactNode } from 'react'
import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native'
import { colors } from '../lib/theme'

type Props = {
  children: ReactNode
  style?: StyleProp<ViewStyle>
  onPress?: () => void
  accessibilityLabel?: string
}

/** Dark-navy surface card. Renders a Pressable when `onPress` is given. */
export function Card({ children, style, onPress, accessibilityLabel }: Props) {
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        style={({ pressed }) => [styles.card, pressed && styles.pressed, style]}
      >
        {children}
      </Pressable>
    )
  }
  return <View style={[styles.card, style]}>{children}</View>
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  pressed: { opacity: 0.75 },
})

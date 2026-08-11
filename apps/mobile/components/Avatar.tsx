import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../lib/theme'

type Props = {
  name?: string | null
  size?: number
  onPress?: () => void
  accessibilityLabel?: string
}

function initials(name?: string | null): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

/** Circle with name initials. */
export function Avatar({ name, size = 36, onPress, accessibilityLabel }: Props) {
  const style = {
    width: size,
    height: size,
    borderRadius: size / 2,
  }
  const fontSize = Math.round(size * 0.38)

  const body = (
    <View style={[styles.circle, style]}>
      <Text style={[styles.text, { fontSize }]}>{initials(name)}</Text>
    </View>
  )

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? 'החשבון שלי'}
        style={{ minWidth: 44, minHeight: 44, justifyContent: 'center', alignItems: 'center' }}
      >
        {body}
      </Pressable>
    )
  }

  return body
}

const styles = StyleSheet.create({
  circle: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: {
    color: colors.accent,
    fontWeight: '700',
  },
})

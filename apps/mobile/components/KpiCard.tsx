import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { colors } from '../lib/theme'

type Props = {
  /** Big number/value line. */
  value: string | number
  /** Muted Hebrew label under the value. */
  label: string
  /** Value color; defaults to the accent turquoise. */
  color?: string
  /** Small secondary line under the label (e.g. "החודש"). */
  sublabel?: string
  onPress?: () => void
  style?: StyleProp<ViewStyle>
}

/** Compact KPI tile, modeled on the dashboard KPI row. */
export function KpiCard({ value, label, color, sublabel, onPress, style }: Props) {
  const body = (
    <>
      <Text style={[styles.value, { color: color ?? colors.accent }]} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
      {sublabel ? (
        <Text style={styles.sublabel} numberOfLines={1}>
          {sublabel}
        </Text>
      ) : null}
    </>
  )
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [styles.kpi, pressed && styles.pressed, style]}
      >
        {body}
      </Pressable>
    )
  }
  return <View style={[styles.kpi, style]}>{body}</View>
}

const styles = StyleSheet.create({
  kpi: {
    flex: 1,
    backgroundColor: colors.surfaceCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: 10,
    alignItems: 'center',
    gap: 4,
  },
  pressed: { opacity: 0.75 },
  value: { fontSize: 22, fontWeight: '700' },
  label: { color: colors.textMuted, fontSize: 12, writingDirection: 'rtl', textAlign: 'center' },
  sublabel: { color: colors.textMuted, fontSize: 10, writingDirection: 'rtl', textAlign: 'center' },
})

import { StyleSheet, Switch, Text, View } from 'react-native'
import { colors } from '../lib/theme'

type Props = {
  label: string
  description?: string
  value: boolean
  onValueChange: (next: boolean) => void
  disabled?: boolean
}

/** Label + optional description + Switch, RTL row. */
export function ToggleRow({ label, description, value, onValueChange, disabled }: Props) {
  return (
    <View style={[styles.row, disabled && styles.disabled]}>
      <Switch
        value={value}
        onValueChange={onValueChange}
        disabled={disabled}
        trackColor={{ false: colors.border, true: colors.accent }}
        thumbColor="#fff"
        accessibilityLabel={label}
      />
      <View style={styles.textCol}>
        <Text style={styles.label}>{label}</Text>
        {description ? <Text style={styles.description}>{description}</Text> : null}
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 12,
    paddingHorizontal: 14,
    gap: 12,
    backgroundColor: colors.surfaceCard,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  disabled: { opacity: 0.5 },
  textCol: { flex: 1, gap: 2 },
  label: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  description: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
})

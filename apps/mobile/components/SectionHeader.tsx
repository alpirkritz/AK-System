import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import { colors } from '../lib/theme'

type Props = {
  title: string
  /** Optional action rendered at the visual end (left in RTL). */
  action?: { label: string; onPress: () => void; disabled?: boolean }
  /** Override spacing — screens whose container already pads pass paddingHorizontal: 0. */
  style?: StyleProp<ViewStyle>
}

/** RTL section title with an optional inline action. */
export function SectionHeader({ title, action, style }: Props) {
  return (
    <View style={[styles.row, style]}>
      <Text style={styles.title}>{title}</Text>
      {action ? (
        <Pressable
          onPress={action.onPress}
          disabled={action.disabled}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          accessibilityState={{ disabled: action.disabled }}
          style={styles.actionBtn}
        >
          <Text style={[styles.actionText, action.disabled && styles.actionDisabled]}>
            {action.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
    gap: 8,
  },
  title: {
    color: colors.text,
    fontSize: 17,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
    flexShrink: 1,
  },
  actionBtn: { minHeight: 32, justifyContent: 'center' },
  actionText: { color: colors.accent, fontSize: 13, fontWeight: '600', writingDirection: 'rtl' },
  actionDisabled: { color: colors.textMuted },
})

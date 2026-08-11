import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../lib/theme'

type Props = {
  icon?: string
  label: string
  subtitle?: string
  value?: string
  badge?: string | number
  onPress?: () => void
  accessibilityLabel?: string
}

/** Full-width settings/hub row — icon, label, optional value, chevron. */
export function ListRow({
  icon,
  label,
  subtitle,
  value,
  badge,
  onPress,
  accessibilityLabel,
}: Props) {
  const content = (
    <>
      {icon ? <Text style={styles.icon}>{icon}</Text> : null}
      <View style={styles.textCol}>
        <Text style={styles.label}>{label}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {badge != null && badge !== 0 && badge !== '0' ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{badge}</Text>
        </View>
      ) : null}
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {onPress ? <Text style={styles.chevron}>‹</Text> : null}
    </>
  )

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? label}
        style={({ pressed }) => [styles.row, pressed && styles.pressed]}
      >
        {content}
      </Pressable>
    )
  }

  return <View style={styles.row}>{content}</View>
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    minHeight: 52,
    paddingVertical: 12,
    paddingHorizontal: 14,
    backgroundColor: colors.surfaceCard,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    gap: 12,
  },
  pressed: { opacity: 0.75 },
  icon: { fontSize: 22, width: 28, textAlign: 'center' },
  textCol: { flex: 1, gap: 2 },
  label: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  subtitle: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  value: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'left',
  },
  chevron: { color: colors.textMuted, fontSize: 22, paddingHorizontal: 4 },
  badge: {
    backgroundColor: colors.coral,
    borderRadius: 10,
    minWidth: 20,
    paddingHorizontal: 6,
    paddingVertical: 2,
    alignItems: 'center',
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
})

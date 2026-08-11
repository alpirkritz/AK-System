import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../lib/theme'

type Props = {
  /** Emoji/glyph shown above the text. */
  icon?: string
  text: string
  /** Optional muted second line. */
  hint?: string
  /** Needed for non-emoji glyphs like ✓, which take the text color. */
  iconColor?: string
  /** Inline variant for an empty section inside a populated screen. */
  compact?: boolean
}

/** Centered empty-list placeholder, matching the existing screens' style. */
export function EmptyState({ icon, text, hint, iconColor, compact }: Props) {
  return (
    <View style={[styles.empty, compact && styles.emptyCompact]}>
      {icon ? (
        <Text style={[styles.icon, compact && styles.iconCompact, iconColor ? { color: iconColor } : null]}>
          {icon}
        </Text>
      ) : null}
      <Text style={styles.text}>{text}</Text>
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 8, paddingHorizontal: 24 },
  emptyCompact: { paddingTop: 8, paddingBottom: 8, gap: 4, paddingHorizontal: 0 },
  icon: { fontSize: 34 },
  iconCompact: { fontSize: 22 },
  text: {
    color: colors.textMuted,
    fontSize: 15,
    writingDirection: 'rtl',
    textAlign: 'center',
  },
  hint: {
    color: colors.textMuted,
    fontSize: 12,
    writingDirection: 'rtl',
    textAlign: 'center',
    opacity: 0.8,
  },
})

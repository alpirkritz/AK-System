import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors } from '../lib/theme'

export type SegmentItem = { key: string; label: string }

type Props = {
  segments: SegmentItem[]
  selected: string
  onSelect: (key: string) => void
}

/** Horizontal chip segments for finance / calendar range. */
export function SegmentControl({ segments, selected, onSelect }: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
    >
      {segments.map((s) => {
        const active = s.key === selected
        return (
          <Pressable
            key={s.key}
            onPress={() => onSelect(s.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={s.label}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{s.label}</Text>
          </Pressable>
        )
      })}
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row-reverse',
    gap: 8,
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  chip: {
    minHeight: 36,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    justifyContent: 'center',
  },
  chipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.userBubble,
  },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
    writingDirection: 'rtl',
  },
  labelActive: { color: colors.accent, fontWeight: '700' },
})

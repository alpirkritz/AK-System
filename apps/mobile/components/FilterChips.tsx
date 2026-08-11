import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors } from '../lib/theme'

export type FilterChipItem = {
  key: string
  label: string
  /** Active color; defaults to the accent turquoise. */
  color?: string
}

type Props = {
  items: FilterChipItem[]
  /** Single-select mode. */
  selectedKey?: string | null
  /** Multi-select mode; wins over `selectedKey` when provided. */
  selectedKeys?: string[]
  onSelect: (key: string) => void
  /**
   * true → one horizontal scrolling row (long lists like workspaces);
   * false (default) → wrapping rows, like the tasks-screen chips.
   */
  scrollable?: boolean
}

/** Generic RTL filter-chip row, modeled on the chips in (tabs)/tasks.tsx. */
export function FilterChips({ items, selectedKey, selectedKeys, onSelect, scrollable }: Props) {
  const isActive = (key: string) =>
    selectedKeys ? selectedKeys.includes(key) : selectedKey === key

  const chips = items.map((item) => {
    const active = isActive(item.key)
    const color = item.color ?? colors.accent
    return (
      <Pressable
        key={item.key}
        onPress={() => onSelect(item.key)}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
        style={[styles.chip, active && { backgroundColor: color + '22', borderColor: color }]}
      >
        <Text style={[styles.chipText, active && { color, fontWeight: '600' }]}>
          {item.label}
        </Text>
      </Pressable>
    )
  })

  if (scrollable) {
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollRow}
        // RTL: first chip at the right edge.
        style={styles.scrollFlip}
      >
        {chips.map((chip, i) => (
          <View key={items[i].key} style={styles.scrollFlip}>
            {chip}
          </View>
        ))}
      </ScrollView>
    )
  }

  return <View style={styles.wrapRow}>{chips}</View>
}

const styles = StyleSheet.create({
  wrapRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  scrollRow: {
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
  },
  // Mirroring the ScrollView and un-mirroring each child keeps chip order RTL
  // (first item at the right edge) without RTL-layout support from ScrollView.
  scrollFlip: { transform: [{ scaleX: -1 }] },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    minHeight: 36,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  chipText: { color: colors.textMuted, fontSize: 13, writingDirection: 'rtl' },
})

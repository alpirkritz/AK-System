import { StyleSheet, Text, View } from 'react-native'
import { colors, STATUS_COLOR, STATUS_LABEL } from '../lib/theme'

/**
 * Task/status pill. Matches web: silent for not_started and done — the
 * checkbox already conveys those. Extracted from (tabs)/tasks.tsx.
 */
export function StatusPill({ status }: { status: string }) {
  if (!status || status === 'not_started' || status === 'done') return null
  const color = STATUS_COLOR[status] ?? colors.textMuted
  return (
    <View style={[styles.pill, { borderColor: color + '66', backgroundColor: color + '22' }]}>
      <Text style={[styles.pillText, { color }]}>{STATUS_LABEL[status] ?? status}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  pill: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
    borderWidth: 1,
  },
  pillText: { fontSize: 11, fontWeight: '600', writingDirection: 'rtl' },
})

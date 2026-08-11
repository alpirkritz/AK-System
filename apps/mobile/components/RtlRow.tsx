import { View, StyleSheet, type ViewProps } from 'react-native'

/** Row that lays children out right-to-left (row-reverse), centered vertically. */
export function RtlRow({ style, ...rest }: ViewProps) {
  return <View {...rest} style={[styles.row, style]} />
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
})

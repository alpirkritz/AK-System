import { Text, StyleSheet, type TextProps } from 'react-native'
import { colors } from '../lib/theme'

/** Text primitive with RTL alignment + writing direction and the default body color. */
export function RtlText({ style, ...rest }: TextProps) {
  return <Text {...rest} style={[styles.text, style]} />
}

const styles = StyleSheet.create({
  text: {
    color: colors.text,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
})

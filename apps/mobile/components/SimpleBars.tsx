import { StyleSheet, Text, View } from 'react-native'
import { colors } from '../lib/theme'

export type SimpleBarDatum = {
  label: string
  /** Bar magnitude. Negative values are drawn by |value|; use `color` to convey sign. */
  value: number
  color?: string
  /** Formatted value text; defaults to toLocaleString('he-IL'). */
  valueLabel?: string
}

type Props = {
  data: SimpleBarDatum[]
  /** 'horizontal' (default): label + bar per row. 'vertical': columns side by side. */
  direction?: 'horizontal' | 'vertical'
  /** Scale ceiling; defaults to max |value| in `data`. */
  maxValue?: number
  /** Column height for vertical mode. */
  height?: number
}

/**
 * Minimal bar chart in pure Views — no chart library, no WebView (spec
 * decision 2026-08-11). Intended for the finance screens.
 */
export function SimpleBars({ data, direction = 'horizontal', maxValue, height = 120 }: Props) {
  const max = maxValue ?? Math.max(...data.map((d) => Math.abs(d.value)), 1)
  const ratio = (v: number) => Math.min(Math.abs(v) / max, 1)
  const format = (d: SimpleBarDatum) =>
    d.valueLabel ?? Math.round(d.value).toLocaleString('he-IL')

  if (direction === 'vertical') {
    return (
      <View style={[styles.columnsRow, { height: height + 36 }]}>
        {data.map((d, i) => (
          <View key={`${d.label}-${i}`} style={styles.column}>
            <Text style={styles.columnValue} numberOfLines={1}>
              {format(d)}
            </Text>
            <View style={[styles.columnTrack, { height }]}>
              <View
                style={[
                  styles.columnFill,
                  {
                    height: Math.max(Math.round(ratio(d.value) * height), d.value === 0 ? 0 : 2),
                    backgroundColor: d.color ?? colors.accent,
                  },
                ]}
              />
            </View>
            <Text style={styles.columnLabel} numberOfLines={1}>
              {d.label}
            </Text>
          </View>
        ))}
      </View>
    )
  }

  return (
    <View style={styles.rows}>
      {data.map((d, i) => (
        <View key={`${d.label}-${i}`} style={styles.row}>
          <Text style={styles.rowLabel} numberOfLines={1}>
            {d.label}
          </Text>
          <View style={styles.rowTrack}>
            <View
              style={[
                styles.rowFill,
                {
                  width: `${Math.max(ratio(d.value) * 100, d.value === 0 ? 0 : 1)}%`,
                  backgroundColor: d.color ?? colors.accent,
                },
              ]}
            />
          </View>
          <Text style={styles.rowValue} numberOfLines={1}>
            {format(d)}
          </Text>
        </View>
      ))}
    </View>
  )
}

const styles = StyleSheet.create({
  rows: { gap: 8 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  rowLabel: {
    color: colors.textMuted,
    fontSize: 12,
    writingDirection: 'rtl',
    textAlign: 'right',
    width: 88,
  },
  rowTrack: {
    flex: 1,
    height: 14,
    borderRadius: 7,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    // Bars grow from the right edge, matching RTL reading order.
    flexDirection: 'row-reverse',
  },
  rowFill: { height: '100%', borderRadius: 7 },
  rowValue: {
    color: colors.text,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    minWidth: 56,
    textAlign: 'left',
  },
  columnsRow: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-end',
    gap: 8,
  },
  column: { flex: 1, alignItems: 'center', gap: 4 },
  columnTrack: {
    width: '100%',
    maxWidth: 40,
    borderRadius: 6,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    justifyContent: 'flex-end',
  },
  columnFill: { width: '100%', borderRadius: 6 },
  columnValue: { color: colors.text, fontSize: 10, fontVariant: ['tabular-nums'] },
  columnLabel: { color: colors.textMuted, fontSize: 10, writingDirection: 'rtl' },
})

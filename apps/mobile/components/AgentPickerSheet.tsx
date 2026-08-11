import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { colors } from '../lib/theme'
import { BottomSheetScaffold } from './BottomSheetScaffold'

export const GENERAL_AGENT_ID = '__general__'

export type AgentPickerItem = {
  id: string
  name: string
  role: string
}

type Props = {
  visible: boolean
  onClose: () => void
  agents: AgentPickerItem[]
  selectedId: string
  onSelect: (id: string) => void
}

/** Bottom sheet to choose general assistant vs specialist agent. */
export function AgentPickerSheet({
  visible,
  onClose,
  agents,
  selectedId,
  onSelect,
}: Props) {
  const pick = (id: string) => {
    onSelect(id)
    onClose()
  }

  return (
    <BottomSheetScaffold title="בחר עוזר" visible={visible} onClose={onClose}>
      <ScrollView contentContainerStyle={styles.list}>
        <AgentRow
          selected={selectedId === GENERAL_AGENT_ID}
          name="עוזר כללי"
          role="הוגו — שיחה חופשית"
          onPress={() => pick(GENERAL_AGENT_ID)}
        />
        {agents.length > 0 ? (
          <>
            <Text style={styles.section}>סוכנים מומחים</Text>
            {agents.map((a) => (
              <AgentRow
                key={a.id}
                selected={selectedId === a.id}
                name={a.name}
                role={a.role}
                onPress={() => pick(a.id)}
              />
            ))}
          </>
        ) : null}
      </ScrollView>
    </BottomSheetScaffold>
  )
}

function AgentRow({
  selected,
  name,
  role,
  onPress,
}: {
  selected: boolean
  name: string
  role: string
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={name}
      style={({ pressed }) => [styles.row, selected && styles.rowSelected, pressed && styles.pressed]}
    >
      <Text style={styles.check}>{selected ? '✓' : '○'}</Text>
      <View style={styles.textCol}>
        <Text style={styles.name}>{name}</Text>
        {role ? <Text style={styles.role}>{role}</Text> : null}
      </View>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  list: { paddingBottom: 16 },
  section: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    minHeight: 56,
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowSelected: { backgroundColor: colors.userBubble },
  pressed: { opacity: 0.8 },
  check: { color: colors.accent, fontSize: 18, width: 24, textAlign: 'center' },
  textCol: { flex: 1, gap: 2 },
  name: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  role: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
})

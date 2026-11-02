import { useCallback, useEffect, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { addAliasToPerson, fetchAliases, removeAliasById, type MobileAlias } from '../lib/data'
import { colors } from '../lib/theme'

const ORIGIN_LABEL: Record<string, string> = {
  slack: 'סלאק', whatsapp: 'וואטסאפ', meeting: 'פגישה', email: 'מייל', notion: 'נושן', voice: 'הקלטה', analysis: 'ניתוח', calendar: 'יומן',
}

/** Other names for one person; every source that sees one of them resolves to this person. */
export function PersonAliasesEditor({ token, personId }: { token: string; personId: string }) {
  const [aliases, setAliases] = useState<MobileAlias[]>([])
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setAliases(await fetchAliases(token, personId))
    } catch {
      setAliases([])
    }
  }, [token, personId])

  useEffect(() => {
    void load()
  }, [load])

  const add = async () => {
    const alias = draft.trim()
    if (!alias || busy) return
    setBusy(true)
    try {
      setAliases(await addAliasToPerson(token, personId, alias))
      setDraft('')
    } catch (err) {
      Alert.alert('לא נוסף', err instanceof Error ? err.message : 'ההוספה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (a: MobileAlias) => {
    try {
      await removeAliasById(token, a.id)
      setAliases((prev) => prev.filter((x) => x.id !== a.id))
    } catch {
      Alert.alert('שגיאה', 'ההסרה נכשלה')
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>שמות נוספים</Text>
      <View style={styles.chips}>
        {aliases.map((a) => (
          <Pressable
            key={a.id}
            onPress={() => void remove(a)}
            style={styles.chip}
            accessibilityRole="button"
            accessibilityLabel={`הסר ${a.alias}`}
          >
            <Text style={styles.chipText}>
              {a.alias}
              {a.origin ? ` · ${ORIGIN_LABEL[a.origin] ?? a.origin}` : ''} ✕
            </Text>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onSubmitEditing={() => void add()}
        onBlur={() => void add()}
        returnKeyType="done"
        placeholder="הוסף שם: ג׳ורדן, Jordan…"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        textAlign="right"
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { gap: 8, marginTop: 4 },
  label: { color: colors.textMuted, fontSize: 13, textAlign: 'right', writingDirection: 'rtl' },
  chips: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: colors.border, borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10 },
  chipText: { color: colors.text, fontSize: 13, writingDirection: 'rtl' },
  input: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8,
    color: colors.text, writingDirection: 'rtl',
  },
})

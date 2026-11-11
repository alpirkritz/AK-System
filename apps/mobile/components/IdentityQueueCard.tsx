import { useCallback, useEffect, useMemo, useState } from 'react'
import { Alert, Pressable, StyleSheet, Text, TextInput, View } from 'react-native'
import { useAuth } from '../lib/auth'
import {
  answerIdentityQueue, fetchIdentityQueueCount, fetchIdentityQueueNext, fetchPeople,
  type MobileIdentityQueueItem, type MobilePerson,
} from '../lib/data'
import { colors } from '../lib/theme'
import { Card } from './Card'

const SOURCE_LABEL: Record<string, string> = {
  meeting: 'פגישה', whatsapp: 'וואטסאפ', notion: 'נושן', email: 'מייל', voice: 'הקלטה', analysis: 'ניתוח פגישה', slack: 'סלאק',
}

/** One unplaced name at a time: "זה ירדן?" answered once, remembered for good. */
export function IdentityQueueCard() {
  const { token } = useAuth()
  const [item, setItem] = useState<MobileIdentityQueueItem | null>(null)
  const [count, setCount] = useState(0)
  const [picking, setPicking] = useState(false)
  const [query, setQuery] = useState('')
  const [everyone, setEveryone] = useState<MobilePerson[]>([])
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    try {
      const [next, n] = await Promise.all([fetchIdentityQueueNext(token), fetchIdentityQueueCount(token)])
      setItem(next)
      setCount(n)
    } catch {
      setItem(null)
    }
  }, [token])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!picking || !token || everyone.length > 0) return
    void fetchPeople(token).then(setEveryone).catch(() => undefined)
  }, [picking, token, everyone.length])

  const matches = useMemo(() => {
    const q = query.trim()
    return q ? everyone.filter((p) => p.name.includes(q)).slice(0, 5) : []
  }, [everyone, query])

  if (!item || !token) return null

  const answer = async (action: 'link' | 'new' | 'dismiss', personId?: string) => {
    setBusy(true)
    try {
      await answerIdentityQueue(token, { id: item.id, action, personId })
      setPicking(false)
      setQuery('')
      await load()
    } catch (err) {
      Alert.alert('שגיאה', err instanceof Error ? err.message : 'הפעולה נכשלה')
    } finally {
      setBusy(false)
    }
  }

  const where = [SOURCE_LABEL[item.source] ?? item.source, item.context].filter(Boolean).join(' · ')

  return (
    <Card style={styles.card}>
      <Text style={styles.question}>
        {item.candidate ? `״${item.name}״. זה ${item.candidate.name}?` : `מי זה ״${item.name}״?`}
      </Text>
      {where ? <Text style={styles.meta}>{where}{count > 1 ? ` · עוד ${count - 1} בתור` : ''}</Text> : null}
      <View style={styles.actions}>
        {item.candidate ? (
          <Pressable style={[styles.btn, styles.primary]} disabled={busy} onPress={() => void answer('link', item.candidate!.id)} accessibilityRole="button">
            <Text style={styles.primaryText}>כן</Text>
          </Pressable>
        ) : null}
        <Pressable style={styles.btn} disabled={busy} onPress={() => void answer('new')} accessibilityRole="button">
          <Text style={styles.btnText}>אדם חדש</Text>
        </Pressable>
        <Pressable style={styles.btn} onPress={() => setPicking((v) => !v)} accessibilityRole="button">
          <Text style={styles.btnText}>אחר…</Text>
        </Pressable>
        <Pressable style={styles.btn} disabled={busy} onPress={() => void answer('dismiss')} accessibilityRole="button">
          <Text style={styles.btnText}>התעלם</Text>
        </Pressable>
      </View>
      {picking ? (
        <View style={styles.picker}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="חפש אדם…"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            textAlign="right"
            autoFocus
          />
          {matches.map((p) => (
            <Pressable key={p.id} onPress={() => void answer('link', p.id)} style={styles.match} accessibilityRole="button">
              <Text style={styles.btnText}>{p.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </Card>
  )
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 12, marginTop: 8, gap: 6 },
  question: { color: colors.text, fontSize: 15, textAlign: 'right', writingDirection: 'rtl' },
  meta: { color: colors.textMuted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl' },
  actions: { flexDirection: 'row-reverse', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  btn: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 14 },
  primary: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnText: { color: colors.text, fontSize: 13, writingDirection: 'rtl' },
  primaryText: { color: colors.bg, fontSize: 13, fontWeight: '600' },
  picker: { gap: 6, marginTop: 4 },
  input: { borderWidth: 1, borderColor: colors.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, color: colors.text, writingDirection: 'rtl' },
  match: { paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border, alignItems: 'flex-end' },
})

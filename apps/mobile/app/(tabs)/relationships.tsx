import { useCallback, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useFocusEffect, useRouter, type Href } from 'expo-router'
import { useBringFocusedFieldIntoView } from '../../components/KeyboardSafe'
import { useAuth } from '../../lib/auth'
import {
  fetchRelationshipBoard,
  saveWarmthNote,
  type MobileBoardCard,
} from '../../lib/data'
import { formatSentiment } from '../../lib/warmth-format'
import { colors } from '../../lib/theme'

function dayLabel(date: string): string {
  const [, m, d] = date.split('-')
  return m && d ? `${Number(d)}.${Number(m)}` : date
}

export default function RelationshipsScreen() {
  const { token } = useAuth()
  const router = useRouter()
  const [people, setPeople] = useState<MobileBoardCard[]>([])
  const [circles, setCircles] = useState<MobileBoardCard[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<ScrollView>(null)
  useBringFocusedFieldIntoView(scrollRef)
  const hasLoadedOnce = useRef(false)

  const load = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (!token) return
    mode === 'refresh' ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const board = await fetchRelationshipBoard(token)
      setPeople(board.people)
      setCircles(board.circles)
      hasLoadedOnce.current = true
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא הצלחנו לטעון את הקשרים.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [token])

  useFocusEffect(
    useCallback(() => {
      if (!token) return
      void load(hasLoadedOnce.current ? 'refresh' : 'initial')
    }, [token, load]),
  )

  const save = async (subject: 'person' | 'circle', id: string, note: string | null) => {
    if (!token) return
    if (note && note.trim().length > 280) throw new Error('עד 280 תווים.')
    await saveWarmthNote(token, { subject, id, note: note?.trim() ? note.trim() : null })
    await load('refresh')
  }

  if (loading && people.length + circles.length === 0) {
    return <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
  }

  const groups: { title: string; cards: MobileBoardCard[]; subject: 'person' | 'circle' }[] = [
    { title: 'צריך 1:1', cards: people.filter((c) => c.trend === 'cooling'), subject: 'person' },
    { title: 'במצב טוב', cards: people.filter((c) => c.trend === 'warming'), subject: 'person' },
    { title: 'חוגים מתקררים', cards: circles.filter((c) => c.trend === 'cooling'), subject: 'circle' },
    { title: 'חוגים מתחממים', cards: circles.filter((c) => c.trend === 'warming'), subject: 'circle' },
  ]
  const empty = groups.every((g) => g.cards.length === 0)

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.flex}
      contentContainerStyle={styles.content}
      keyboardShouldPersistTaps="handled"
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.accent} />}
    >
      <Text style={styles.subtitle}>מי צריך שיחה אישית ממך, לפי הטון בפגישות ולפי מתי דיברתם לאחרונה בכל ערוץ.</Text>
      {error ? (
        <View>
          <Text style={styles.error}>לא הצלחנו לטעון את הקשרים.</Text>
          <Pressable onPress={() => void load()} style={styles.saveBtn} accessibilityRole="button"><Text style={styles.saveText}>נסה שוב</Text></Pressable>
        </View>
      ) : null}
      {empty && !error ? (
        <Text style={styles.subtitle}>אין כרגע קשר שזז. אחרי ארבע שיחות מנותחות בחצי השנה, השינוי יופיע כאן.</Text>
      ) : null}
      {groups.map((g) => g.cards.length === 0 ? null : (
        <View key={g.title} style={styles.section}>
          <Text style={styles.sectionTitle}>{g.title}</Text>
          {g.cards.map((card) => (
            <BoardCardView
              key={card.id}
              card={card}
              subject={g.subject}
              onOpen={() => {
                if (g.subject === 'person') router.push(`/person/${card.id}` as Href)
                else if (card.timeline[0]) router.push(`/meeting/${card.timeline[0].meetingId}` as Href)
              }}
              onSave={(note) => save(g.subject, card.id, note)}
            />
          ))}
        </View>
      ))}
    </ScrollView>
  )
}

function BoardCardView({
  card,
  subject,
  onOpen,
  onSave,
}: {
  card: MobileBoardCard
  subject: 'person' | 'circle'
  onOpen: () => void
  onSave: (note: string | null) => Promise<void>
}) {
  const [writing, setWriting] = useState(false)
  const [draft, setDraft] = useState(card.note ?? '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const cooling = card.trend === 'cooling'
  const bars = [...card.timeline].reverse()

  const submit = async (note: string | null) => {
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      await onSave(note)
      setWriting(false)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא הצלחנו לשמור. נסה שוב.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.name}>{card.name}</Text>
        <Text style={[styles.pill, cooling ? styles.cool : styles.warm]}>{subject === 'person' ? (cooling ? 'צריך 1:1' : 'במצב טוב') : cooling ? 'מתקרר' : 'מתחמם'}</Text>
        <Pressable onPress={onOpen} accessibilityRole="button" hitSlop={8}><Text style={styles.link}>פתח כרטיס</Text></Pressable>
      </View>
      <View style={styles.chart}>
        <View style={styles.zero} />
        {bars.map((p) => {
          const h = Math.max(3, Math.min(1, Math.abs(p.sentiment)) * 28)
          const up = p.sentiment >= 0
          return <View key={p.meetingId} style={styles.slot}><View style={[styles.bar, { height: h, backgroundColor: up ? colors.success : '#facc15' }, up ? { bottom: 32 } : { top: 32 }]} /></View>
        })}
      </View>
      <Text style={styles.muted}>ממוצע אחרון {formatSentiment(card.recentAvg)} · ממוצע קודם {formatSentiment(card.olderAvg)}</Text>
      {card.note && !writing ? (
        <Text style={styles.note}><Text style={styles.muted}>למה אני חושב כך{'\n'}</Text>{card.note}</Text>
      ) : null}
      <Text style={styles.reason}>{card.dataReason}</Text>
      {card.timeline.slice(0, 3).map((p) => (
        <Text key={p.meetingId} style={styles.meeting} numberOfLines={1}>
          {dayLabel(p.date)} · {p.title}{p.score != null ? ` · ${p.score}/10` : ''} · {formatSentiment(p.sentiment)}
        </Text>
      ))}
      {writing ? (
        <View style={styles.edit}>
          <TextInput
            value={draft}
            onChangeText={(t) => { setDraft(t); setSaved(false); setError(null) }}
            placeholder="במשפט אחד, מה השתנה"
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            textAlign="right"
            maxLength={280}
            accessibilityLabel="למה אני חושב כך"
          />
          <Pressable disabled={busy} onPress={() => void submit(draft)} style={styles.saveBtn} accessibilityRole="button">
            <Text style={styles.saveText}>{busy ? 'שומר…' : 'שמור'}</Text>
          </Pressable>
        </View>
      ) : card.note ? (
        <View style={styles.row}>
          <Pressable onPress={() => { setWriting(true); setDraft(card.note ?? '') }} accessibilityRole="button"><Text style={styles.link}>ערוך</Text></Pressable>
          <Pressable
            disabled={busy}
            onPress={() => Alert.alert('נקה', `למחוק את הדעה שלך על ${card.name}?`, [
              { text: 'ביטול', style: 'cancel' },
              { text: 'מחק', style: 'destructive', onPress: () => void submit(null) },
            ])}
            accessibilityRole="button"
          >
            <Text style={styles.link}>נקה</Text>
          </Pressable>
        </View>
      ) : (
        <Pressable onPress={() => setWriting(true)} accessibilityRole="button"><Text style={styles.link}>רשום את הדעה שלך</Text></Pressable>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {saved ? <Text style={styles.saved}>נשמר</Text> : null}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  content: { padding: 16, paddingBottom: 40 },
  subtitle: { color: colors.textMuted, fontSize: 13, textAlign: 'right', writingDirection: 'rtl', marginBottom: 12 },
  section: { marginBottom: 16 },
  sectionTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '700', textAlign: 'right', writingDirection: 'rtl', marginBottom: 8 },
  card: { backgroundColor: colors.surfaceCard, borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, marginBottom: 8, gap: 6 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  name: { color: colors.text, fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'right', writingDirection: 'rtl' },
  pill: { fontSize: 11, fontWeight: '700' },
  cool: { color: '#facc15' },
  warm: { color: colors.success },
  link: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  chart: { height: 64, flexDirection: 'row', gap: 3 },
  zero: { position: 'absolute', left: 0, right: 0, top: 31, height: 1, backgroundColor: colors.border },
  slot: { flex: 1, position: 'relative' },
  bar: { position: 'absolute', left: 1, right: 1, borderRadius: 2 },
  muted: { color: colors.textMuted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl' },
  note: { color: colors.text, fontSize: 14, textAlign: 'right', writingDirection: 'rtl', lineHeight: 20 },
  reason: { color: colors.textMuted, fontSize: 13, textAlign: 'right', writingDirection: 'rtl', lineHeight: 18 },
  meeting: { color: colors.text, fontSize: 13, textAlign: 'right', writingDirection: 'rtl' },
  edit: { gap: 8 },
  input: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderRadius: 10, color: colors.text, minHeight: 44, paddingHorizontal: 12, writingDirection: 'rtl' },
  saveBtn: { minHeight: 44, borderRadius: 10, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  saveText: { color: colors.bg, fontWeight: '700' },
  error: { color: colors.error, textAlign: 'right', writingDirection: 'rtl' },
  saved: { color: colors.success, textAlign: 'right' },
})

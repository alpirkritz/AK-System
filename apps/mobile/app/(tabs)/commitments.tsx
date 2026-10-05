import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useFocusEffect } from 'expo-router'
import { FilterChips } from '../../components/FilterChips'
import { useAuth } from '../../lib/auth'
import {
  acceptCommitment,
  dismissCommitment,
  fetchProposedCommitments,
  type MobileCommitment,
} from '../../lib/data'
import { colors } from '../../lib/theme'

type OwnerFilter = 'all' | 'me' | 'them'

function dueLabel(iso: string | null): string {
  if (!iso) return ''
  const [, m, d] = iso.split('-')
  return `עד ${Number(d)}.${Number(m)}`
}

export default function CommitmentsScreen() {
  const { token } = useAuth()
  const [owner, setOwner] = useState<OwnerFilter>('all')
  const [items, setItems] = useState<MobileCommitment[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const hasLoadedOnce = useRef(false)

  const chips = useMemo(
    () => [
      { key: 'all', label: 'הכול' },
      { key: 'me', label: 'שלי' },
      { key: 'them', label: 'שלהם' },
    ],
    [],
  )

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return
      mode === 'refresh' ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        setItems(await fetchProposedCommitments(token, owner))
        hasLoadedOnce.current = true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'טעינה נכשלה')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [token, owner],
  )

  // Initial load, and reload whenever the owner filter changes.
  useEffect(() => {
    void load()
  }, [load])

  // Refetch on every focus — accepting/dismissing here or creating a
  // commitment elsewhere must not leave a stale list after navigating back.
  useFocusEffect(
    useCallback(() => {
      if (!token || !hasLoadedOnce.current) return
      void load('refresh')
    }, [token, load]),
  )

  const act = async (id: string, action: 'accept' | 'dismiss') => {
    if (!token) return
    setBusyId(id)
    try {
      if (action === 'accept') await acceptCommitment(token, id)
      else await dismissCommitment(token, id)
      setItems((prev) => prev.filter((c) => c.id !== id))
    } catch (err) {
      Alert.alert('שגיאה', err instanceof Error ? err.message : 'הפעולה נכשלה')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <View style={styles.flex}>
      <View style={styles.chips}>
        <FilterChips items={chips} selectedKey={owner} onSelect={(k) => setOwner(k as OwnerFilter)} />
      </View>
      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(c) => c.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.accent} />
          }
          ListEmptyComponent={<Text style={styles.empty}>אין התחייבויות ממתינות</Text>}
          renderItem={({ item: c }) => (
            <View style={styles.card}>
              <Text style={styles.meta}>
                {c.personName} · {c.owner === 'me' ? 'עליי' : 'עליו/ה'}
                {c.dueInferred ? ` · ${dueLabel(c.dueInferred)}` : ''}
              </Text>
              <Text style={styles.content}>{c.content}</Text>
              {c.sourceSnippet ? <Text style={styles.snippet} numberOfLines={2}>{c.sourceSnippet}</Text> : null}
              <View style={styles.actions}>
                <Pressable
                  style={[styles.btn, styles.btnPrimary]}
                  disabled={busyId === c.id}
                  onPress={() => act(c.id, 'accept')}
                  accessibilityRole="button"
                  accessibilityLabel={`קבל: ${c.content}`}
                >
                  <Text style={styles.btnPrimaryText}>קבל</Text>
                </Pressable>
                <Pressable
                  style={styles.btn}
                  disabled={busyId === c.id}
                  onPress={() => act(c.id, 'dismiss')}
                  accessibilityRole="button"
                  accessibilityLabel={`דחה: ${c.content}`}
                >
                  <Text style={styles.btnText}>דחה</Text>
                </Pressable>
              </View>
            </View>
          )}
        />
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  chips: { paddingHorizontal: 12, paddingTop: 12 },
  loader: { marginTop: 32 },
  error: { color: '#f87171', textAlign: 'center', marginTop: 32 },
  list: { padding: 12, gap: 10 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 32, writingDirection: 'rtl' },
  card: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: 12, gap: 4 },
  meta: { color: colors.textMuted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl' },
  content: { color: colors.text, fontSize: 15, textAlign: 'right', writingDirection: 'rtl' },
  snippet: { color: colors.textMuted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl' },
  actions: { flexDirection: 'row-reverse', gap: 8, marginTop: 8 },
  btn: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 14 },
  btnPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  btnText: { color: colors.text, fontSize: 13 },
  btnPrimaryText: { color: colors.bg, fontSize: 13, fontWeight: '600' },
})

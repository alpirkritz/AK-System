import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useAuth } from '../../lib/auth'
import { fetchPeople, type MobilePerson } from '../../lib/data'
import { colors } from '../../lib/theme'

export default function PeopleScreen() {
  const { token } = useAuth()
  const [people, setPeople] = useState<MobilePerson[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return
      mode === 'refresh' ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        setPeople(await fetchPeople(token))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'טעינת אנשי הקשר נכשלה')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [token],
  )

  useEffect(() => {
    load()
  }, [load])

  const q = search.trim().toLowerCase()
  const visible = q
    ? people.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.company ?? '').toLowerCase().includes(q) ||
          (p.role ?? '').toLowerCase().includes(q),
      )
    : people

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <View style={styles.flex}>
      <View style={styles.searchWrap}>
        <TextInput
          style={styles.search}
          value={search}
          onChangeText={setSearch}
          placeholder="חיפוש איש קשר…"
          placeholderTextColor={colors.textMuted}
          textAlign="right"
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={visible}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyText}>{q ? 'לא נמצאו אנשי קשר' : 'אין אנשי קשר עדיין'}</Text>
          </View>
        }
        renderItem={({ item }) => {
          const color = item.color ?? colors.accent
          return (
            <View style={styles.row}>
              <View style={[styles.avatar, { backgroundColor: color + '22', borderColor: color + '55' }]}>
                <Text style={[styles.avatarText, { color }]}>{item.name.charAt(0)}</Text>
              </View>
              <View style={styles.body}>
                <Text style={styles.name}>{item.name}</Text>
                {(item.role || item.company) && (
                  <Text style={styles.sub}>
                    {[item.role, item.company].filter(Boolean).join(' · ')}
                  </Text>
                )}
              </View>
            </View>
          )
        }}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  searchWrap: { paddingHorizontal: 16, paddingVertical: 12 },
  search: {
    backgroundColor: colors.surfaceCard,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 14,
    paddingVertical: 10,
    color: colors.text,
    fontSize: 15,
  },
  list: { paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 },
  row: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  avatar: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { fontSize: 17, fontWeight: '700' },
  body: { flex: 1 },
  name: { color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'right', writingDirection: 'rtl' },
  sub: { color: colors.textMuted, fontSize: 13, textAlign: 'right', marginTop: 2 },
  empty: { alignItems: 'center', justifyContent: 'center', paddingTop: 80, gap: 8 },
  emptyIcon: { fontSize: 34 },
  emptyText: { color: colors.textMuted, fontSize: 15, writingDirection: 'rtl' },
  error: { color: colors.error, textAlign: 'center', padding: 8, writingDirection: 'rtl' },
})

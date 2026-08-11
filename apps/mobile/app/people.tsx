import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useRouter, type Href } from 'expo-router'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { SectionHeader } from '../components/SectionHeader'
import { useAuth } from '../lib/auth'
import {
  confirmPerson,
  fetchPeoplePaginated,
  fetchReviewQueue,
  ignorePerson,
  type MobilePerson,
  type MobileReviewPerson,
} from '../lib/data'
import { colors } from '../lib/theme'

export default function PeopleScreen() {
  const { token } = useAuth()
  const router = useRouter()
  const [people, setPeople] = useState<MobilePerson[]>([])
  const [reviewQueue, setReviewQueue] = useState<MobileReviewPerson[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [acting, setActing] = useState<string | null>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return
      mode === 'refresh' ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        const [paginated, queue] = await Promise.all([
          fetchPeoplePaginated(token, { search: debouncedSearch || undefined, pageSize: 100 }),
          fetchReviewQueue(token),
        ])
        setPeople(paginated.items)
        setReviewQueue(queue)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'טעינת אנשי הקשר נכשלה')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [token, debouncedSearch],
  )

  useEffect(() => {
    void load()
  }, [load])

  const onConfirm = async (id: string) => {
    if (!token || acting) return
    setActing(id)
    try {
      await confirmPerson(token, id)
      await load('refresh')
    } catch {
      setError('אישור נכשל')
    } finally {
      setActing(null)
    }
  }

  const onIgnore = async (id: string) => {
    if (!token || acting) return
    setActing(id)
    try {
      await ignorePerson(token, id)
      await load('refresh')
    } catch {
      setError('התעלמות נכשלה')
    } finally {
      setActing(null)
    }
  }

  const reviewSection =
    reviewQueue.length === 0 ? null : (
      <View style={styles.reviewSection}>
        <SectionHeader title="לאישור" style={styles.reviewHeader} />
        {reviewQueue.map((item) => (
          <Card key={item.id} style={styles.reviewCard}>
            <Text style={styles.reviewName}>{item.name}</Text>
            {(item.meetingCount ?? 0) > 0 ? (
              <Text style={styles.reviewMeta}>{item.meetingCount} פגישות</Text>
            ) : null}
            {item.suggestedMatch ? (
              <Text style={styles.reviewHint}>הצעה: {item.suggestedMatch.name}</Text>
            ) : null}
            <View style={styles.reviewActions}>
              <Pressable
                onPress={() => void onConfirm(item.id)}
                disabled={acting === item.id}
                style={[styles.confirmBtn, acting === item.id && styles.btnDisabled]}
                accessibilityRole="button"
                accessibilityLabel={`אשר ${item.name}`}
              >
                <Text style={styles.confirmText}>אשר</Text>
              </Pressable>
              <Pressable
                onPress={() => void onIgnore(item.id)}
                disabled={acting === item.id}
                style={[styles.ignoreBtn, acting === item.id && styles.btnDisabled]}
                accessibilityRole="button"
                accessibilityLabel={`התעלם מ${item.name}`}
              >
                <Text style={styles.ignoreText}>התעלם</Text>
              </Pressable>
            </View>
          </Card>
        ))}
      </View>
    )

  if (loading && people.length === 0) {
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
        data={people}
        keyExtractor={(p) => p.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={reviewSection}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          <EmptyState
            icon="👥"
            text={debouncedSearch ? 'לא נמצאו אנשי קשר' : 'אין אנשי קשר עדיין'}
          />
        }
        renderItem={({ item }) => {
          const color = item.color ?? colors.accent
          return (
            <Card
              style={styles.row}
              onPress={() => router.push(`/person/${item.id}` as Href)}
              accessibilityLabel={`איש קשר ${item.name}`}
            >
              <View style={styles.rowInner}>
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
            </Card>
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
  reviewSection: { marginBottom: 8 },
  reviewHeader: { paddingHorizontal: 0 },
  reviewCard: { marginBottom: 8, gap: 4 },
  reviewName: { color: colors.text, fontSize: 16, fontWeight: '600', textAlign: 'right', writingDirection: 'rtl' },
  reviewMeta: { color: colors.textMuted, fontSize: 13, textAlign: 'right' },
  reviewHint: { color: colors.info, fontSize: 12, textAlign: 'right', writingDirection: 'rtl' },
  reviewActions: { flexDirection: 'row-reverse', gap: 8, marginTop: 8 },
  confirmBtn: {
    minHeight: 36,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: colors.accent + '22',
    borderWidth: 1,
    borderColor: colors.accent,
    justifyContent: 'center',
  },
  confirmText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  ignoreBtn: {
    minHeight: 36,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  ignoreText: { color: colors.textMuted, fontSize: 14 },
  btnDisabled: { opacity: 0.5 },
  row: { marginBottom: 8 },
  rowInner: { flexDirection: 'row-reverse', alignItems: 'center', gap: 12 },
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
  error: { color: colors.error, textAlign: 'center', padding: 8, writingDirection: 'rtl' },
})

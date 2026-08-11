import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Linking,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { FilterChips } from '../components/FilterChips'
import { SectionHeader } from '../components/SectionHeader'
import { useAuth } from '../lib/auth'
import { fetchFeedItems, syncFeed, type MobileFeedItem } from '../lib/data'
import { colors } from '../lib/theme'

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toLocaleDateString('he-IL', { day: 'numeric', month: 'short' })
}

export default function UpdatesScreen() {
  const { token } = useAuth()

  const [items, setItems] = useState<MobileFeedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [categoryFilter, setCategoryFilter] = useState<string>('all')

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return
      mode === 'refresh' ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        setItems(await fetchFeedItems(token))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'טעינה נכשלה')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [token],
  )

  useEffect(() => {
    void load()
  }, [load])

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const item of items) {
      if (item.category?.trim()) set.add(item.category.trim())
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'he'))
  }, [items])

  const filterChips = useMemo(
    () => [
      { key: 'all', label: 'הכל' },
      ...categories.map((c) => ({ key: c, label: c })),
    ],
    [categories],
  )

  const visible = useMemo(() => {
    if (categoryFilter === 'all') return items
    return items.filter((i) => (i.category ?? '').trim() === categoryFilter)
  }, [items, categoryFilter])

  const onSync = async () => {
    if (!token || syncing) return
    setSyncing(true)
    setError(null)
    try {
      await syncFeed(token)
      await load('refresh')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'סנכרון נכשל')
    } finally {
      setSyncing(false)
    }
  }

  const openItem = (item: MobileFeedItem) => {
    if (!item.url) return
    void Linking.openURL(item.url).catch(() => setError('לא ניתן לפתוח את הקישור'))
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    )
  }

  return (
    <View style={styles.flex}>
      <SectionHeader
        title="עדכונים"
        style={styles.header}
        action={{
          label: syncing ? 'מסנכרן…' : 'סנכרן',
          onPress: () => void onSync(),
          disabled: syncing,
        }}
      />

      {filterChips.length > 1 ? (
        <FilterChips
          items={filterChips}
          selectedKey={categoryFilter}
          onSelect={setCategoryFilter}
          scrollable
        />
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={visible}
        keyExtractor={(item) => item.id}
        contentContainerStyle={visible.length === 0 ? styles.flexGrow : styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => void load('refresh')} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          <EmptyState
            icon="📰"
            text="אין עדכונים להצגה"
            hint="לחץ סנכרן כדי למשוך פריטים חדשים מהמקורות"
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => openItem(item)}
            disabled={!item.url}
            accessibilityRole="link"
            accessibilityLabel={item.title}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Card style={styles.card}>
              <Text style={styles.title} numberOfLines={2}>
                {item.title}
              </Text>
              <View style={styles.metaRow}>
                {item.category ? <Text style={styles.category}>{item.category}</Text> : null}
                {item.publishedAt ? (
                  <Text style={styles.date}>{fmtDate(item.publishedAt)}</Text>
                ) : null}
              </View>
              {item.summary ? (
                <Text style={styles.summary} numberOfLines={3}>
                  {item.summary}
                </Text>
              ) : null}
            </Card>
          </Pressable>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  flexGrow: { flexGrow: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  header: { paddingTop: 8 },
  list: { padding: 16, paddingTop: 4, gap: 10, paddingBottom: 32 },
  card: { marginBottom: 10 },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  metaRow: {
    flexDirection: 'row-reverse',
    gap: 8,
    marginTop: 6,
    alignItems: 'center',
  },
  category: {
    color: colors.accent,
    fontSize: 12,
    writingDirection: 'rtl',
  },
  date: { color: colors.textMuted, fontSize: 12 },
  summary: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 8,
  },
  pressed: { opacity: 0.75 },
  error: { color: colors.error, textAlign: 'center', writingDirection: 'rtl', padding: 12 },
})

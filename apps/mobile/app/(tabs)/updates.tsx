import { useFocusEffect } from 'expo-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { FilterChips } from '../../components/FilterChips'
import { useAuth } from '../../lib/auth'
import {
  fetchFeedDigest,
  fetchFeedItems,
  generateFeedDigest,
  syncFeed,
  type MobileFeedDigest,
  type MobileFeedItem,
} from '../../lib/data'
import {
  FEED_CATEGORIES,
  FEED_CATEGORY_KEY,
  categoryLabel,
  formatDigestMeta,
  formatSyncResult,
  isFeedCategory,
  type FeedCategory,
  type FeedListCategory,
} from '../../lib/feed'
import { storage } from '../../lib/storage'
import { colors } from '../../lib/theme'

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  return d.toLocaleDateString('he-IL', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function openUrl(url: string, onError: (message: string) => void) {
  void Linking.openURL(url).catch(() => onError('לא ניתן לפתוח את הקישור'))
}

export default function UpdatesScreen() {
  const { token } = useAuth()

  const [items, setItems] = useState<MobileFeedItem[]>([])
  const [digest, setDigest] = useState<MobileFeedDigest | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [summarizing, setSummarizing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [category, setCategory] = useState<FeedCategory>('all')
  const [categoryReady, setCategoryReady] = useState(false)
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hasLoaded = useRef(false)

  const showNotice = (message: string) => {
    setNotice(message)
    if (noticeTimer.current) clearTimeout(noticeTimer.current)
    noticeTimer.current = setTimeout(() => setNotice(null), 4000)
  }

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current)
    }
  }, [])

  useEffect(() => {
    void storage.getItem(FEED_CATEGORY_KEY).then((saved) => {
      if (isFeedCategory(saved)) setCategory(saved)
      setCategoryReady(true)
    })
  }, [])

  const listCategory: FeedListCategory | undefined = category === 'all' ? undefined : category

  const load = useCallback(
    async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
      if (!token) return
      if (mode === 'refresh') setRefreshing(true)
      else if (mode === 'initial') setLoading(true)
      setError(null)
      try {
        const [nextItems, nextDigest] = await Promise.all([
          fetchFeedItems(token, { category: listCategory, limit: 80 }),
          fetchFeedDigest(token, category),
        ])
        setItems(nextItems)
        setDigest(nextDigest)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'טעינה נכשלה')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [token, category, listCategory],
  )

  useEffect(() => {
    if (!categoryReady) return
    const mode = hasLoaded.current ? 'silent' : 'initial'
    hasLoaded.current = true
    void load(mode)
  }, [load, categoryReady])

  // Refetch quietly on every focus too (e.g. a sync run from elsewhere).
  useFocusEffect(
    useCallback(() => {
      if (!token || !hasLoaded.current) return
      void load('silent')
    }, [token, load]),
  )

  const setCategoryAndSave = (key: string) => {
    if (!isFeedCategory(key)) return
    setCategory(key)
    void storage.setItem(FEED_CATEGORY_KEY, key)
  }

  const onSync = async () => {
    if (!token || syncing) return
    setSyncing(true)
    setError(null)
    setNotice(null)
    try {
      const result = await syncFeed(token)
      showNotice(formatSyncResult(result))
      await load('silent')
    } catch {
      setError('לא הצלחנו לסנכרן. בדוק את החיבור ונסה שוב.')
    } finally {
      setSyncing(false)
    }
  }

  const onDigest = async () => {
    if (!token || summarizing || items.length === 0) return
    setSummarizing(true)
    setError(null)
    setNotice(null)
    try {
      setDigest(await generateFeedDigest(token, category))
      showNotice('התמצית מוכנה')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא הצלחתי ליצור תמצית. נסה שוב.')
    } finally {
      setSummarizing(false)
    }
  }

  const filterChips = useMemo(
    () => FEED_CATEGORIES.map((c) => ({ key: c.id, label: c.label })),
    [],
  )

  const digestHint = items.length === 0
    ? 'אין עדכונים לסכם. סנכרן מקורות קודם.'
    : 'לחץ על תמצית הפיד כדי לקבל סיכום ומה שכדאי לשים לב אליו.'

  const header = (
    <Card style={styles.digestCard}>
      <Text style={styles.digestTitle}>תמצית</Text>
      {digest ? (
        <Text style={styles.digestMeta}>{formatDigestMeta(digest, fmtDate)}</Text>
      ) : (
        <Text style={styles.digestMeta}>{digestHint}</Text>
      )}
      {summarizing ? (
        <Text style={[styles.digestBody, styles.digestLoading]}>קורא את כל העדכונים ומסכם…</Text>
      ) : null}
      {digest ? (
        <View style={[styles.digestBodyWrap, summarizing && styles.digestDimmed]}>
          <Text style={styles.digestSection}>TLDR</Text>
          <Text style={styles.digestBody}>{digest.tldr}</Text>
          {digest.watch.length > 0 ? (
            <View style={styles.watchWrap}>
              <Text style={styles.digestSection}>שים לב</Text>
              {digest.watch.map((row) => (
                <Pressable
                  key={row.link}
                  onPress={() => openUrl(row.link, setError)}
                  accessibilityRole="link"
                  accessibilityLabel={row.title}
                  style={({ pressed }) => [styles.watchRow, pressed && styles.pressed]}
                >
                  <Text style={styles.watchTitle}>{row.title}</Text>
                  <Text style={styles.watchWhy}>{row.why}</Text>
                  {row.sourceName ? (
                    <Text style={styles.watchSource}>{row.sourceName}</Text>
                  ) : null}
                </Pressable>
              ))}
            </View>
          ) : null}
        </View>
      ) : null}
    </Card>
  )

  if (loading || !categoryReady) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    )
  }

  return (
    <View style={styles.flex}>
      <View style={styles.actions}>
        <Pressable
          onPress={() => void onSync()}
          disabled={syncing}
          accessibilityRole="button"
          accessibilityLabel="סנכרן מקורות"
          accessibilityState={{ disabled: syncing, busy: syncing }}
          style={[styles.actionBtn, styles.actionPrimary, syncing && styles.actionDisabled]}
        >
          <Text style={styles.actionPrimaryText}>{syncing ? 'מסנכרן…' : 'סנכרן מקורות'}</Text>
        </Pressable>
        <Pressable
          onPress={() => void onDigest()}
          disabled={summarizing || items.length === 0}
          accessibilityRole="button"
          accessibilityLabel="תמצית הפיד"
          accessibilityState={{ disabled: summarizing || items.length === 0, busy: summarizing }}
          style={[
            styles.actionBtn,
            styles.actionGhost,
            (summarizing || items.length === 0) && styles.actionDisabled,
          ]}
        >
          <Text style={styles.actionGhostText}>
            {summarizing ? 'קורא את כל העדכונים…' : 'תמצית הפיד'}
          </Text>
        </Pressable>
      </View>

      {notice ? <Text style={styles.notice}>{notice}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FilterChips
        items={filterChips}
        selectedKey={category}
        onSelect={setCategoryAndSave}
      />

      <FlatList
        style={styles.flex}
        data={items}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        ListHeaderComponent={header}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            tintColor={colors.accent}
          />
        }
        ListEmptyComponent={
          <EmptyState
            icon="📰"
            text="אין פריטים בקטגוריה זו"
            hint="לחץ על סנכרן מקורות כדי למשוך עדכונים"
          />
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => item.link && openUrl(item.link, setError)}
            disabled={!item.link}
            accessibilityRole="link"
            accessibilityLabel={item.title}
            style={({ pressed }) => [pressed && styles.pressed]}
          >
            <Card style={styles.card}>
              <Text style={styles.title} numberOfLines={2}>
                {item.title}
              </Text>
              {item.summary ? (
                <Text style={styles.summary} numberOfLines={3}>
                  {item.summary}
                </Text>
              ) : null}
              <View style={styles.metaRow}>
                {item.category ? (
                  <Text style={styles.category}>{categoryLabel(item.category)}</Text>
                ) : null}
                {item.sourceName ? <Text style={styles.meta}>{item.sourceName}</Text> : null}
                {item.publishedAt ? (
                  <Text style={styles.meta}>{fmtDate(item.publishedAt)}</Text>
                ) : null}
              </View>
            </Card>
          </Pressable>
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  list: { flexGrow: 1, padding: 16, paddingTop: 8, gap: 10, paddingBottom: 32 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  actions: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 4,
  },
  actionBtn: {
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  actionPrimary: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  actionGhost: {
    backgroundColor: 'transparent',
    borderColor: colors.accent + '66',
  },
  actionDisabled: { opacity: 0.45 },
  actionPrimaryText: { color: colors.bg, fontSize: 14, fontWeight: '700', writingDirection: 'rtl' },
  actionGhostText: { color: colors.accent, fontSize: 14, fontWeight: '600', writingDirection: 'rtl' },
  notice: {
    color: colors.success,
    textAlign: 'center',
    writingDirection: 'rtl',
    paddingHorizontal: 16,
    paddingTop: 8,
    fontSize: 13,
  },
  error: {
    color: colors.error,
    textAlign: 'center',
    writingDirection: 'rtl',
    paddingHorizontal: 16,
    paddingTop: 8,
    fontSize: 13,
  },
  digestCard: { marginBottom: 12 },
  digestTitle: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  digestMeta: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 4,
  },
  digestBodyWrap: { marginTop: 12, gap: 8 },
  digestLoading: { marginTop: 12, color: colors.textMuted },
  digestDimmed: { opacity: 0.55 },
  digestSection: {
    color: colors.accent,
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.6,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  digestBody: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  watchWrap: { gap: 8, marginTop: 4 },
  watchRow: {
    backgroundColor: colors.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    gap: 4,
  },
  watchTitle: {
    color: colors.text,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  watchWhy: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  watchSource: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'right',
    writingDirection: 'rtl',
    opacity: 0.8,
  },
  card: { marginBottom: 10 },
  title: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  summary: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 8,
  },
  metaRow: {
    flexDirection: 'row-reverse',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
    alignItems: 'center',
  },
  category: {
    color: colors.accent,
    fontSize: 12,
    writingDirection: 'rtl',
  },
  meta: { color: colors.textMuted, fontSize: 12, writingDirection: 'rtl' },
  pressed: { opacity: 0.75 },
})

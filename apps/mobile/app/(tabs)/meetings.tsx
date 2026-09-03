import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { FilterChips } from '../../components/FilterChips'
import { useAuth } from '../../lib/auth'
import {
  createMeeting,
  fetchMeetings,
  syncMeetingsFromCalendar,
  type MobileMeeting,
} from '../../lib/data'
import { colors } from '../../lib/theme'

function isPast(date: string, time: string): boolean {
  const [h = 0, m = 0] = (time || '00:00').split(':').map(Number)
  const dt = new Date(date + 'T00:00:00')
  dt.setHours(h, m, 0, 0)
  return dt < new Date()
}

function todayDateInput(): string {
  const d = new Date()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${month}-${day}`
}

export default function MeetingsScreen() {
  const { token } = useAuth()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const { focus } = useLocalSearchParams<{ focus?: string }>()
  const listRef = useRef<FlatList<MobileMeeting>>(null)

  const [meetings, setMeetings] = useState<MobileMeeting[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'upcoming' | 'past'>('upcoming')
  const [recurringOnly, setRecurringOnly] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMessage, setSyncMessage] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return
      mode === 'refresh' ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        setMeetings(await fetchMeetings(token))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'טעינת הפגישות נכשלה')
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

  const upcoming = useMemo(() => {
    return meetings
      .filter((m) => !isPast(m.date, m.time))
      .filter((m) => (recurringOnly ? m.recurring : true))
      .sort(
        (a, b) =>
          new Date(a.date + 'T' + (a.time || '00:00')).getTime() -
          new Date(b.date + 'T' + (b.time || '00:00')).getTime(),
      )
  }, [meetings, recurringOnly])

  const past = useMemo(() => {
    return meetings
      .filter((m) => isPast(m.date, m.time))
      .filter((m) => (recurringOnly ? m.recurring : true))
      .sort(
        (a, b) =>
          new Date(b.date + 'T' + (b.time || '00:00')).getTime() -
          new Date(a.date + 'T' + (a.time || '00:00')).getTime(),
      )
  }, [meetings, recurringOnly])

  const displayedMeetings = activeTab === 'upcoming' ? upcoming : past

  useEffect(() => {
    if (!focus || upcoming.length === 0) return
    const idx = upcoming.findIndex((m) => m.id === focus)
    if (idx >= 0) {
      setTimeout(() => {
        listRef.current?.scrollToIndex({ index: idx, animated: true, viewPosition: 0.3 })
      }, 300)
    }
  }, [focus, upcoming])

  const onSync = async () => {
    if (!token || syncing) return
    setSyncing(true)
    setSyncMessage(null)
    setError(null)
    try {
      const res = await syncMeetingsFromCalendar(token)
      setSyncMessage(`סונכרן: ${res.created} חדשות · ${res.updated} עודכנו · ${res.deleted} נמחקו`)
      await load('refresh')
    } catch {
      setSyncMessage('הסנכרון נכשל')
    } finally {
      setSyncing(false)
    }
  }

  const onCreate = async () => {
    if (!token || creating) return
    setCreating(true)
    setError(null)
    try {
      const meeting = await createMeeting(token, {
        title: 'פגישה חדשה',
        date: todayDateInput(),
        time: '09:00',
      })
      router.push(`/meeting/${meeting.id}` as Href)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'יצירה נכשלה')
    } finally {
      setCreating(false)
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <View style={styles.flex}>
      <View style={styles.actionRow}>
        <Pressable
          onPress={() => void onSync()}
          disabled={syncing}
          accessibilityRole="button"
          accessibilityLabel="סנכרן מיומן"
          style={[styles.syncBtn, syncing && styles.syncBtnDisabled]}
        >
          {syncing ? <ActivityIndicator size="small" color={colors.accent} /> : null}
          <Text style={styles.syncBtnText}>{syncing ? 'מסנכרן…' : 'סנכרן מיומן'}</Text>
        </Pressable>
      </View>

      {syncMessage ? <Text style={styles.notice}>{syncMessage}</Text> : null}

      {/* Tab switcher */}
      <View style={styles.tabRow}>
        <Pressable 
          style={[styles.tab, activeTab === 'upcoming' && styles.tabActive]}
          onPress={() => setActiveTab('upcoming')}
          accessibilityRole="button"
          accessibilityLabel="הצג פגישות קרובות"
          accessibilityState={{ selected: activeTab === 'upcoming' }}
        >
          <Text style={[styles.tabText, activeTab === 'upcoming' && styles.tabTextActive]}>
            קרובות {upcoming.length > 0 && `(${upcoming.length})`}
          </Text>
        </Pressable>
        <Pressable 
          style={[styles.tab, activeTab === 'past' && styles.tabActive]}
          onPress={() => setActiveTab('past')}
          accessibilityRole="button"
          accessibilityLabel="הצג פגישות שעברו"
          accessibilityState={{ selected: activeTab === 'past' }}
        >
          <Text style={[styles.tabText, activeTab === 'past' && styles.tabTextActive]}>
            עברו {past.length > 0 && `(${past.length})`}
          </Text>
        </Pressable>
      </View>

      <FilterChips
        items={[
          { key: 'all', label: 'הכל' },
          { key: 'recurring', label: '↻ חוזרות' },
        ]}
        selectedKey={recurringOnly ? 'recurring' : 'all'}
        onSelect={(key) => setRecurringOnly(key === 'recurring')}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        ref={listRef}
        data={displayedMeetings}
        keyExtractor={(m) => m.id}
        contentContainerStyle={[styles.list, { paddingBottom: 88 + insets.bottom }]}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.accent} />
        }
        onScrollToIndexFailed={(info) => {
          setTimeout(() => {
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: true })
          }, 100)
        }}
        ListEmptyComponent={
          <EmptyState
            icon="📅"
            text={activeTab === 'upcoming' 
              ? (recurringOnly ? 'אין פגישות חוזרות קרובות' : 'אין פגישות קרובות')
              : (recurringOnly ? 'אין פגישות חוזרות קודמות' : 'אין פגישות קודמות')
            }
          />
        }
        renderItem={({ item }) => {
          const highlighted = focus === item.id
          return (
            <Card
              style={[styles.card, highlighted && styles.cardFocused]}
              onPress={() => router.push(`/meeting/${item.id}` as Href)}
              accessibilityLabel={`פגישה ${item.title}`}
            >
              <View style={styles.cardHeader}>
                <Text style={styles.title}>{item.title}</Text>
                {item.recurring ? (
                  <View style={styles.recurringBadge}>
                    <Text style={styles.recurringText}>↻</Text>
                  </View>
                ) : null}
              </View>
              <Text style={styles.meta}>
                {new Date(item.date + 'T00:00:00').toLocaleDateString('he-IL')} · {item.time}
              </Text>
              {(item.peopleIds?.length ?? 0) > 0 && (
                <Text style={styles.people}>{item.peopleIds!.length} משתתפים</Text>
              )}
            </Card>
          )
        }}
      />

      <Pressable
        style={[styles.fab, { bottom: 16 + insets.bottom }]}
        onPress={() => void onCreate()}
        disabled={creating}
        accessibilityRole="button"
        accessibilityLabel="הוסף פגישה"
      >
        <Text style={styles.fabPlus}>{creating ? '…' : '+'}</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  actionRow: { flexDirection: 'row', paddingHorizontal: 16, paddingTop: 12 },
  syncBtn: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    gap: 8,
    minHeight: 44,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  syncBtnDisabled: { opacity: 0.6 },
  syncBtnText: { color: colors.accent, fontSize: 14, fontWeight: '600', writingDirection: 'rtl' },
  notice: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    writingDirection: 'rtl',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  tabRow: {
    flexDirection: 'row-reverse',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  tab: {
    flex: 1,
    maxWidth: 180,
    minHeight: 44,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabActive: {
    backgroundColor: colors.accent,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: 14,
    fontWeight: '500',
    writingDirection: 'rtl',
  },
  tabTextActive: {
    color: colors.bg,
    fontWeight: '600',
  },
  list: { paddingHorizontal: 16, flexGrow: 1 },
  card: { padding: 16, marginBottom: 10 },
  cardFocused: { borderColor: colors.accent, borderWidth: 2 },
  cardHeader: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  title: { color: colors.text, fontSize: 16, fontWeight: '600', flex: 1, textAlign: 'right', writingDirection: 'rtl' },
  recurringBadge: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: colors.accent + '22',
    alignItems: 'center',
    justifyContent: 'center',
  },
  recurringText: { color: colors.accent, fontSize: 14 },
  meta: { color: colors.textMuted, fontSize: 13, textAlign: 'right', marginTop: 6 },
  people: { color: colors.textMuted, fontSize: 12, textAlign: 'right', marginTop: 4 },
  error: { color: colors.error, textAlign: 'center', padding: 8, writingDirection: 'rtl' },
  fab: {
    position: 'absolute',
    left: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
  },
  fabPlus: { color: colors.bg, fontSize: 32, fontWeight: '400', lineHeight: 34 },
})

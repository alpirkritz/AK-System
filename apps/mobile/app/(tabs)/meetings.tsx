import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Card } from '../../components/Card'
import { EmptyState } from '../../components/EmptyState'
import { FilterChips } from '../../components/FilterChips'
import { useAuth } from '../../lib/auth'
import { fetchMeetings, type MobileMeeting } from '../../lib/data'
import { colors } from '../../lib/theme'

function isPast(date: string, time: string): boolean {
  const [h = 0, m = 0] = (time || '00:00').split(':').map(Number)
  const dt = new Date(date + 'T00:00:00')
  dt.setHours(h, m, 0, 0)
  return dt < new Date()
}

export default function MeetingsScreen() {
  const { token } = useAuth()
  const [meetings, setMeetings] = useState<MobileMeeting[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recurringOnly, setRecurringOnly] = useState(false)

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
    load()
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

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <View style={styles.flex}>
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
        data={upcoming}
        keyExtractor={(m) => m.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          <EmptyState
            icon="📅"
            text={recurringOnly ? 'אין פגישות חוזרות' : 'אין פגישות קרובות'}
          />
        }
        renderItem={({ item }) => (
          <Card style={styles.card}>
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
        )}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  list: { paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 },
  card: { padding: 16, marginBottom: 10 },
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
})

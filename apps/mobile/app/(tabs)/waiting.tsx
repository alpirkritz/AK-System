import { useFocusEffect } from 'expo-router'
import { useCallback, useMemo, useRef, useState } from 'react'
import { ActivityIndicator, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native'
import { Card } from '../../components/Card'
import { FilterChips } from '../../components/FilterChips'
import { WaitingListView, withoutItem } from '../../components/WaitingList'
import { useAuth } from '../../lib/auth'
import { fetchWaiting, type MobileWaitingBuckets } from '../../lib/data'
import { colors } from '../../lib/theme'
import { dueNow, flattenWaiting, groupByPerson, type WaitingView } from '../../lib/waiting'

const VIEWS = [
  { key: 'today', label: 'היום' },
  { key: 'person', label: 'לפי אדם' },
  { key: 'time', label: 'לפי זמן' },
]

export default function WaitingScreen() {
  const { token } = useAuth()
  const [buckets, setBuckets] = useState<MobileWaitingBuckets | null>(null)
  const [view, setView] = useState<WaitingView>('today')
  const [personId, setPersonId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const hasLoadedOnce = useRef(false)

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return
      mode === 'refresh' ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        setBuckets(await fetchWaiting(token))
        hasLoadedOnce.current = true
      } catch (err) {
        setError(err instanceof Error ? err.message : 'טעינה נכשלה')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [token],
  )

  useFocusEffect(
    useCallback(() => {
      void load(hasLoadedOnce.current ? 'refresh' : 'initial')
    }, [load]),
  )

  const all = useMemo(() => (buckets ? flattenWaiting(buckets) : []), [buckets])
  const people = useMemo(() => groupByPerson(all), [all])
  const shown = useMemo<MobileWaitingBuckets | null>(() => {
    if (!buckets) return null
    if (!personId) return buckets
    const only = (l: MobileWaitingBuckets['overdue']) => l.filter((i) => i.personId === personId)
    return {
      overdue: only(buckets.overdue), today: only(buckets.today), thisWeek: only(buckets.thisWeek),
      later: only(buckets.later), noDate: only(buckets.noDate),
    }
  }, [buckets, personId])

  const personChips = useMemo(
    () => [{ key: 'all', label: 'כולם' }, ...people.map((p) => ({ key: p.personId, label: p.personName }))],
    [people],
  )

  return (
    <View style={styles.flex}>
      <View style={styles.chips}>
        <FilterChips items={VIEWS} selectedKey={view} onSelect={(k) => setView(k as WaitingView)} />
        {people.length > 1 ? (
          <FilterChips
            scrollable
            items={personChips}
            selectedKey={personId ?? 'all'}
            onSelect={(k) => setPersonId(k === 'all' || k === personId ? null : k)}
          />
        ) : null}
      </View>
      {loading ? (
        <ActivityIndicator color={colors.accent} style={styles.loader} />
      ) : error ? (
        <Text style={styles.error}>{error}</Text>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.accent} />
          }
        >
          {!shown || all.length === 0 ? (
            <Text style={styles.empty}>אף אחד לא חייב לך משהו כרגע</Text>
          ) : view === 'today' && dueNow(shown).length === 0 ? (
            <Text style={styles.empty}>אף אחד לא חייב לך משהו להיום</Text>
          ) : (
            <Card>
              <WaitingListView
                buckets={shown}
                view={view}
                onDone={(item) => setBuckets((b) => (b ? withoutItem(b, item) : b))}
              />
            </Card>
          )}
        </ScrollView>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.bg },
  chips: { paddingTop: 8 },
  loader: { marginTop: 32 },
  error: { color: colors.error, textAlign: 'center', marginTop: 32 },
  list: { padding: 12, gap: 10 },
  empty: { color: colors.textMuted, textAlign: 'center', marginTop: 32, writingDirection: 'rtl' },
})

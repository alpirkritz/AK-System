import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native'
import { Card } from '../components/Card'
import { EmptyState } from '../components/EmptyState'
import { SegmentControl } from '../components/SegmentControl'
import { useAuth } from '../lib/auth'
import {
  fetchCalendarConflicts,
  fetchCalendarEvents,
  type MobileCalEvent,
} from '../lib/data'
import { colors } from '../lib/theme'

type RangeKey = 'day' | '3days'

function toDateInput(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date)
  d.setDate(d.getDate() + days)
  return d
}

function formatEventTime(ev: MobileCalEvent): string {
  if (ev.isAllDay) return 'כל היום'
  const start = new Date(ev.start)
  const end = new Date(ev.end)
  const fmt = (d: Date) =>
    d.toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit', hour12: false })
  return `${fmt(start)} – ${fmt(end)}`
}

function formatDayHeader(iso: string): string {
  const d = new Date(iso + 'T00:00:00')
  return d.toLocaleDateString('he-IL', { weekday: 'long', day: 'numeric', month: 'long' })
}

type AgendaItem = { kind: 'header'; key: string; label: string } | { kind: 'event'; key: string; event: MobileCalEvent }

export default function CalendarScreen() {
  const { token } = useAuth()
  const [range, setRange] = useState<RangeKey>('day')
  const [events, setEvents] = useState<MobileCalEvent[]>([])
  const [conflictIds, setConflictIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { startDate, endDate } = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const days = range === 'day' ? 1 : 3
    const end = addDays(today, days - 1)
    return { startDate: toDateInput(today), endDate: toDateInput(end) }
  }, [range])

  const load = useCallback(
    async (mode: 'initial' | 'refresh' = 'initial') => {
      if (!token) return
      mode === 'refresh' ? setRefreshing(true) : setLoading(true)
      setError(null)
      try {
        const [evs, conflicts] = await Promise.all([
          fetchCalendarEvents(token, startDate, endDate),
          fetchCalendarConflicts(token, startDate, endDate).catch(() => []),
        ])
        setEvents(
          evs
            .filter((e) => e.status !== 'cancelled')
            .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime()),
        )
        const ids = new Set<string>()
        for (const c of conflicts) {
          const pair = c as { eventA?: { id: string }; eventB?: { id: string } }
          if (pair.eventA?.id) ids.add(pair.eventA.id)
          if (pair.eventB?.id) ids.add(pair.eventB.id)
        }
        setConflictIds(ids)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'טעינת היומן נכשלה')
      } finally {
        setLoading(false)
        setRefreshing(false)
      }
    },
    [token, startDate, endDate],
  )

  useEffect(() => {
    void load()
  }, [load])

  const agenda = useMemo((): AgendaItem[] => {
    const items: AgendaItem[] = []
    let lastDay = ''
    for (const ev of events) {
      const day = ev.start.slice(0, 10)
      if (day !== lastDay) {
        lastDay = day
        items.push({ kind: 'header', key: `h-${day}`, label: formatDayHeader(day) })
      }
      items.push({ kind: 'event', key: ev.id, event: ev })
    }
    return items
  }, [events])

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <View style={styles.flex}>
      <View style={styles.segmentWrap}>
        <SegmentControl
          segments={[
            { key: 'day', label: 'היום' },
            { key: '3days', label: '3 ימים' },
          ]}
          selected={range}
          onSelect={(k) => setRange(k as RangeKey)}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <FlatList
        data={agenda}
        keyExtractor={(item) => item.key}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => load('refresh')} tintColor={colors.accent} />
        }
        ListEmptyComponent={
          <EmptyState icon="📅" text="אין אירועים בטווח שנבחר" hint="נסה לסנכרן את היומן מהמחשב" />
        }
        renderItem={({ item }) => {
          if (item.kind === 'header') {
            return <Text style={styles.dayHeader}>{item.label}</Text>
          }
          const ev = item.event
          const isConflict = conflictIds.has(ev.id)
          return (
            <Card
              style={[styles.eventCard, isConflict && styles.conflictCard]}
              accessibilityLabel={`${ev.title}, ${formatEventTime(ev)}${isConflict ? ', התנגשות' : ''}`}
            >
              <Text style={styles.eventTitle}>{ev.title}</Text>
              <Text style={styles.eventTime}>{formatEventTime(ev)}</Text>
              {isConflict ? <Text style={styles.conflictBadge}>⚠ התנגשות</Text> : null}
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
  segmentWrap: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  list: { paddingHorizontal: 16, paddingBottom: 24, flexGrow: 1 },
  dayHeader: {
    color: colors.text,
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 16,
    marginBottom: 8,
  },
  eventCard: { marginBottom: 8 },
  conflictCard: { borderColor: colors.coral, borderWidth: 2 },
  eventTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  eventTime: { color: colors.textMuted, fontSize: 13, textAlign: 'right', marginTop: 4 },
  conflictBadge: { color: colors.coral, fontSize: 12, textAlign: 'right', marginTop: 6, fontWeight: '600' },
  error: { color: colors.error, textAlign: 'center', padding: 8, writingDirection: 'rtl' },
})

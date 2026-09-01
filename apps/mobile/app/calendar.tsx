import { useLocalSearchParams } from 'expo-router'
import * as WebBrowser from 'expo-web-browser'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  FlatList,
  Pressable,
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
  fetchGoogleCalendarAccounts,
  startGoogleCalendarOAuth,
  type GoogleAccountStatus,
  type MobileCalEvent,
} from '../lib/data'
import { colors } from '../lib/theme'

const OAUTH_REDIRECT = 'helm://calendar'

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

function oauthMessageFromParams(params: {
  google_connected?: string
  google_error?: string
  email?: string
}): string | null {
  if (params.google_connected === '1') {
    return params.email ? `חשבון ${params.email} חובר` : 'היומן חובר'
  }
  if (params.google_error) {
    const messages: Record<string, string> = {
      no_refresh_token: 'Google לא החזיר הרשאה קבועה — נסה שוב',
      oauth_failed: 'שגיאת חיבור ליומן — נסה שוב',
      no_code: 'החיבור בוטל',
    }
    return messages[params.google_error] || 'שגיאת חיבור ליומן'
  }
  return null
}

type AgendaItem = { kind: 'header'; key: string; label: string } | { kind: 'event'; key: string; event: MobileCalEvent }

export default function CalendarScreen() {
  const { token } = useAuth()
  const oauthParams = useLocalSearchParams<{
    google_connected?: string
    google_error?: string
    email?: string
  }>()
  const [range, setRange] = useState<RangeKey>('day')
  const [events, setEvents] = useState<MobileCalEvent[]>([])
  const [accounts, setAccounts] = useState<GoogleAccountStatus[]>([])
  const [conflictIds, setConflictIds] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [connecting, setConnecting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [oauthMsg, setOauthMsg] = useState<string | null>(null)

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
        const [evs, conflicts, googleAccounts] = await Promise.all([
          fetchCalendarEvents(token, startDate, endDate),
          fetchCalendarConflicts(token, startDate, endDate).catch(() => []),
          fetchGoogleCalendarAccounts(token).catch(() => [] as GoogleAccountStatus[]),
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
        setAccounts(googleAccounts)
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

  useEffect(() => {
    void WebBrowser.warmUpAsync()
    return () => {
      void WebBrowser.coolDownAsync()
    }
  }, [])

  useEffect(() => {
    const msg = oauthMessageFromParams(oauthParams)
    if (msg) setOauthMsg(msg)
  }, [oauthParams])

  const onConnect = async () => {
    if (!token || connecting) return
    setConnecting(true)
    setError(null)
    try {
      const { authUrl } = await startGoogleCalendarOAuth(token)
      const result = await WebBrowser.openAuthSessionAsync(authUrl, OAUTH_REDIRECT)
      if (result.type === 'success' && result.url) {
        const parsed = new URL(result.url)
        const msg = oauthMessageFromParams({
          google_connected: parsed.searchParams.get('google_connected') ?? undefined,
          google_error: parsed.searchParams.get('google_error') ?? undefined,
          email: parsed.searchParams.get('email') ?? undefined,
        })
        if (msg) setOauthMsg(msg)
      }
      await load('refresh')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שגיאת חיבור ליומן')
    } finally {
      setConnecting(false)
    }
  }

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

  const disconnected = accounts.length === 0
  const connectLabel = disconnected ? 'חבר יומן Google' : 'חבר חשבון נוסף'

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <View style={styles.flex}>
      <View style={styles.connectCard}>
        {accounts.length > 0 ? (
          accounts.map((account) => (
            <View key={account.email} style={styles.accountRow}>
              <Text style={styles.accountEmail}>{account.email}</Text>
              <Text
                style={[
                  styles.accountStatus,
                  account.status === 'error' ? styles.accountError : styles.accountOk,
                ]}
              >
                {account.status === 'error' ? 'שגיאת חיבור' : 'פעיל'}
              </Text>
            </View>
          ))
        ) : (
          <Text style={styles.disconnectedHint}>אין יומן מחובר</Text>
        )}
        <Pressable
          style={[styles.connectBtn, connecting && styles.connectBtnDisabled]}
          onPress={() => void onConnect()}
          disabled={connecting}
          accessibilityRole="button"
          accessibilityLabel={connectLabel}
        >
          {connecting ? (
            <ActivityIndicator color={colors.bg} />
          ) : (
            <Text style={styles.connectBtnText}>{connectLabel}</Text>
          )}
        </Pressable>
      </View>

      {oauthMsg ? <Text style={styles.oauthMsg}>{oauthMsg}</Text> : null}

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
          <EmptyState
            icon="📅"
            text={disconnected ? 'אין יומן מחובר' : 'אין אירועים בטווח שנבחר'}
            hint={disconnected ? 'חבר חשבון Google כדי לראות אירועים' : undefined}
          />
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
  connectCard: {
    marginHorizontal: 16,
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    gap: 10,
  },
  accountRow: {
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  accountEmail: {
    color: colors.text,
    fontSize: 14,
    flex: 1,
    textAlign: 'right',
  },
  accountStatus: { fontSize: 12, fontWeight: '600' },
  accountOk: { color: colors.success },
  accountError: { color: colors.error },
  disconnectedHint: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  connectBtn: {
    backgroundColor: colors.accent,
    borderRadius: 12,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
  },
  connectBtnDisabled: { opacity: 0.5 },
  connectBtnText: {
    color: colors.bg,
    fontSize: 15,
    fontWeight: '600',
    writingDirection: 'rtl',
  },
  oauthMsg: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    writingDirection: 'rtl',
  },
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

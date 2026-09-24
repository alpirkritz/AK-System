import { useCallback, useEffect, useState } from 'react'
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../lib/theme'
import { createTrpcClient } from '../lib/trpc'
import { useAuth } from '../lib/auth'

type RosterRow = { id: string; displayName: string; email: string | null; personId: string | null }
type Exception = { id: string; rosterId: string | null; displayName: string }
type Circle = {
  series: { rosterSavedAt: string | null }
  roster: RosterRow[]
  rosterCount: number
  calendarParticipants: unknown[]
  recommendation: string | null
  diff: { newInCalendar: { name: string }[]; missingFromCalendar: { displayName: string }[] } | null
  warmth: { trend: 'warming' | 'cooling' | 'stable' | null }
}
type Attendance = { absent: Exception[]; guests: Exception[]; expectedCount: number } | null

const PREVIEW = 8

/** Mobile circle: save roster from the calendar, apply diffs, mark absent, follow. */
export function CircleSection({ seriesId, meetingId }: { seriesId: string; meetingId: string }) {
  const { token } = useAuth()
  const [circle, setCircle] = useState<Circle | null>(null)
  const [attendance, setAttendance] = useState<Attendance>(null)
  const [busy, setBusy] = useState(false)
  const [expanded, setExpanded] = useState(false)

  const load = useCallback(async () => {
    if (!token) return
    const client = createTrpcClient(token)
    const [c, a] = await Promise.all([
      client.circles.get.query({ seriesId }) as Promise<Circle>,
      client.circles.attendance.query({ meetingId }) as Promise<Attendance>,
    ])
    setCircle(c)
    setAttendance(a)
  }, [token, seriesId, meetingId])

  useEffect(() => {
    void load().catch(() => setCircle(null))
  }, [load])

  const run = async (fn: (client: ReturnType<typeof createTrpcClient>) => Promise<unknown>) => {
    if (!token) return
    setBusy(true)
    try {
      await fn(createTrpcClient(token))
      await load()
    } finally {
      setBusy(false)
    }
  }

  if (!circle) return null
  const saved = !!circle.series.rosterSavedAt
  const absentByRoster = new Map((attendance?.absent ?? []).map((e) => [e.rosterId, e.id]))
  const rows = expanded ? circle.roster : circle.roster.slice(0, PREVIEW)

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>חוג</Text>
        {saved ? <Text style={styles.pill}>{circle.rosterCount} בחוג</Text> : null}
        {saved && attendance && attendance.expectedCount !== circle.rosterCount ? (
          <Text style={styles.muted}>{attendance.expectedCount} צפויים היום</Text>
        ) : null}
        {circle.warmth.trend === 'cooling' ? <Text style={[styles.muted, styles.cooling]}>↓ הפגישה מתקררת</Text> : null}
        {circle.warmth.trend === 'warming' ? <Text style={[styles.muted, styles.warming]}>↑ הפגישה מתחממת</Text> : null}
        {busy ? <ActivityIndicator size="small" color={colors.accent} /> : null}
      </View>

      {!saved ? (
        <>
          <Text style={styles.body}>
            {circle.calendarParticipants.length > 0
              ? `${circle.calendarParticipants.length} משתתפים ביומן. שמור אותם פעם אחת כחוג.`
              : 'אין משתתפים ביומן לפגישה הזו עדיין.'}
          </Text>
          <Pressable
            accessibilityRole="button"
            disabled={busy || circle.calendarParticipants.length === 0}
            onPress={() => void run((c) => c.circles.saveFromCalendar.mutate({ seriesId }))}
            style={[styles.primaryBtn, circle.calendarParticipants.length === 0 && styles.disabled]}
          >
            <Text style={styles.primaryText}>שמור חוג מהיומן</Text>
          </Pressable>
        </>
      ) : (
        <>
          {circle.recommendation ? <Text style={styles.recommendation}>{circle.recommendation}</Text> : null}

          {circle.diff ? (
            <View style={styles.diff}>
              <Text style={styles.body}>
                {[
                  circle.diff.newInCalendar.length > 0 && `${circle.diff.newInCalendar.length} חדשים ביומן`,
                  circle.diff.missingFromCalendar.length > 0 && `${circle.diff.missingFromCalendar.length} כבר לא מוזמנים`,
                ].filter(Boolean).join(' · ')}
              </Text>
              <View style={styles.actions}>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run((c) => c.circles.applyCalendarDiff.mutate({ seriesId }))} style={styles.secondaryBtn}>
                  <Text style={styles.secondaryText}>עדכן מהיומן</Text>
                </Pressable>
                <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run((c) => c.circles.dismissCalendarDiff.mutate({ seriesId }))} style={styles.ghostBtn}>
                  <Text style={styles.muted}>השאר כך</Text>
                </Pressable>
              </View>
            </View>
          ) : null}

          {rows.map((r) => {
            const absentId = absentByRoster.get(r.id)
            return (
              <View key={r.id} style={styles.row}>
                <Text style={[styles.name, absentId ? styles.absent : null]} numberOfLines={1}>{r.displayName}</Text>
                {r.personId ? (
                  <Text style={styles.pill}>במעקב</Text>
                ) : (
                  <Pressable accessibilityRole="button" disabled={busy} onPress={() => void run((c) => c.circles.follow.mutate({ rosterId: r.id }))} style={styles.ghostBtn}>
                    <Text style={styles.link}>עקוב</Text>
                  </Pressable>
                )}
                <Pressable
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() =>
                    void run((c) =>
                      absentId
                        ? c.circles.removeException.mutate({ exceptionId: absentId })
                        : c.circles.markAbsent.mutate({ meetingId, rosterId: r.id }),
                    )
                  }
                  style={styles.ghostBtn}
                >
                  <Text style={styles.link}>{absentId ? 'מגיע' : 'חסר היום'}</Text>
                </Pressable>
              </View>
            )
          })}
          {(attendance?.guests ?? []).map((g) => (
            <View key={g.id} style={styles.row}>
              <Text style={styles.name} numberOfLines={1}>{g.displayName}</Text>
              <Text style={styles.pill}>אורח היום</Text>
            </View>
          ))}
          {circle.roster.length > PREVIEW ? (
            <Pressable accessibilityRole="button" onPress={() => setExpanded((v) => !v)} style={styles.ghostBtn}>
              <Text style={styles.link}>{expanded ? 'הצג פחות' : `הצג את כל ה-${circle.roster.length}`}</Text>
            </Pressable>
          ) : null}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    marginTop: 16,
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 8,
  },
  header: { flexDirection: 'row-reverse', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  title: { color: colors.textMuted, fontSize: 13, fontWeight: '600', writingDirection: 'rtl' },
  pill: {
    color: colors.text,
    fontSize: 12,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 2,
    overflow: 'hidden',
  },
  muted: { color: colors.textMuted, fontSize: 12, writingDirection: 'rtl' },
  cooling: { color: '#facc15' },
  warming: { color: colors.success },
  body: { color: colors.text, fontSize: 14, textAlign: 'right', writingDirection: 'rtl' },
  recommendation: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'right',
    writingDirection: 'rtl',
    borderRightWidth: 3,
    borderRightColor: colors.accent,
    paddingRight: 8,
  },
  diff: { backgroundColor: colors.surface, borderRadius: 10, padding: 10, gap: 8 },
  actions: { flexDirection: 'row-reverse', gap: 8 },
  row: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, minHeight: 40 },
  name: { flex: 1, color: colors.text, fontSize: 14, textAlign: 'right', writingDirection: 'rtl' },
  absent: { color: colors.textMuted, textDecorationLine: 'line-through' },
  link: { color: colors.accent, fontSize: 13, writingDirection: 'rtl' },
  primaryBtn: {
    minHeight: 44,
    borderRadius: 10,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryText: { color: colors.bg, fontSize: 15, fontWeight: '600', writingDirection: 'rtl' },
  secondaryBtn: {
    minHeight: 40,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryText: { color: colors.accent, fontSize: 13, writingDirection: 'rtl' },
  ghostBtn: { minHeight: 40, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center' },
  disabled: { opacity: 0.4 },
})

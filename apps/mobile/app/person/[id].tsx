import { useCallback, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Linking,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Pressable } from 'react-native'
import { useLocalSearchParams, useRouter, type Href } from 'expo-router'
import { FormSheetScaffold } from '../../components/FormSheetScaffold'
import { useAuth } from '../../lib/auth'
import {
  deletePerson,
  dismissPersonTrait,
  fetchPerson,
  fetchPersonContext,
  fetchPersonRelated,
  fetchPersonTraitDetail,
  restorePersonTrait,
  setCaptureWhatsapp,
  updatePerson,
  writePersonTraits,
  type MobilePersonContext,
  type MobileTraitDetail,
  type MobileTraitSummary,
  type MobileWarmthPoint,
} from '../../lib/data'
import { colors } from '../../lib/theme'
import { formatSentiment, WARMTH_TREND_LABEL } from '../../lib/warmth-format'

function shortDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getDate()}.${d.getMonth() + 1}`
}

const SOURCE_LABEL: Record<string, string> = { meeting_analysis: 'פגישה', whatsapp_dm_summary: 'וואטסאפ', email_thread: 'מייל' }

function traitClause(label: string, line: string): string {
  return line.startsWith(label) ? line.slice(label.length).trim() : line
}

function jerusalemDay(iso: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', day: 'numeric', month: 'numeric' }).formatToParts(new Date(iso))
  return `${Number(parts.find((p) => p.type === 'day')?.value)}.${Number(parts.find((p) => p.type === 'month')?.value)}`
}

function shortDay(isoDate: string): string {
  const [, m, d] = isoDate.slice(0, 10).split('-')
  return d && m ? `${Number(d)}.${Number(m)}` : isoDate
}

function TraitsBlock({
  token,
  personId,
  summary,
  onChange,
  onOpen,
}: {
  token: string
  personId: string
  summary: MobileTraitSummary
  onChange: (next: MobileTraitSummary) => void
  onOpen: (href: string) => void
}) {
  const [writing, setWriting] = useState(false)
  const [open, setOpen] = useState(false)
  const [detail, setDetail] = useState<MobileTraitDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<string | null>(null)

  useEffect(() => {
    if (!undo) return
    const timer = setTimeout(() => setUndo(null), 5000)
    return () => clearTimeout(timer)
  }, [undo])

  const run = async () => {
    setWriting(true)
    setError(null)
    try {
      onChange(await writePersonTraits(token, personId))
      if (open) setDetail(await fetchPersonTraitDetail(token, personId))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'לא הצלחנו לנתח. התכונות הקודמות נשמרו. נסה שוב.')
    } finally {
      setWriting(false)
    }
  }

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && !detail) {
      try { setDetail(await fetchPersonTraitDetail(token, personId)) } catch { setError('לא הצלחנו לטעון את הפירוט.') }
    }
  }

  if (!summary.hasSources && summary.traits.length === 0) return <Text style={styles.contextMuted}>אין עדיין שיחות לנתח.</Text>

  return (
    <View style={styles.contextCard}>
      <Text style={styles.contextTitle}>אופי</Text>
      {summary.traits.length === 0 ? (
        <>
          <Text style={styles.contextLine}>{summary.traitsAt ? 'השיחות נקראו, ועדיין אין תכונה שחוזרת על עצמה.' : 'עוד אין תכונות.'}</Text>
          <Pressable onPress={() => void run()} disabled={writing} style={styles.traitButton} accessibilityRole="button">
            <Text style={styles.traitButtonText}>{writing ? 'מנתח…' : summary.traitsAt ? 'נתח שוב' : 'נתח אופי'}</Text>
          </Pressable>
        </>
      ) : (
        <>
          {summary.traits.map((trait) => (
            <Text key={trait.id} style={styles.traitLine}>
              <Text style={styles.traitLabel}>{trait.label}</Text>
              {traitClause(trait.label, trait.line) ? <Text style={styles.contextLine}> {traitClause(trait.label, trait.line)}</Text> : null}
            </Text>
          ))}
          {summary.traits.length < 3 ? <Text style={styles.contextMuted}>צריך עוד שיחות כדי לתאר אותו בביטחון.</Text> : null}
          {summary.traitsAt ? <Text style={styles.contextMuted}>לפי {summary.sourceCount} שיחות · {jerusalemDay(summary.traitsAt)}</Text> : null}
          {summary.stale ? (
            <Pressable onPress={() => void run()} disabled={writing} accessibilityRole="button">
              <Text style={styles.contextMuted}>{writing ? 'מנתח…' : 'יש שיחות חדשות · נתח שוב'}</Text>
            </Pressable>
          ) : null}
          <Pressable onPress={() => void toggle()} style={styles.detailRow} accessibilityRole="button" accessibilityState={{ expanded: open }}>
            <Text style={styles.contextLine}>פירוט תכונות</Text>
            <Text style={styles.countPill}>{summary.evidenceCount}</Text>
            <Text style={styles.contextMuted}>{open ? '▴' : '▾'}</Text>
          </Pressable>
          {open && detail ? detail.shown.map((trait) => (
            <View key={trait.id} style={styles.traitGroup}>
              <Text style={styles.traitLabel}>{trait.label}</Text>
              <Text style={styles.contextLine}>{trait.reasoning}</Text>
              <Text style={styles.contextMuted}>{trait.supportCount} שיחות</Text>
              {trait.evidence.map((ev) => (
                <Pressable key={ev.observationId} disabled={!ev.href} onPress={() => ev.href && onOpen(ev.href)} accessibilityRole="link">
                  <Text style={styles.contextMuted}>
                    {SOURCE_LABEL[ev.sourceKind] ?? ev.sourceKind} · {shortDay(ev.sourceDate)}{ev.quote ? ` · "${ev.quote}"` : ''}
                  </Text>
                </Pressable>
              ))}
              <Pressable onPress={() => {
                void dismissPersonTrait(token, trait.id).then(() => {
                  setUndo(trait.id)
                  onChange({ ...summary, traits: summary.traits.filter((t) => t.id !== trait.id), evidenceCount: Math.max(0, summary.evidenceCount - trait.evidence.length) })
                  setDetail({ ...detail, shown: detail.shown.filter((t) => t.id !== trait.id) })
                }).catch(() => setError('לא הצלחנו להסתיר.'))
              }} accessibilityRole="button">
                <Text style={styles.contextMuted}>הסתר תכונה</Text>
              </Pressable>
            </View>
          )) : null}
          {open && detail && detail.once.length > 0 ? (
            <View>
              <Text style={styles.contextMuted}>נראה פעם אחת ({detail.once.length})</Text>
              {detail.once.map((trait) => (
                <Text key={trait.id} style={styles.contextMuted}>
                  {trait.label}{trait.evidence[0] ? ` · ${SOURCE_LABEL[trait.evidence[0].sourceKind] ?? ''} · ${shortDay(trait.evidence[0].sourceDate)}` : ''}
                </Text>
              ))}
            </View>
          ) : null}
          {open && summary.hasSources ? (
            <Pressable onPress={() => void run()} disabled={writing} accessibilityRole="button">
              <Text style={styles.contextMuted}>{writing ? 'מנתח…' : 'נתח שוב'}</Text>
            </Pressable>
          ) : null}
        </>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {undo ? (
        <Pressable onPress={() => {
          void restorePersonTrait(token, undo).then(async () => {
            setUndo(null)
            const ctx = await fetchPersonContext(token, personId)
            if (ctx) onChange(ctx.traits)
            setDetail(await fetchPersonTraitDetail(token, personId))
          }).catch(() => setError('לא הצלחנו לבטל.'))
        }} accessibilityRole="button">
          <Text style={styles.contextLine}>התכונה הוסתרה · בטל</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function WarmthCard({
  warmth,
  onOpen,
}: {
  warmth: MobilePersonContext['warmth']
  onOpen: (meetingId: string) => void
}) {
  const ordered = [...warmth.timeline].reverse()
  const trend = warmth.trend
  return (
    <View style={styles.contextCard}>
      <View style={styles.contextHeader}>
        <Text style={styles.contextTitle}>קשר</Text>
        {trend ? (
          <Text style={[styles.warmth, trend === 'cooling' ? styles.cooling : trend === 'warming' ? styles.warming : styles.contextMuted]}>
            {trend === 'cooling' ? '↓' : trend === 'warming' ? '↑' : '·'} {WARMTH_TREND_LABEL[trend]}
          </Text>
        ) : (
          <Text style={styles.contextMuted}>אין עדיין מספיק שיחות למגמה</Text>
        )}
      </View>
      <SentimentChart points={ordered} />
      <Text style={styles.contextMuted}>
        ממוצע אחרון {formatSentiment(warmth.recentAvg)} · ממוצע קודם {formatSentiment(warmth.olderAvg)}
      </Text>
      {warmth.timeline.map((p) => (
        <Pressable key={p.meetingId} onPress={() => onOpen(p.meetingId)} accessibilityRole="link" style={styles.pointRow}>
          <Text style={styles.pointDate}>{shortDate(p.date)}</Text>
          <Text style={styles.pointTitle} numberOfLines={1}>{p.title}</Text>
          {p.score != null ? <Text style={styles.pointScore}>{p.score}/10</Text> : null}
          <Text style={[styles.pointSentiment, p.sentiment < 0 ? styles.cooling : styles.warming]}>{formatSentiment(p.sentiment)}</Text>
        </Pressable>
      ))}
    </View>
  )
}

function SentimentChart({ points }: { points: MobileWarmthPoint[] }) {
  return (
    <View style={styles.chart}>
      <View style={styles.zeroLine} />
      {points.map((p) => {
        const mag = Math.min(1, Math.abs(p.sentiment))
        const height = Math.max(3, mag * 28)
        const up = p.sentiment >= 0
        return (
          <View key={p.meetingId} style={styles.barSlot}>
            <View
              style={[
                styles.bar,
                { height, backgroundColor: up ? colors.success : '#facc15' },
                up ? { bottom: 32 } : { top: 32 },
              ]}
            />
          </View>
        )
      })}
    </View>
  )
}

function durationLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export default function PersonDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const { token } = useAuth()
  const router = useRouter()

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [company, setCompany] = useState('')
  const [meetingCount, setMeetingCount] = useState(0)
  const [taskCount, setTaskCount] = useState(0)
  const [context, setContext] = useState<MobilePersonContext | null>(null)
  const [captureSaving, setCaptureSaving] = useState(false)

  const toggleCapture = async (enabled: boolean) => {
    if (!token || !id || !context) return
    setCaptureSaving(true)
    try {
      const on = await setCaptureWhatsapp(token, id, enabled)
      setContext({ ...context, captureWhatsapp: on })
    } catch (err) {
      Alert.alert('שגיאה', err instanceof Error ? err.message : 'השמירה נכשלה')
    } finally {
      setCaptureSaving(false)
    }
  }

  const load = useCallback(async () => {
    if (!token || !id) return
    setLoading(true)
    setError(null)
    try {
      const [person, related, ctx] = await Promise.all([
        fetchPerson(token, id),
        fetchPersonRelated(token, id).catch(() => null),
        fetchPersonContext(token, id).catch(() => null),
      ])
      setContext(ctx)
      if (!person) {
        setError('איש הקשר לא נמצא')
        return
      }
      setName(person.name)
      setRole(person.role ?? '')
      setCompany(person.company ?? '')
      if (related && typeof related === 'object') {
        const r = related as { meetings?: unknown[]; tasks?: unknown[] }
        setMeetingCount(r.meetings?.length ?? 0)
        setTaskCount(r.tasks?.length ?? 0)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'טעינה נכשלה')
    } finally {
      setLoading(false)
    }
  }, [token, id])

  useEffect(() => {
    void load()
  }, [load])

  const onSave = async () => {
    if (!token || !id) return
    const trimmed = name.trim()
    if (!trimmed) {
      setError('צריך שם')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await updatePerson(token, {
        id,
        name: trimmed,
        role: role.trim() || null,
        company: company.trim() || null,
      })
      router.back()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'שמירה נכשלה')
    } finally {
      setSaving(false)
    }
  }

  const onDelete = () => {
    Alert.alert('מחיקת איש קשר', 'למחוק את איש הקשר?', [
      { text: 'ביטול', style: 'cancel' },
      {
        text: 'מחק',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            if (!token || !id) return
            try {
              await deletePerson(token, id)
              router.back()
            } catch {
              setError('מחיקה נכשלה')
            }
          })()
        },
      },
    ])
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.accent} />
      </View>
    )
  }

  return (
    <FormSheetScaffold
      title="פרטי איש קשר"
      onSave={() => void onSave()}
      saving={saving}
      saveDisabled={!name.trim()}
    >
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {(meetingCount > 0 || taskCount > 0) && (
        <View style={styles.stats}>
          {meetingCount > 0 ? (
            <Text style={styles.statText}>{meetingCount} פגישות</Text>
          ) : null}
          {taskCount > 0 ? (
            <Text style={styles.statText}>{taskCount} משימות</Text>
          ) : null}
        </View>
      )}

      {context && token && id ? (
        <TraitsBlock
          token={token}
          personId={id}
          summary={context.traits}
          onChange={(traits) => setContext({ ...context, traits })}
          onOpen={(href) => {
            if (href.startsWith('http')) void Linking.openURL(href).catch(() => Alert.alert('שגיאה', 'לא ניתן לפתוח'))
            else if (href.startsWith('/meetings/')) router.push(`/meeting/${href.slice('/meetings/'.length)}` as Href)
          }}
        />
      ) : null}

      {context && context.warmth.timeline.length > 0 ? (
        <WarmthCard
          warmth={context.warmth}
          onOpen={(meetingId) => router.push(`/meeting/${meetingId}` as Href)}
        />
      ) : null}

      {context && (context.recommendation || context.openLoops.length > 0 || context.circles.length > 0) ? (
        <View style={styles.contextCard}>
          <View style={styles.contextHeader}>
            <Text style={styles.contextTitle}>הקשר</Text>
          </View>
          {context.recommendation ? <Text style={styles.recommendation}>{context.recommendation}</Text> : null}
          {context.openLoops.slice(0, 5).map((l, i) => (
            <Pressable key={`${l.meetingId}-${i}`} onPress={() => router.push(`/meeting/${l.meetingId}` as Href)} accessibilityRole="link">
              <Text style={styles.contextLine}>• {shortDate(l.meetingDate)} · {l.content}</Text>
            </Pressable>
          ))}
          {context.whatsappSinceCount > 0 ? (
            <Text style={styles.contextMuted}>{context.whatsappSinceCount} הודעות וואטסאפ מאז הפגישה האחרונה</Text>
          ) : null}
          {context.circles.length > 0 ? (
            <Text style={styles.contextMuted}>חוגים: {context.circles.map((c) => c.seriesTitle).join(', ')}</Text>
          ) : null}
        </View>
      ) : null}

      {context ? (
        <View style={styles.contextCard}>
          <View style={styles.captureRow}>
            <Text style={styles.contextTitle}>תיעוד וואטסאפ 1:1</Text>
            <Switch
              value={context.captureWhatsapp}
              onValueChange={toggleCapture}
              disabled={captureSaving || (!context.captureWhatsapp && !context.captureReachable)}
              trackColor={{ true: colors.accent, false: colors.border }}
              accessibilityLabel="תיעוד וואטסאפ 1:1"
            />
          </View>
          <Text style={styles.contextMuted}>
            {context.captureWhatsapp
              ? 'הודעות חדשות בצ׳אט הפרטי נשמרות בכרטיס'
              : context.captureReachable
                ? 'כבוי · שום הודעה פרטית לא נשמרת'
                : 'צריך טלפון או שולח מקושר כדי לזהות את הצ׳אט'}
          </Text>
          {context.dmSummary ? <Text style={styles.contextLine}>{context.dmSummary}</Text> : null}
          {context.proposedCommitmentCount > 0 ? (
            <Pressable onPress={() => router.push('/commitments' as Href)} accessibilityRole="link">
              <Text style={styles.commitmentsLink}>{context.proposedCommitmentCount} התחייבויות לאישור ›</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}

      {context && context.emailThreads.length > 0 ? (
        <View style={styles.contextCard}>
          <Text style={styles.contextTitle}>אימיילים</Text>
          {context.emailThreads.slice(0, 3).map((t) => (
            <Pressable
              key={t.id}
              disabled={!t.gmailUrl}
              onPress={() => t.gmailUrl && void Linking.openURL(t.gmailUrl).catch(() => Alert.alert('שגיאה', 'לא ניתן לפתוח את Gmail'))}
              accessibilityRole="link"
              accessibilityLabel={`פתח ב-Gmail: ${t.subject}`}
            >
              <Text style={styles.contextLine} numberOfLines={1}>{shortDate(t.date)} · {t.subject}</Text>
              {t.snippet ? <Text style={styles.contextMuted} numberOfLines={2}>{t.snippet}</Text> : null}
            </Pressable>
          ))}
        </View>
      ) : null}

      {context ? (
        <View style={styles.contextCard}>
          <View style={styles.captureRow}>
            <Text style={styles.contextTitle}>הקלטות קוליות</Text>
            <Pressable
              onPress={() => router.push(`/record?personId=${encodeURIComponent(id ?? '')}&personName=${encodeURIComponent(name)}` as Href)}
              accessibilityRole="button"
              hitSlop={8}
            >
              <Text style={styles.commitmentsLink}>הקלט שיחה</Text>
            </Pressable>
          </View>
          {context.voiceRecordings.length === 0 ? <Text style={styles.contextMuted}>עוד אין הקלטות</Text> : null}
          {context.voiceRecordings.map((r) => (
            <Pressable
              key={r.id}
              disabled={!r.meetingId || r.status !== 'completed'}
              onPress={() => r.meetingId && router.push(`/meeting/${r.meetingId}` as Href)}
              accessibilityRole="link"
            >
              <Text style={styles.contextLine} numberOfLines={1}>
                {shortDate(r.createdAt)} · {durationLabel(r.duration)} · {r.status === 'completed' ? r.topic ?? 'הקלטה' : r.status === 'failed' ? 'הניתוח נכשל' : 'בעיבוד…'}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <Text style={styles.label}>שם</Text>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="שם מלא"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, styles.inputRtl]}
        textAlign="right"
      />

      <Text style={styles.label}>תפקיד</Text>
      <TextInput
        value={role}
        onChangeText={setRole}
        placeholder="תפקיד"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, styles.inputRtl]}
        textAlign="right"
      />

      <Text style={styles.label}>חברה</Text>
      <TextInput
        value={company}
        onChangeText={setCompany}
        placeholder="חברה"
        placeholderTextColor={colors.textMuted}
        style={[styles.input, styles.inputRtl]}
        textAlign="right"
      />

      <Pressable onPress={onDelete} style={styles.deleteBtn} accessibilityRole="button">
        <Text style={styles.deleteText}>מחק איש קשר</Text>
      </Pressable>
    </FormSheetScaffold>
  )
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg },
  stats: {
    flexDirection: 'row-reverse',
    gap: 16,
    marginBottom: 8,
    paddingVertical: 8,
  },
  statText: { color: colors.textMuted, fontSize: 13, writingDirection: 'rtl' },
  contextCard: {
    backgroundColor: colors.surfaceCard,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: 12,
    gap: 6,
    marginBottom: 8,
  },
  contextHeader: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  contextTitle: { color: colors.textMuted, fontSize: 12, fontWeight: '600', writingDirection: 'rtl' },
  warmth: { fontSize: 12, fontWeight: '600', writingDirection: 'rtl' },
  cooling: { color: '#facc15' },
  warming: { color: colors.success },
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
  traitLine: { textAlign: 'right', writingDirection: 'rtl', lineHeight: 22 },
  traitLabel: { color: colors.text, fontSize: 15, fontWeight: '600', writingDirection: 'rtl' },
  traitButton: { minHeight: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 12, backgroundColor: colors.accent, marginTop: 8 },
  traitButtonText: { color: '#0e1626', fontSize: 15, fontWeight: '700' },
  detailRow: { minHeight: 44, flexDirection: 'row-reverse', alignItems: 'center', gap: 8 },
  countPill: { color: colors.textMuted, backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden', fontVariant: ['tabular-nums'] },
  traitGroup: { gap: 2, marginTop: 8 },
  contextLine: { color: colors.text, fontSize: 13, textAlign: 'right', writingDirection: 'rtl' },
  contextMuted: { color: colors.textMuted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl' },
  captureRow: { flexDirection: 'row-reverse', alignItems: 'center', justifyContent: 'space-between' },
  commitmentsLink: { color: colors.accent, fontSize: 13, textAlign: 'right', writingDirection: 'rtl', marginTop: 4 },
  chart: { height: 64, flexDirection: 'row', alignItems: 'stretch', gap: 3, marginVertical: 4 },
  zeroLine: { position: 'absolute', left: 0, right: 0, top: 31, height: 1, backgroundColor: colors.border },
  barSlot: { flex: 1, position: 'relative' },
  bar: { position: 'absolute', left: 1, right: 1, borderRadius: 2 },
  pointRow: { flexDirection: 'row-reverse', alignItems: 'center', gap: 8, minHeight: 36 },
  pointDate: { color: colors.textMuted, fontSize: 12, width: 36, textAlign: 'right' },
  pointTitle: { flex: 1, color: colors.text, fontSize: 13, textAlign: 'right', writingDirection: 'rtl' },
  pointScore: { color: colors.textMuted, fontSize: 12 },
  pointSentiment: { fontSize: 13, fontWeight: '700', width: 52, textAlign: 'left' },
  label: {
    color: colors.textMuted,
    fontSize: 13,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 12,
  },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
  },
  inputRtl: { writingDirection: 'rtl' },
  error: { color: colors.error, textAlign: 'center', writingDirection: 'rtl', paddingVertical: 4 },
  deleteBtn: {
    marginTop: 32,
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.coral + '66',
  },
  deleteText: { color: colors.coral, fontSize: 16, fontWeight: '600', writingDirection: 'rtl' },
})

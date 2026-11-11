import { useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { colors } from '../lib/theme'
import type { MobileProjectStanding, MobileProjectWarmth } from '../lib/data'
import {
  atmosphereTone,
  formatBriefAt,
  moodDotColor,
  moodTone,
  peopleHeadline,
  peopleTone,
  scoreTone,
  type VibeTone,
} from '../lib/project-vibe'

type Panel = 'insights' | 'atmosphere' | 'scores'

const TONE_COLOR: Record<VibeTone, string> = {
  cooling: colors.coral,
  warming: colors.accent,
  neutral: colors.text,
}

function Verdict({ label, text, tone }: { label: string; text: string; tone: VibeTone }) {
  return (
    <View style={styles.verdict}>
      <Text style={styles.verdictLabel}>{label}</Text>
      <Text style={[styles.verdictText, { color: TONE_COLOR[tone] }]}>{text}</Text>
    </View>
  )
}

function QualityLine({
  points,
}: {
  points: { meetingId: string; date: string; score: number; tone: number }[]
}) {
  const [width, setWidth] = useState(0)
  const height = 52
  const padX = 8
  const padY = 8
  const innerW = Math.max(0, width - padX * 2)
  const innerH = height - padY * 2
  const xAt = (i: number) => padX + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW)
  const yAt = (score: number) => padY + innerH - (score / 10) * innerH

  return (
    <View>
      <View
        style={[styles.chart, { height }]}
        onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
        accessibilityRole="image"
        accessibilityLabel="קו מגמת איכות השיחות, מהישן לחדש"
      >
        {width > 0 && points.length > 1
          ? points.slice(0, -1).map((point, i) => {
              const next = points[i + 1]
              const x1 = xAt(i)
              const y1 = yAt(point.score)
              const x2 = xAt(i + 1)
              const y2 = yAt(next.score)
              const dx = x2 - x1
              const dy = y2 - y1
              const length = Math.hypot(dx, dy)
              const angle = `${Math.atan2(dy, dx)}rad`
              return (
                <View
                  key={`${point.meetingId}-line`}
                  style={[
                    styles.segment,
                    {
                      left: x1,
                      top: y1,
                      width: length,
                      transform: [{ rotate: angle }],
                    },
                  ]}
                />
              )
            })
          : null}
        {width > 0
          ? points.map((point, i) => (
              <View
                key={point.meetingId}
                style={[
                  styles.dot,
                  {
                    left: xAt(i) - 3,
                    top: yAt(point.score) - 3,
                    backgroundColor: moodDotColor(point.tone),
                  },
                ]}
              />
            ))
          : null}
      </View>
      {points.length > 0 ? (
        <View style={styles.chartDates}>
          <Text style={styles.caption}>{points[0].date}</Text>
          <Text style={styles.caption}>{points[points.length - 1].date}</Text>
        </View>
      ) : null}
      <Text style={styles.caption}>הקו: איכות השיחה. הנקודה: אווירה, חמה או קרה. משמאל ישן, מימין אחרון.</Text>
    </View>
  )
}

export function ProjectVibeCard({
  warmth,
  standing,
  writing,
  writeError,
  onWrite,
  onOpenMeeting,
}: {
  warmth: MobileProjectWarmth | null
  standing: MobileProjectStanding | null
  writing: boolean
  writeError: string | null
  onWrite: () => void
  onOpenMeeting: (meetingId: string) => void
}) {
  const [detailOpen, setDetailOpen] = useState(false)
  const [panel, setPanel] = useState<Panel | null>(null)
  const people = warmth?.people ?? []
  const timeline = warmth?.timeline ?? []
  const atmosphereText = warmth?.dataReason?.trim() ? warmth.dataReason : 'עוד אין תמונת אווירה.'
  const scoreText = warmth?.scoreText?.trim() ? warmth.scoreText : 'עוד אין ציון.'
  const scored = [...timeline].filter((point) => point.score != null).reverse()
  const insights = timeline.filter((point) => point.keyInsight?.trim())
  const room = timeline.filter((point) => point.mood?.trim() || point.subtext?.trim())
  const graded = timeline.filter((point) => point.score != null)

  const choose = (next: Panel) => setPanel((current) => (current === next ? null : next))

  return (
    <View style={styles.card}>
      <Text style={styles.title}>איפה זה עומד</Text>
      <Verdict label="אווירה" text={atmosphereText} tone={atmosphereTone(atmosphereText)} />
      <Verdict label="אנשים" text={peopleHeadline(people)} tone={peopleTone(people)} />
      <Verdict label="ציון" text={scoreText} tone={scoreTone(scoreText)} />
      {standing?.stale ? <Text style={styles.stale}>יש שיחות חדשות מאז התמצית.</Text> : null}

      <Pressable
        onPress={() => setDetailOpen((open) => !open)}
        style={styles.detailBtn}
        accessibilityRole="button"
        accessibilityState={{ expanded: detailOpen }}
      >
        <Text style={styles.detailLabel}>פירוט</Text>
        <Text style={styles.detailLabel}>{detailOpen ? '▴' : '▾'}</Text>
      </Pressable>

      {detailOpen ? (
        <View>
          {standing?.brief ? (
            <Text style={styles.brief}>{standing.brief}</Text>
          ) : (
            <Text style={styles.muted}>עוד אין תמצית.</Text>
          )}
          {standing?.briefAt ? (
            <Text style={styles.caption}>נותח לאחרונה {formatBriefAt(standing.briefAt)}</Text>
          ) : null}
          {writeError ? <Text style={styles.error}>{writeError}</Text> : null}
          <Pressable
            onPress={onWrite}
            disabled={writing}
            style={styles.writeBtn}
            accessibilityRole="button"
            accessibilityState={{ disabled: writing }}
          >
            <Text style={styles.writeLabel}>
              {writing ? 'כותב תמצית…' : standing?.brief ? 'נתח שוב' : 'כתוב תמצית'}
            </Text>
          </Pressable>

          {scored.length >= 2 ? (
            <QualityLine
              points={scored.map((point) => ({
                meetingId: point.meetingId,
                date: point.date,
                score: point.score as number,
                tone: moodTone(point.mood, point.subtext),
              }))}
            />
          ) : null}

          {people.length > 0 ? (
            <View style={styles.people}>
              {people.map((person) => (
                <Text key={person.personId} style={styles.body}>
                  {person.text}
                </Text>
              ))}
            </View>
          ) : null}

          <View style={styles.panels}>
            <PanelButton label="תובנות" value={insights.length ? String(insights.length) : 'אין'} active={panel === 'insights'} onPress={() => choose('insights')} />
            <PanelButton label="אווירה" value={room.length ? String(room.length) : 'אין'} active={panel === 'atmosphere'} onPress={() => choose('atmosphere')} />
            <PanelButton
              label="ציון"
              value={graded[0]?.score != null ? `${graded[0].score}/10` : 'אין'}
              active={panel === 'scores'}
              onPress={() => choose('scores')}
            />
          </View>

          {panel === 'insights' ? (
            insights.length === 0 ? <Text style={styles.muted}>עוד אין תובנות שמורות.</Text> : insights.map((item) => (
              <Pressable key={item.meetingId} onPress={() => onOpenMeeting(item.meetingId)} accessibilityRole="link">
                <Text style={styles.link}>{item.title}</Text>
                <Text style={styles.body}>{item.keyInsight}</Text>
              </Pressable>
            ))
          ) : null}
          {panel === 'atmosphere' ? (
            room.length === 0 ? <Text style={styles.muted}>עוד אין תיאור אווירה.</Text> : room.map((item) => (
              <Pressable key={item.meetingId} onPress={() => onOpenMeeting(item.meetingId)} accessibilityRole="link">
                <Text style={styles.link}>{item.title}</Text>
                {item.mood?.trim() ? <Text style={styles.body}>אווירה: {item.mood.trim()}</Text> : null}
                {item.subtext?.trim() ? <Text style={styles.body}>מתחת לפני השטח: {item.subtext.trim()}</Text> : null}
              </Pressable>
            ))
          ) : null}
          {panel === 'scores' ? (
            graded.length === 0 ? <Text style={styles.muted}>עוד אין ציון.</Text> : graded.map((item) => (
              <Pressable key={item.meetingId} onPress={() => onOpenMeeting(item.meetingId)} accessibilityRole="link">
                <Text style={styles.link}>{item.title}</Text>
                <Text style={styles.body}>{item.score}/10</Text>
                {item.scoreRationale?.trim() ? <Text style={styles.body}>{item.scoreRationale.trim()}</Text> : null}
              </Pressable>
            ))
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

function PanelButton({
  label,
  value,
  active,
  onPress,
}: {
  label: string
  value: string
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.panelBtn, active && styles.panelBtnActive]}
      accessibilityRole="button"
      accessibilityState={{ expanded: active }}
    >
      <Text style={styles.caption}>{label}</Text>
      <Text style={styles.panelValue}>{value}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surfaceCard,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
    marginBottom: 8,
  },
  title: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: '700',
    textAlign: 'right',
    writingDirection: 'rtl',
    marginBottom: 6,
  },
  verdict: {
    flexDirection: 'row-reverse',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 4,
  },
  verdictLabel: {
    width: 52,
    color: colors.textMuted,
    fontSize: 12,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  verdictText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
    writingDirection: 'rtl',
    lineHeight: 20,
  },
  stale: {
    color: '#fbbf24',
    fontSize: 12,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 6,
  },
  detailBtn: {
    minHeight: 44,
    flexDirection: 'row-reverse',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailLabel: { color: colors.textMuted, fontSize: 14, writingDirection: 'rtl' },
  brief: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'right',
    writingDirection: 'rtl',
  },
  muted: {
    color: colors.textMuted,
    fontSize: 14,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 4,
  },
  caption: {
    color: colors.textMuted,
    fontSize: 11,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 4,
  },
  error: { color: colors.error, fontSize: 13, textAlign: 'right', writingDirection: 'rtl', marginTop: 6 },
  writeBtn: {
    alignSelf: 'flex-end',
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: 4,
  },
  writeLabel: { color: colors.accent, fontSize: 14, fontWeight: '600', writingDirection: 'rtl' },
  chart: { marginTop: 12, position: 'relative' },
  segment: {
    position: 'absolute',
    height: 1.5,
    backgroundColor: '#8aa0bd',
    transformOrigin: 'left center',
  },
  dot: {
    position: 'absolute',
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  chartDates: { flexDirection: 'row', justifyContent: 'space-between' },
  people: { marginTop: 12, gap: 8 },
  body: {
    color: colors.text,
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'right',
    writingDirection: 'rtl',
    marginTop: 4,
  },
  panels: { flexDirection: 'row-reverse', gap: 8, marginTop: 12 },
  panelBtn: {
    flex: 1,
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 8,
    paddingVertical: 6,
    alignItems: 'flex-end',
  },
  panelBtnActive: { borderColor: colors.accent, backgroundColor: '#16343a' },
  panelValue: { color: colors.text, fontSize: 14, fontWeight: '700', writingDirection: 'rtl' },
  link: { color: colors.textMuted, fontSize: 12, textAlign: 'right', writingDirection: 'rtl', marginTop: 10 },
})

/**
 * Relationship / circle warmth from meeting analyses. Computed on read — no stored trend yet.
 * Sentiment per analysis lies in [-1, 1]: mostly the 1–10 score, nudged by mood/subtext wording.
 */
import { and, desc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm'
import { isSelfPersonName } from '../lib/self-identity'
import { meetingAnalyses, meetingNoteProjects, meetingNotes, meetingPeople, meetingSeries, meetings, people, projectPeople, type getDb } from '@ak-system/database'

type Db = ReturnType<typeof getDb>

export type WarmthTrend = 'warming' | 'cooling' | 'stable'

export interface SentimentPoint {
  meetingId: string
  analysisId: string
  date: string
  title: string
  score: number | null
  mood: string | null
  subtext: string | null
  keyInsight: string | null
  scoreRationale: string | null
  sentiment: number
}

export interface WarmthResult {
  trend: WarmthTrend | null
  recentAvg: number | null
  olderAvg: number | null
  count: number
  /** Analysed meetings in the recent window; absent for series/project results. */
  recentCount?: number
  timeline: SentimentPoint[]
}

const TREND_THRESHOLD = 0.2
/**
 * A cooling this large (on the −1…+1 scale, roughly 3 points of the 1–10 score) is what the
 * dashboard, the morning brief and the harness treat as worth interrupting for. The
 * relationships page still lists every mover above TREND_THRESHOLD.
 * Keep in lockstep with apps/web/src/lib/attention-shift.ts and apps/mobile/lib/attention-shift.ts.
 */
export const DRASTIC_COOLING_DROP = 0.5
/** A drastic cooling needs at least this many analysed meetings in the recent window. */
export const DRASTIC_COOLING_MIN_RECENT = 2

export function isDrasticCooling(recentAvg: number | null, olderAvg: number | null, recentCount = DRASTIC_COOLING_MIN_RECENT): boolean {
  if (recentAvg == null || olderAvg == null) return false
  return recentCount >= DRASTIC_COOLING_MIN_RECENT && olderAvg - recentAvg >= DRASTIC_COOLING_DROP
}
const PERSON_MIN_INTERACTIONS = 4
const SERIES_MIN_INSTANCES = 6
const SERIES_WINDOW = 8

const POSITIVE_WORDS = /collaborat|productive|positive|warm|energ|engaged|constructive|friendly|aligned|optimis|חיובי|פורה|שיתופי|חם|אנרגטי|מעורב/i
const NEGATIVE_WORDS = /tense|tension|frustrat|conflict|negative|cold|disengag|defensive|stress|confus|hostile|מתוח|מתיחות|תסכול|קונפליקט|שלילי|קר|לחוץ|מבולבל/i

function lexicon(text: string | null): number {
  if (!text) return 0
  const pos = POSITIVE_WORDS.test(text)
  const neg = NEGATIVE_WORDS.test(text)
  if (pos && !neg) return 1
  if (neg && !pos) return -1
  return 0
}

export function analysisSentiment(a: { score: number | null; mood: string | null; subtext: string | null }): number {
  const tone = (lexicon(a.mood) * 2 + lexicon(a.subtext)) / 3
  if (a.score == null) return round(tone)
  const scoreNorm = (Math.max(1, Math.min(10, a.score)) - 5.5) / 4.5
  return round(scoreNorm * 0.7 + tone * 0.3)
}

function round(n: number): number {
  return Math.round(n * 100) / 100
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null
  return round(values.reduce((s, v) => s + v, 0) / values.length)
}

export function compareTrend(recent: number[], older: number[]): WarmthTrend | null {
  const r = avg(recent)
  const o = avg(older)
  if (r == null || o == null) return null
  if (r - o >= TREND_THRESHOLD) return 'warming'
  if (o - r >= TREND_THRESHOLD) return 'cooling'
  return 'stable'
}

/**
 * Person windows: last 90 days against the 90 before. When every analysed meeting
 * falls inside the last 90 days there is no older window, so a busy relationship
 * would never get a trend — then the newest half is compared with the older half.
 * `points` must be sorted newest first.
 */
export function splitPersonWindows<T extends { date: string }>(points: T[], cutoff90: string): { recent: T[]; older: T[] } {
  const recent = points.filter((p) => p.date >= cutoff90)
  const older = points.filter((p) => p.date < cutoff90)
  if (recent.length > 0 && older.length > 0) return { recent, older }
  if (points.length < 2) return { recent, older }
  const recentCount = Math.ceil(points.length / 2)
  return { recent: points.slice(0, recentCount), older: points.slice(recentCount) }
}

async function analysedMeetings(db: Db, meetingIds: string[]): Promise<SentimentPoint[]> {
  if (meetingIds.length === 0) return []
  const rows = await db
    .select({
      analysisId: meetingAnalyses.id,
      meetingId: meetings.id,
      date: meetings.date,
      title: meetings.title,
      score: meetingAnalyses.score,
      mood: meetingAnalyses.mood,
      keyInsight: meetingAnalyses.keyInsight,
      scoreRationale: meetingAnalyses.scoreRationale,
      subtext: meetingAnalyses.subtext,
    })
    .from(meetingAnalyses)
    .innerJoin(meetings, eq(meetings.id, meetingAnalyses.meetingId))
    .where(and(inArray(meetings.id, meetingIds), isNotNull(meetingAnalyses.score)))
    .orderBy(desc(meetings.date))
  const seen = new Set<string>()
  const out: SentimentPoint[] = []
  for (const r of rows) {
    if (seen.has(r.meetingId)) continue
    seen.add(r.meetingId)
    out.push({
      meetingId: r.meetingId,
      analysisId: r.analysisId,
      date: r.date,
      title: r.title,
      score: r.score,
      mood: r.mood,
      subtext: r.subtext,
      keyInsight: r.keyInsight,
      scoreRationale: r.scoreRationale,
      sentiment: analysisSentiment(r),
    })
  }
  return out
}

function isoDaysAgo(days: number, now: Date): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10)
}

/** Person: last 90 days vs 91–180 days; null under 4 analysed interactions. */
export async function personWarmth(db: Db, personId: string, now = new Date()): Promise<WarmthResult> {
  const links = await db.select({ meetingId: meetingPeople.meetingId }).from(meetingPeople).where(eq(meetingPeople.personId, personId))
  const cutoff90 = isoDaysAgo(90, now)
  const cutoff180 = isoDaysAgo(180, now)
  const today = now.toISOString().slice(0, 10)
  const timeline = (await analysedMeetings(db, [...new Set(links.map((l) => l.meetingId))]))
    .filter((p) => p.date >= cutoff180 && p.date <= today)
  const windows = splitPersonWindows(timeline, cutoff90)
  const recent = windows.recent.map((p) => p.sentiment)
  const older = windows.older.map((p) => p.sentiment)
  return {
    trend: timeline.length >= PERSON_MIN_INTERACTIONS ? compareTrend(recent, older) : null,
    recentAvg: avg(recent),
    olderAvg: avg(older),
    count: timeline.length,
    recentCount: recent.length,
    timeline,
  }
}

export interface RelationshipFlag {
  personId: string
  name: string
  trend: 'warming' | 'cooling'
  recentAvg: number | null
  olderAvg: number | null
  count: number
}

/**
 * Confirmed people whose last-90-day sentiment differs from the previous 90 days.
 * One query for the whole list, so the people page can show flags without opening each card.
 */
export async function relationshipFlags(db: Db, now = new Date()): Promise<{ cooling: RelationshipFlag[]; warming: RelationshipFlag[] }> {
  const cutoff90 = isoDaysAgo(90, now)
  const cutoff180 = isoDaysAgo(180, now)
  const today = now.toISOString().slice(0, 10)
  const rows = await db
    .select({
      personId: people.id,
      name: people.name,
      meetingId: meetings.id,
      date: meetings.date,
      score: meetingAnalyses.score,
      mood: meetingAnalyses.mood,
      subtext: meetingAnalyses.subtext,
    })
    .from(meetingPeople)
    .innerJoin(people, eq(people.id, meetingPeople.personId))
    .innerJoin(meetings, eq(meetings.id, meetingPeople.meetingId))
    .innerJoin(meetingAnalyses, eq(meetingAnalyses.meetingId, meetings.id))
    .where(and(
      eq(people.status, 'confirmed'),
      isNotNull(meetingAnalyses.score),
      gte(meetings.date, cutoff180),
      lte(meetings.date, today),
    ))
    .orderBy(desc(meetings.date))

  const byPerson = new Map<string, { name: string; points: { meetingId: string; date: string; sentiment: number }[] }>()
  const seen = new Set<string>()
  for (const r of rows) {
    const key = `${r.personId}:${r.meetingId}`
    if (seen.has(key)) continue
    seen.add(key)
    if (isSelfPersonName(r.name)) continue
    const bucket = byPerson.get(r.personId) ?? { name: r.name, points: [] }
    bucket.points.push({ meetingId: r.meetingId, date: r.date, sentiment: analysisSentiment(r) })
    byPerson.set(r.personId, bucket)
  }

  const cooling: RelationshipFlag[] = []
  const warming: RelationshipFlag[] = []
  for (const [personId, bucket] of byPerson) {
    if (bucket.points.length < PERSON_MIN_INTERACTIONS) continue
    const windows = splitPersonWindows(bucket.points, cutoff90)
    const recent = windows.recent.map((p) => p.sentiment)
    const older = windows.older.map((p) => p.sentiment)
    const trend = compareTrend(recent, older)
    if (trend !== 'warming' && trend !== 'cooling') continue
    const flag: RelationshipFlag = {
      personId,
      name: bucket.name,
      trend,
      recentAvg: avg(recent),
      olderAvg: avg(older),
      count: bucket.points.length,
    }
    ;(trend === 'cooling' ? cooling : warming).push(flag)
  }
  const drop = (f: RelationshipFlag) => Math.abs((f.recentAvg ?? 0) - (f.olderAvg ?? 0))
  cooling.sort((a, b) => drop(b) - drop(a))
  warming.sort((a, b) => drop(b) - drop(a))
  return { cooling, warming }
}

const PROJECT_MIN_ANALYSES = 4

function tenth(values: Array<number | null>): number | null {
  const scores = values.filter((s): s is number => s != null)
  if (scores.length === 0) return null
  return Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 10) / 10
}

function fmtScore(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

function toneOf(p: { mood: string | null; subtext: string | null }): number {
  return round((lexicon(p.mood) * 2 + lexicon(p.subtext)) / 3)
}

/** Relationship mood only. A flat result means the wording was not classified, not that the room is calm. */
export function projectMoodCopy(
  recent: number[],
  older: number[],
  count: number,
): { trend: WarmthTrend | null; text: string } {
  if (count === 0) return { trend: null, text: 'עוד אין שיחות מנותחות בפרויקט.' }
  if (count < PROJECT_MIN_ANALYSES) return { trend: null, text: 'אחרי 4 שיחות אפשר לראות אם האווירה זזה.' }
  const signal = [...recent, ...older].some((n) => n !== 0)
  if (!signal) return { trend: null, text: '' }
  const trend = compareTrend(recent, older)
  if (trend === 'warming') return { trend, text: 'האווירה בחדר מתחממת.' }
  if (trend === 'cooling') return { trend, text: 'האווירה בחדר מתקררת.' }
  if (trend === 'stable') return { trend, text: 'האווירה בחדר יציבה.' }
  return { trend: null, text: '' }
}

export interface ProjectPersonStanding {
  personId: string
  name: string
  color: string | null
  onProject: boolean
  count: number
  trend: WarmthTrend | null
  text: string
  latest: {
    meetingId: string
    date: string
    title: string
    mood: string | null
    subtext: string | null
  } | null
}

/** Mood of the analysed meetings this person actually sat in, inside one project. */
export function personInProjectCopy(
  name: string,
  recent: number[],
  older: number[],
  count: number,
  scope = 'בפרויקט',
): { trend: WarmthTrend | null; text: string } {
  if (count === 0) return { trend: null, text: 'רשום בפרויקט, עוד לא בשיחה מנותחת.' }
  if (count < PROJECT_MIN_ANALYSES) return { trend: null, text: `${count} שיחות ${scope}. מגמה אחרי 4.` }
  const signal = [...recent, ...older].some((n) => n !== 0)
  if (!signal) return { trend: null, text: `${count} שיחות ${scope}.` }
  const trend = compareTrend(recent, older)
  if (trend === 'warming') return { trend, text: `הקשר עם ${name} מתחמם.` }
  if (trend === 'cooling') return { trend, text: `הקשר עם ${name} מתקרר.` }
  if (trend === 'stable') return { trend, text: `הקשר עם ${name} יציב.` }
  return { trend: null, text: `${count} שיחות ${scope}.` }
}

/** Hebrew score movement for a project. Does not append mood or rationale text. */
export function projectScoreCopy(recent: Array<number | null>, older: Array<number | null>, count: number): string {
  if (count === 0) return 'עוד אין שיחות מנותחות בפרויקט.'
  if (count < PROJECT_MIN_ANALYSES) return `נותחו ${count} שיחות. המגמה תופיע אחרי 4.`
  const r = tenth(recent)
  const o = tenth(older)
  if (r == null || o == null) return `נותחו ${count} שיחות.`
  if (r < o) return `הציון ירד מ־${fmtScore(o)} ל־${fmtScore(r)} מתוך 10.`
  if (r > o) return `הציון עלה מ־${fmtScore(o)} ל־${fmtScore(r)} מתוך 10.`
  return `הציון נשאר ${fmtScore(r)} מתוך 10.`
}

async function peopleInProject(
  db: Db,
  projectId: string | null,
  meetingIds: string[],
  timeline: SentimentPoint[],
  scope = 'בפרויקט',
): Promise<ProjectPersonStanding[]> {
  const roster = projectId
    ? await db
    .select({ id: people.id, name: people.name, color: people.color })
    .from(projectPeople)
    .innerJoin(people, eq(people.id, projectPeople.personId))
    .where(eq(projectPeople.projectId, projectId))
    : []
  const attended = meetingIds.length === 0
    ? []
    : await db
      .select({ id: people.id, name: people.name, color: people.color, meetingId: meetingPeople.meetingId })
      .from(meetingPeople)
      .innerJoin(people, eq(people.id, meetingPeople.personId))
      .where(inArray(meetingPeople.meetingId, meetingIds))

  // The owner is in every meeting; he is never one of "the people" a meeting or project reports on.
  const byId = new Map<string, { name: string; color: string | null; onProject: boolean; meetingIds: Set<string> }>()
  for (const person of roster) {
    if (isSelfPersonName(person.name)) continue
    byId.set(person.id, { name: person.name, color: person.color, onProject: true, meetingIds: new Set() })
  }
  for (const row of attended) {
    if (isSelfPersonName(row.name)) continue
    const current = byId.get(row.id) ?? { name: row.name, color: row.color, onProject: false, meetingIds: new Set<string>() }
    current.meetingIds.add(row.meetingId)
    byId.set(row.id, current)
  }

  const analysed = new Map(timeline.map((p) => [p.meetingId, p]))
  const standings: ProjectPersonStanding[] = []
  for (const [personId, person] of byId) {
    const points = timeline.filter((p) => person.meetingIds.has(p.meetingId))
    const recentCount = Math.min(SERIES_WINDOW, Math.ceil(points.length / 2))
    const mood = personInProjectCopy(
      person.name,
      points.slice(0, recentCount).map(toneOf),
      points.slice(recentCount).map(toneOf),
      points.length,
      scope,
    )
    const latestPoint = points.find((p) => p.mood?.trim() || p.subtext?.trim()) ?? points[0]
    const latest = latestPoint && analysed.has(latestPoint.meetingId)
      ? {
          meetingId: latestPoint.meetingId,
          date: latestPoint.date,
          title: latestPoint.title,
          mood: latestPoint.mood,
          subtext: latestPoint.subtext,
        }
      : null
    standings.push({
      personId,
      name: person.name,
      color: person.color,
      onProject: person.onProject,
      count: points.length,
      trend: mood.trend,
      text: mood.text,
      latest,
    })
  }
  const rank: Record<string, number> = { cooling: 0, warming: 1, stable: 2 }
  standings.sort((a, b) => (rank[a.trend ?? ''] ?? 3) - (rank[b.trend ?? ''] ?? 3) || a.name.localeCompare(b.name, 'he'))
  return standings
}

/** Project: last up-to-8 analysed meetings vs the previous up-to-8. People trend uses mood, not the meeting score. */
export async function projectWarmth(
  db: Db,
  projectId: string,
  now = new Date(),
): Promise<WarmthResult & { dataReason: string; scoreText: string; recentScore: number | null; olderScore: number | null; people: ProjectPersonStanding[] }> {
  const today = now.toISOString().slice(0, 10)
  const direct = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.projectId, projectId))
  const linked = await db
    .select({ id: meetingNotes.meetingId })
    .from(meetingNoteProjects)
    .innerJoin(meetingNotes, eq(meetingNotes.id, meetingNoteProjects.meetingNoteId))
    .where(eq(meetingNoteProjects.projectId, projectId))
  const ids = [...new Set([
    ...direct.map((m) => m.id),
    ...linked.map((m) => m.id).filter((id): id is string => !!id),
  ])]
  const timeline = (await analysedMeetings(db, ids)).filter((p) => p.date <= today).slice(0, SERIES_WINDOW * 2)
  const recentCount = Math.min(SERIES_WINDOW, Math.ceil(timeline.length / 2))
  const recent = timeline.slice(0, recentCount)
  const older = timeline.slice(recentCount)
  const mood = projectMoodCopy(recent.map(toneOf), older.map(toneOf), timeline.length)
  return {
    trend: mood.trend,
    recentAvg: avg(recent.map(toneOf)),
    olderAvg: avg(older.map(toneOf)),
    count: timeline.length,
    timeline,
    recentScore: tenth(recent.map((p) => p.score)),
    olderScore: tenth(older.map((p) => p.score)),
    dataReason: mood.text,
    scoreText: projectScoreCopy(recent.map((p) => p.score), older.map((p) => p.score), timeline.length),
    people: await peopleInProject(db, projectId, ids, timeline),
  }
}

function splitTrend<T>(items: T[]): { recent: T[]; older: T[] } {
  const recentCount = Math.min(SERIES_WINDOW, Math.ceil(items.length / 2))
  return { recent: items.slice(0, recentCount), older: items.slice(recentCount) }
}

/** This meeting, after a completed analysis. People trends use every analysed conversation of theirs on the project. */
export async function meetingInsight(db: Db, meetingId: string) {
  const [meeting] = await db
    .select({ id: meetings.id, title: meetings.title, date: meetings.date, projectId: meetings.projectId })
    .from(meetings)
    .where(eq(meetings.id, meetingId))
  if (!meeting) return null
  const [analysis] = await db
    .select({
      status: meetingAnalyses.status,
      mood: meetingAnalyses.mood,
      subtext: meetingAnalyses.subtext,
      score: meetingAnalyses.score,
      scoreRationale: meetingAnalyses.scoreRationale,
      keyInsight: meetingAnalyses.keyInsight,
    })
    .from(meetingAnalyses)
    .where(eq(meetingAnalyses.meetingId, meetingId))
    .orderBy(desc(meetingAnalyses.createdAt))
    .limit(1)
  if (!analysis || analysis.status !== 'completed') return null

  const attendees = (await db
    .select({ id: people.id, name: people.name, color: people.color })
    .from(meetingPeople)
    .innerJoin(people, eq(people.id, meetingPeople.personId))
    .where(eq(meetingPeople.meetingId, meetingId))
  ).filter((p) => !isSelfPersonName(p.name))
  const attendeeIds = new Set(attendees.map((p) => p.id))
  const fromProject = meeting.projectId
    ? (await projectWarmth(db, meeting.projectId)).people.filter((p) => attendeeIds.has(p.personId))
    : attendees.map((p) => ({
        personId: p.id,
        name: p.name,
        color: p.color,
        onProject: false,
        count: 1,
        trend: null,
        text: 'בשיחה הזו.',
        latest: null,
      }))

  return {
    projectId: meeting.projectId,
    atmosphereText: '',
    atmosphere: [{ meetingId: meeting.id, date: meeting.date, title: meeting.title, mood: analysis.mood, subtext: analysis.subtext }],
    people: fromProject,
    scoreText: analysis.score != null ? `${analysis.score} מתוך 10.` : '',
    scores: [{ meetingId: meeting.id, date: meeting.date, title: meeting.title, score: analysis.score, rationale: analysis.scoreRationale }],
    insights: analysis.keyInsight?.trim()
      ? [{ meetingId: meeting.id, date: meeting.date, title: meeting.title, text: analysis.keyInsight }]
      : [],
  }
}

/** Recurring series. Person trends prefer the project those instances belong to. */
export async function seriesInsight(db: Db, seriesId: string, now = new Date()) {
  const today = now.toISOString().slice(0, 10)
  const instances = await db
    .select({ id: meetings.id, projectId: meetings.projectId })
    .from(meetings)
    .where(eq(meetings.seriesId, seriesId))
  const ids = instances.map((m) => m.id)
  const timeline = (await analysedMeetings(db, ids)).filter((p) => p.date <= today).slice(0, SERIES_WINDOW * 2)
  if (timeline.length === 0) return null
  const { recent, older } = splitTrend(timeline)
  const projectCounts = new Map<string, number>()
  for (const row of instances) {
    if (row.projectId) projectCounts.set(row.projectId, (projectCounts.get(row.projectId) ?? 0) + 1)
  }
  const projectId = [...projectCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  const attended = ids.length === 0
    ? []
    : await db
      .select({ id: people.id })
      .from(meetingPeople)
      .innerJoin(people, eq(people.id, meetingPeople.personId))
      .where(inArray(meetingPeople.meetingId, ids))
  const attendeeIds = new Set(attended.map((p) => p.id))
  const peopleRows = projectId
    ? (await projectWarmth(db, projectId)).people.filter((p) => attendeeIds.has(p.personId))
    : await peopleInProject(db, null, ids, timeline, 'בסדרה')

  return {
    projectId,
    atmosphereText: projectMoodCopy(recent.map(toneOf), older.map(toneOf), timeline.length).text,
    atmosphere: timeline.map((p) => ({ meetingId: p.meetingId, date: p.date, title: p.title, mood: p.mood, subtext: p.subtext })),
    people: peopleRows,
    scoreText: projectScoreCopy(recent.map((p) => p.score), older.map((p) => p.score), timeline.length),
    scores: timeline.map((p) => ({ meetingId: p.meetingId, date: p.date, title: p.title, score: p.score, rationale: p.scoreRationale })),
    insights: timeline
      .filter((p) => p.keyInsight?.trim())
      .map((p) => ({ meetingId: p.meetingId, date: p.date, title: p.title, text: p.keyInsight as string })),
  }
}

/** Series: last 8 analysed instances vs the 8 before; null under 6 analysed instances. */
export async function seriesWarmth(db: Db, seriesId: string, now = new Date()): Promise<WarmthResult> {
  const today = now.toISOString().slice(0, 10)
  const instances = await db.select({ id: meetings.id }).from(meetings).where(eq(meetings.seriesId, seriesId))
  const timeline = (await analysedMeetings(db, instances.map((m) => m.id)))
    .filter((p) => p.date <= today)
    .slice(0, SERIES_WINDOW * 2)
  const recentCount = Math.min(SERIES_WINDOW, Math.ceil(timeline.length / 2))
  const recent = timeline.slice(0, recentCount).map((p) => p.sentiment)
  const older = timeline.slice(recentCount).map((p) => p.sentiment)
  return {
    trend: timeline.length >= SERIES_MIN_INSTANCES ? compareTrend(recent, older) : null,
    recentAvg: avg(recent),
    olderAvg: avg(older),
    count: timeline.length,
    timeline,
  }
}

export interface ReasonPoint {
  date: string
  score: number | null
  mood: string | null
  scoreRationale: string | null
}

function meanScore(points: ReasonPoint[]): number | null {
  const scores = points.map((p) => p.score).filter((s): s is number => s != null)
  if (scores.length === 0) return null
  return Math.round(scores.reduce((s, n) => s + n, 0) / scores.length)
}

function clip(text: string, max = 80): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

function dayLabel(date: string): string {
  const [, m, d] = date.split('-')
  return m && d ? `${Number(d)}.${Number(m)}` : date
}

/** One sentence from the 1–10 scores and the latest mood or rationale. No LLM. */
export function dataReason(recent: ReasonPoint[], older: ReasonPoint[]): string {
  const r = meanScore(recent)
  const o = meanScore(older)
  let head = 'הציון השתנה בין התקופות.'
  if (r != null && o != null && r < o) head = `הציון ירד מ־${o} ל־${r}.`
  else if (r != null && o != null && r > o) head = `הציון עלה מ־${o} ל־${r}.`
  else if (r != null && o != null) head = `הציון נשאר ${r}.`
  const latest = recent.find((p) => p.mood?.trim() || p.scoreRationale?.trim())
  if (!latest) return head
  const bit = latest.mood?.trim()
    ? `האווירה תוארה כ${clip(latest.mood)}`
    : clip(latest.scoreRationale ?? '')
  return `${head} ב־${dayLabel(latest.date)} ${bit}.`
}

export interface BoardPoint {
  meetingId: string
  date: string
  title: string
  score: number | null
  sentiment: number
}

export type BoardTrend = 'warming' | 'cooling' | 'stable' | null

export interface RelationshipCard {
  id: string
  name: string
  trend: BoardTrend
  recentAvg: number | null
  olderAvg: number | null
  count: number
  minForTrend: number
  avgScore: number | null
  /** Analysed meetings in the recent window the trend was computed from. */
  recentCount: number
  lastDate: string | null
  latestMood: string | null
  latestInsight: string | null
  dataReason: string
  note: string | null
  noteUpdatedAt: string | null
  timeline: BoardPoint[]
}

export interface RelationshipBoard {
  people: RelationshipCard[]
  circles: RelationshipCard[]
  summary: { analysedMeetings: number; peopleWithData: number; circlesWithData: number }
}

interface RichPoint extends BoardPoint, ReasonPoint {
  mood: string | null
  scoreRationale: string | null
  keyInsight: string | null
}

function fmtTenth(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1)
}

/** Sentence under a card that is not moving. */
function restingReason(trend: BoardTrend, count: number, min: number, avgScore: number | null): string {
  if (trend === 'stable') return avgScore != null ? `הציון סביב ${fmtTenth(avgScore)} מתוך 10.` : 'הציון לא זז בין התקופות.'
  const unit = min === SERIES_MIN_INSTANCES ? 'מפגשים מנותחים' : 'שיחות מנותחות'
  return `אחרי ${min} ${unit} תופיע מגמה. עד עכשיו ${count}.`
}

function toCard(
  id: string,
  name: string,
  trend: BoardTrend,
  min: number,
  recent: RichPoint[],
  older: RichPoint[],
  note: string | null,
  noteUpdatedAt: string | null,
  timeline: RichPoint[],
): RelationshipCard {
  const recentSent = recent.map((p) => p.sentiment)
  const olderSent = older.map((p) => p.sentiment)
  const avgScore = tenth(timeline.map((p) => p.score))
  const latest = timeline.find((p) => p.mood?.trim() || p.keyInsight?.trim()) ?? timeline[0]
  const moving = trend === 'warming' || trend === 'cooling'
  return {
    id,
    name,
    trend,
    recentAvg: avg(recentSent),
    olderAvg: avg(olderSent),
    count: timeline.length,
    minForTrend: min,
    avgScore,
    recentCount: recent.length,
    lastDate: timeline[0]?.date ?? null,
    latestMood: latest?.mood?.trim() ? clip(latest.mood, 80) : null,
    latestInsight: latest?.keyInsight?.trim() ? clip(latest.keyInsight, 140) : null,
    dataReason: moving ? dataReason(recent, older) : restingReason(trend, timeline.length, min, avgScore),
    note,
    noteUpdatedAt,
    timeline: timeline.slice(0, 12).map(({ meetingId, date, title, score, sentiment }) => ({
      meetingId, date, title, score, sentiment,
    })),
  }
}

/** Movers first by gap, then stable, then no trend; the resting ones by last meeting. */
function boardOrder(a: RelationshipCard, b: RelationshipCard): number {
  const rank = (c: RelationshipCard) => (c.trend === 'cooling' ? 0 : c.trend === 'warming' ? 1 : c.trend === 'stable' ? 2 : 3)
  const gap = (c: RelationshipCard) => Math.abs((c.recentAvg ?? 0) - (c.olderAvg ?? 0))
  const ra = rank(a)
  const rb = rank(b)
  if (ra !== rb) return ra - rb
  if (ra <= 1) return gap(b) - gap(a)
  return (b.lastDate ?? '').localeCompare(a.lastDate ?? '')
}

interface Bucket {
  name: string
  note: string | null
  noteUpdatedAt: string | null
  points: RichPoint[]
}

const CIRCLE_MIN_SHOWN = 2

/**
 * Every confirmed person and every series with analysed conversations in the window,
 * with trend where the data allows it, the data sentence, and the owner's note.
 */
export async function relationshipBoard(db: Db, now = new Date()): Promise<RelationshipBoard> {
  const cutoff90 = isoDaysAgo(90, now)
  const cutoff180 = isoDaysAgo(180, now)
  const today = now.toISOString().slice(0, 10)
  const personRows = await db
    .select({
      personId: people.id,
      name: people.name,
      note: people.warmthNote,
      noteUpdatedAt: people.warmthNoteUpdatedAt,
      meetingId: meetings.id,
      date: meetings.date,
      title: meetings.title,
      score: meetingAnalyses.score,
      mood: meetingAnalyses.mood,
      scoreRationale: meetingAnalyses.scoreRationale,
      keyInsight: meetingAnalyses.keyInsight,
      subtext: meetingAnalyses.subtext,
    })
    .from(meetingPeople)
    .innerJoin(people, eq(people.id, meetingPeople.personId))
    .innerJoin(meetings, eq(meetings.id, meetingPeople.meetingId))
    .innerJoin(meetingAnalyses, eq(meetingAnalyses.meetingId, meetings.id))
    .where(and(
      eq(people.status, 'confirmed'),
      isNotNull(meetingAnalyses.score),
      gte(meetings.date, cutoff180),
      lte(meetings.date, today),
    ))
    .orderBy(desc(meetings.date))

  const analysedMeetingIds = new Set<string>()
  const peopleBuckets = new Map<string, Bucket>()
  const seenPerson = new Set<string>()
  for (const r of personRows) {
    analysedMeetingIds.add(r.meetingId)
    if (isSelfPersonName(r.name)) continue
    const key = `${r.personId}:${r.meetingId}`
    if (seenPerson.has(key)) continue
    seenPerson.add(key)
    const bucket = peopleBuckets.get(r.personId) ?? { name: r.name, note: r.note, noteUpdatedAt: r.noteUpdatedAt, points: [] }
    bucket.points.push({
      meetingId: r.meetingId,
      date: r.date,
      title: r.title,
      score: r.score,
      mood: r.mood,
      scoreRationale: r.scoreRationale,
      keyInsight: r.keyInsight,
      sentiment: analysisSentiment(r),
    })
    peopleBuckets.set(r.personId, bucket)
  }

  const personCards: RelationshipCard[] = []
  for (const [id, bucket] of peopleBuckets) {
    const { recent, older } = splitPersonWindows(bucket.points, cutoff90)
    const trend = bucket.points.length >= PERSON_MIN_INTERACTIONS
      ? compareTrend(recent.map((p) => p.sentiment), older.map((p) => p.sentiment))
      : null
    personCards.push(toCard(id, bucket.name, trend, PERSON_MIN_INTERACTIONS, recent, older, bucket.note, bucket.noteUpdatedAt, bucket.points))
  }

  const circleRows = await db
    .select({
      seriesId: meetingSeries.id,
      name: meetingSeries.title,
      note: meetingSeries.warmthNote,
      noteUpdatedAt: meetingSeries.warmthNoteUpdatedAt,
      meetingId: meetings.id,
      date: meetings.date,
      title: meetings.title,
      score: meetingAnalyses.score,
      mood: meetingAnalyses.mood,
      scoreRationale: meetingAnalyses.scoreRationale,
      keyInsight: meetingAnalyses.keyInsight,
      subtext: meetingAnalyses.subtext,
    })
    .from(meetingSeries)
    .innerJoin(meetings, eq(meetings.seriesId, meetingSeries.id))
    .innerJoin(meetingAnalyses, eq(meetingAnalyses.meetingId, meetings.id))
    .where(and(isNotNull(meetingAnalyses.score), lte(meetings.date, today)))
    .orderBy(desc(meetings.date))

  const circleBuckets = new Map<string, Bucket>()
  const seenCircle = new Set<string>()
  for (const r of circleRows) {
    const key = `${r.seriesId}:${r.meetingId}`
    if (seenCircle.has(key)) continue
    seenCircle.add(key)
    const bucket = circleBuckets.get(r.seriesId) ?? { name: r.name, note: r.note, noteUpdatedAt: r.noteUpdatedAt, points: [] }
    if (bucket.points.length >= SERIES_WINDOW * 2) {
      circleBuckets.set(r.seriesId, bucket)
      continue
    }
    bucket.points.push({
      meetingId: r.meetingId,
      date: r.date,
      title: r.title,
      score: r.score,
      mood: r.mood,
      scoreRationale: r.scoreRationale,
      keyInsight: r.keyInsight,
      sentiment: analysisSentiment(r),
    })
    circleBuckets.set(r.seriesId, bucket)
  }

  const circleCards: RelationshipCard[] = []
  for (const [id, bucket] of circleBuckets) {
    if (bucket.points.length < CIRCLE_MIN_SHOWN) continue
    const recentCount = Math.min(SERIES_WINDOW, Math.ceil(bucket.points.length / 2))
    const recent = bucket.points.slice(0, recentCount)
    const older = bucket.points.slice(recentCount)
    const trend = bucket.points.length >= SERIES_MIN_INSTANCES
      ? compareTrend(recent.map((p) => p.sentiment), older.map((p) => p.sentiment))
      : null
    circleCards.push(toCard(id, bucket.name, trend, SERIES_MIN_INSTANCES, recent, older, bucket.note, bucket.noteUpdatedAt, bucket.points))
  }

  personCards.sort(boardOrder)
  circleCards.sort(boardOrder)
  return {
    people: personCards,
    circles: circleCards,
    summary: {
      analysedMeetings: analysedMeetingIds.size,
      peopleWithData: personCards.length,
      circlesWithData: circleCards.length,
    },
  }
}

export async function setWarmthNote(
  db: Db,
  subject: 'person' | 'circle',
  id: string,
  note: string | null,
): Promise<{ note: string | null; noteUpdatedAt: string | null } | null> {
  const clean = note?.trim() ? note.trim() : null
  const noteUpdatedAt = clean ? new Date().toISOString() : null
  if (subject === 'person') {
    const [row] = await db.select({ id: people.id }).from(people).where(eq(people.id, id))
    if (!row) return null
    await db.update(people).set({ warmthNote: clean, warmthNoteUpdatedAt: noteUpdatedAt }).where(eq(people.id, id))
  } else {
    const [row] = await db.select({ id: meetingSeries.id }).from(meetingSeries).where(eq(meetingSeries.id, id))
    if (!row) return null
    await db.update(meetingSeries).set({ warmthNote: clean, warmthNoteUpdatedAt: noteUpdatedAt }).where(eq(meetingSeries.id, id))
  }
  return { note: clean, noteUpdatedAt }
}

/**
 * Relationship / circle warmth from meeting analyses. Computed on read — no stored trend yet.
 * Sentiment per analysis lies in [-1, 1]: mostly the 1–10 score, nudged by mood/subtext wording.
 */
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm'
import { meetingAnalyses, meetingPeople, meetings, type getDb } from '@ak-system/database'

type Db = ReturnType<typeof getDb>

export type WarmthTrend = 'warming' | 'cooling' | 'stable'

export interface SentimentPoint {
  meetingId: string
  analysisId: string
  date: string
  title: string
  score: number | null
  mood: string | null
  sentiment: number
}

export interface WarmthResult {
  trend: WarmthTrend | null
  recentAvg: number | null
  olderAvg: number | null
  count: number
  timeline: SentimentPoint[]
}

const TREND_THRESHOLD = 0.2
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
  const recent = timeline.filter((p) => p.date >= cutoff90).map((p) => p.sentiment)
  const older = timeline.filter((p) => p.date < cutoff90).map((p) => p.sentiment)
  return {
    trend: timeline.length >= PERSON_MIN_INTERACTIONS ? compareTrend(recent, older) : null,
    recentAvg: avg(recent),
    olderAvg: avg(older),
    count: timeline.length,
    timeline,
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

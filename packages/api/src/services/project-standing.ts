/**
 * One Hebrew brief per project, written by Gemini from analyses already saved.
 * A page load never calls Gemini.
 */
import { desc, eq, inArray } from 'drizzle-orm'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { meetingAnalyses, meetings, projects, type getDb } from '@ak-system/database'
import { projectWarmth } from './warmth'

type Db = ReturnType<typeof getDb>

export function standingIsStale(briefAt: string | null, latestAnalysisAt: string | null): boolean {
  if (!briefAt || !latestAnalysisAt) return false
  return latestAnalysisAt > briefAt
}

export async function readProjectStanding(db: Db, projectId: string) {
  const [project] = await db
    .select({ brief: projects.standingBrief, briefAt: projects.standingBriefAt })
    .from(projects)
    .where(eq(projects.id, projectId))
  const warmth = await projectWarmth(db, projectId)
  const ids = warmth.timeline.map((point) => point.meetingId)
  const stamps = ids.length === 0
    ? []
    : await db
      .select({ updatedAt: meetingAnalyses.updatedAt })
      .from(meetingAnalyses)
      .where(inArray(meetingAnalyses.meetingId, ids))
      .orderBy(desc(meetingAnalyses.updatedAt))
      .limit(1)
  return {
    brief: project?.brief ?? null,
    briefAt: project?.briefAt ?? null,
    stale: standingIsStale(project?.briefAt ?? null, stamps[0]?.updatedAt ?? null),
  }
}

export async function writeProjectStanding(db: Db, projectId: string) {
  const [project] = await db.select({ id: projects.id, name: projects.name }).from(projects).where(eq(projects.id, projectId))
  if (!project) throw new Error('הפרויקט לא נמצא.')
  const warmth = await projectWarmth(db, projectId)
  if (warmth.timeline.length === 0) throw new Error('עוד אין שיחות מנותחות בפרויקט.')

  const ids = warmth.timeline.map((point) => point.meetingId)
  const details = await db
    .select({
      meetingId: meetings.id,
      title: meetings.title,
      date: meetings.date,
      topic: meetingAnalyses.topic,
      keyInsight: meetingAnalyses.keyInsight,
      mood: meetingAnalyses.mood,
      subtext: meetingAnalyses.subtext,
      score: meetingAnalyses.score,
      scoreRationale: meetingAnalyses.scoreRationale,
    })
    .from(meetingAnalyses)
    .innerJoin(meetings, eq(meetings.id, meetingAnalyses.meetingId))
    .where(inArray(meetingAnalyses.meetingId, ids))

  const seen = new Set<string>()
  const meetingsPayload = []
  for (const row of details) {
    if (seen.has(row.meetingId)) continue
    seen.add(row.meetingId)
    meetingsPayload.push(row)
  }

  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('ניתוח התמצית לא זמין כרגע. אפשר לנסות שוב מאוחר יותר.')

  const model = new GoogleGenerativeAI(key).getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  })
  const prompt = [
    `כתוב בעברית תמצית של איפה הפרויקט "${project.name}" עומד.`,
    'התבסס רק על הניתוחים השמורים כאן. אל תמציא שיחות.',
    'ארבע פסקאות קצרות: מה זז בפרויקט, האווירה בחדר, האנשים, איכות השיחות.',
    'בלי כותרות באנגלית ובלי ציון מספרי כתחליף לאווירה או לאנשים.',
    '',
    JSON.stringify({
      meetings: meetingsPayload,
      people: warmth.people.map((person) => ({ name: person.name, text: person.text })),
    }),
  ].join('\n')

  let text = ''
  try {
    const result = await model.generateContent(prompt)
    text = result.response.text().trim()
  } catch {
    throw new Error('לא הצלחנו לכתוב תמצית. התמצית הקודמת נשארה. אפשר לנסות שוב.')
  }
  if (!text) throw new Error('לא הצלחנו לכתוב תמצית. התמצית הקודמת נשארה. אפשר לנסות שוב.')

  const now = new Date().toISOString()
  await db.update(projects).set({ standingBrief: text, standingBriefAt: now, updatedAt: now }).where(eq(projects.id, projectId))
  return { brief: text, briefAt: now, stale: false }
}

/**
 * One-call depth for a project or a topic (spec: harness-project-topic-nodes).
 * Reads live tables plus the harness insights and linked memories — never transcript text.
 */
import { loadWorldMap, worldOf } from './world-scope'
import { and, asc, desc, eq, gte, inArray, sql } from 'drizzle-orm'
import {
  meetingAnalyses,
  meetings,
  people,
  projectPeople,
  projects,
  queryRows,
  tasks,
  whatsappGroups,
  type getDb,
} from '@ak-system/database'
import { topicTokens } from '../lib/topic-match'
import { nodeId } from './harness-context'
import { listOpenInsights } from './harness-reasoner'
import { normalizeTopic, recallMemories, wordTokens } from './memory-relevance'
import { readProjectStanding } from './project-standing'
import { projectWarmth } from './warmth'

type Db = ReturnType<typeof getDb>

const TOPIC_LOOKBACK_DAYS = 60

function insightLite(i: { title: string; body: string; severity: string; kind: string; sources: { label: string }[] }) {
  return { title: i.title, body: i.body, severity: i.severity, kind: i.kind, basedOn: i.sources.map((s) => s.label) }
}

export async function projectContext(db: Db, projectId: string) {
  const [project] = await queryRows<{ id: string; name: string; brief: string | null; workspaceId: string | null; workspaceSource: string | null }>(
    db
      .select({ id: projects.id, name: projects.name, brief: projects.standingBrief, workspaceId: projects.workspaceId, workspaceSource: projects.workspaceSource })
      .from(projects)
      .where(eq(projects.id, projectId))
      .limit(1),
  )
  if (!project) return { notFound: true as const }

  const [standing, warmth, openTasks, recentMeetings, members, insights, memories] = await Promise.all([
    readProjectStanding(db, projectId),
    projectWarmth(db, projectId).catch(() => null),
    queryRows<{ id: string; title: string; dueDate: string | null; priority: string | null; status: string | null }>(
      db
        .select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate, priority: tasks.priority, status: tasks.status })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), eq(tasks.done, false)))
        .orderBy(sql`case when ${tasks.dueDate} is null then 1 else 0 end`, asc(tasks.dueDate))
        .limit(10),
    ),
    queryRows<{ id: string; title: string; date: string }>(
      db.select({ id: meetings.id, title: meetings.title, date: meetings.date }).from(meetings).where(eq(meetings.projectId, projectId)).orderBy(desc(meetings.date)).limit(5),
    ),
    queryRows<{ id: string; name: string; role: string | null }>(
      db
        .select({ id: people.id, name: people.name, role: people.role })
        .from(projectPeople)
        .innerJoin(people, eq(people.id, projectPeople.personId))
        .where(eq(projectPeople.projectId, projectId)),
    ),
    listOpenInsights(db, { limit: 50 }),
    recallMemories(db, { links: [{ kind: 'project', entityId: projectId, label: project.name }] }),
  ])

  const analyses = recentMeetings.length
    ? await queryRows<{ meetingId: string | null; keyInsight: string | null; topic: string | null }>(
        db
          .select({ meetingId: meetingAnalyses.meetingId, keyInsight: meetingAnalyses.keyInsight, topic: meetingAnalyses.topic })
          .from(meetingAnalyses)
          .where(inArray(meetingAnalyses.meetingId, recentMeetings.map((m) => m.id))),
      )
    : []
  const node = nodeId('project', projectId)

  return {
    notFound: false as const,
    name: project.name,
    world: await (async () => {
      const map = await loadWorldMap(db)
      const w = worldOf(map, project.workspaceId)
      return w ? { name: map.names.get(w) ?? w, source: project.workspaceSource } : null
    })(),
    brief: standing.brief ?? project.brief,
    briefStale: standing.stale,
    warmth: warmth ? { trend: warmth.trend, recentAvg: warmth.recentAvg, text: warmth.scoreText } : null,
    openTasks,
    recentMeetings: recentMeetings.map((m) => {
      const a = analyses.find((x) => x.meetingId === m.id)
      return { title: m.title, date: m.date, summary: a?.keyInsight ?? a?.topic ?? null }
    }),
    people: members,
    insights: insights.filter((i) => i.sources.some((s) => s.nodeId === node)).map(insightLite),
    memories: memories.scoped[0]?.memories.map((m) => m.content) ?? [],
  }
}

function textHasToken(text: string | null | undefined, token: string): boolean {
  if (!text) return false
  return topicTokens(text).includes(token) || wordTokens(text).includes(token)
}

export async function topicContext(db: Db, topic: string, now = new Date()) {
  const token = normalizeTopic(topic)[0]
  if (!token) return { notFound: true as const }
  const since = new Date(now.getTime() - TOPIC_LOOKBACK_DAYS * 86400000).toISOString().slice(0, 10)

  const [meetingRows, taskRows, groupRows, memories] = await Promise.all([
    queryRows<{ id: string; title: string; date: string }>(
      db.select({ id: meetings.id, title: meetings.title, date: meetings.date }).from(meetings).where(gte(meetings.date, since)).orderBy(desc(meetings.date)).limit(500),
    ),
    queryRows<{ id: string; title: string; dueDate: string | null }>(
      db.select({ id: tasks.id, title: tasks.title, dueDate: tasks.dueDate }).from(tasks).where(eq(tasks.done, false)).limit(1000),
    ),
    queryRows<{ jid: string; name: string | null }>(db.select({ jid: whatsappGroups.jid, name: whatsappGroups.name }).from(whatsappGroups)),
    recallMemories(db, { links: [{ kind: 'topic', entityId: token, label: token }] }),
  ])
  const analyses = meetingRows.length
    ? await queryRows<{ meetingId: string | null; topic: string | null; keyInsight: string | null }>(
        db
          .select({ meetingId: meetingAnalyses.meetingId, topic: meetingAnalyses.topic, keyInsight: meetingAnalyses.keyInsight })
          .from(meetingAnalyses)
          .where(inArray(meetingAnalyses.meetingId, meetingRows.map((m) => m.id))),
      )
    : []
  const analysisByMeeting = new Map(analyses.map((a) => [a.meetingId, a]))

  const matchedMeetings = meetingRows
    .filter((m) => textHasToken(m.title, token) || textHasToken(analysisByMeeting.get(m.id)?.topic, token))
    .slice(0, 15)
    .map((m) => ({ title: m.title, date: m.date, summary: analysisByMeeting.get(m.id)?.keyInsight ?? null }))
  const matchedTasks = taskRows.filter((t) => textHasToken(t.title, token)).slice(0, 15)
  const matchedGroups = groupRows.filter((g) => textHasToken(g.name, token)).map((g) => g.name as string)
  const memoryLines = memories.scoped[0]?.memories.map((m) => m.content) ?? []

  const empty = matchedMeetings.length + matchedTasks.length + matchedGroups.length + memoryLines.length === 0
  return {
    notFound: empty,
    topic: token,
    meetings: matchedMeetings,
    openTasks: matchedTasks,
    whatsappGroups: matchedGroups,
    memories: memoryLines,
  }
}

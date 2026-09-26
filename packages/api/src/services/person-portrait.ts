/**
 * Character traits for one person, written on click from conversations already stored.
 * A page load never calls Gemini. A source artifact is sent only when it is new or updated.
 */
import { randomUUID } from 'crypto'
import { and, desc, eq, inArray } from 'drizzle-orm'
import { GoogleGenerativeAI } from '@google/generative-ai'
import {
  commitments,
  meetingAnalyses,
  meetingPeople,
  meetings,
  people,
  personEmailThreads,
  personObservations,
  personSourceScans,
  personTraitEvidence,
  personTraits,
  whatsappDmSummaries,
  type getDb,
} from '@ak-system/database'
import { gmailThreadUrl } from './commitments'

type Db = ReturnType<typeof getDb>

const FAIL = 'לא הצלחנו לנתח. התכונות הקודמות נשמרו. נסה שוב.'
const SHOWN_LIMIT = 7

export type SourceKind = 'meeting_analysis' | 'whatsapp_dm_summary' | 'email_thread'

export interface TraitSummary {
  traits: { id: string; label: string; line: string; supportCount: number }[]
  traitsAt: string | null
  stale: boolean
  hasSources: boolean
  sourceCount: number
  evidenceCount: number
}

export interface TraitEvidence {
  observationId: string
  sourceKind: SourceKind
  sourceDate: string
  quote: string | null
  href: string | null
}

export interface TraitDetailRow {
  id: string
  label: string
  line: string
  reasoning: string
  supportCount: number
  evidence: TraitEvidence[]
}

interface Artifact {
  sourceKind: SourceKind
  sourceId: string
  sourceUpdatedAt: string
  sourceDate: string
  text: string
}

interface ObservationDraft {
  id: string
  claim: string
  quote: string | null
  sourceKind: SourceKind
  sourceId: string
  sourceDate: string
}

interface ClusterTrait {
  label: string
  clause: string
  reasoning: string
  observationIds: string[]
}

export interface PortraitModel {
  extract(artifacts: Artifact[]): Promise<{ sourceId: string; claim: string; quote: string | null }[]>
  cluster(input: {
    name: string
    observations: { id: string; claim: string; sourceDate: string }[]
    excludedLabels: string[]
    commitments: { content: string; status: string }[]
  }): Promise<ClusterTrait[]>
}

export function normalizeLabel(label: string): string {
  return label.replace(/\s+/g, ' ').trim()
}

export function buildTraitLine(label: string, clause: string): string {
  const name = normalizeLabel(label).split(' ').slice(0, 3).join(' ')
  const room = 90 - name.length - 1
  const text = clause.replace(/\s+/g, ' ').trim()
  if (!name) return text.slice(0, 90)
  if (room < 4) return name.slice(0, 90)
  const cut = text.length > room ? `${text.slice(0, room - 1).trimEnd()}…` : text
  return cut ? `${name} ${cut}` : name
}

export function traitsAreStale(traitsAt: string | null, newestSourceAt: string | null): boolean {
  if (!traitsAt || !newestSourceAt) return false
  return newestSourceAt > traitsAt
}

export interface ClassifiedTrait {
  label: string
  line: string
  reasoning: string
  supportCount: number
  latestSourceDate: string
  status: 'shown' | 'once'
  observationIds: string[]
}

export function classifyTraits(
  raw: ClusterTrait[],
  observations: { id: string; sourceId: string; sourceDate: string }[],
  excludedLabels: string[],
): ClassifiedTrait[] {
  const byId = new Map(observations.map((o) => [o.id, o]))
  const excluded = new Set(excludedLabels.map(normalizeLabel).filter(Boolean))
  const best = new Map<string, ClassifiedTrait>()
  for (const trait of raw) {
    const label = normalizeLabel(trait.label).split(' ').slice(0, 3).join(' ')
    if (!label || excluded.has(label)) continue
    const linked = [...new Set(trait.observationIds)].map((id) => byId.get(id)).filter((o): o is NonNullable<typeof o> => !!o)
    const sourceIds = new Set(linked.map((o) => o.sourceId))
    if (sourceIds.size === 0) continue
    const latestSourceDate = linked.map((o) => o.sourceDate).sort().at(-1) ?? ''
    const next: ClassifiedTrait = {
      label,
      line: buildTraitLine(label, trait.clause),
      reasoning: trait.reasoning.replace(/\s+/g, ' ').trim().slice(0, 200),
      supportCount: sourceIds.size,
      latestSourceDate,
      status: sourceIds.size >= 2 ? 'shown' : 'once',
      observationIds: linked.map((o) => o.id),
    }
    const prev = best.get(label)
    if (!prev || next.supportCount > prev.supportCount || (next.supportCount === prev.supportCount && next.latestSourceDate > prev.latestSourceDate)) {
      best.set(label, next)
    }
  }
  return [...best.values()].sort((a, b) => b.supportCount - a.supportCount || b.latestSourceDate.localeCompare(a.latestSourceDate))
}

async function callModel<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (err) {
    if (err instanceof Error && (err.message === FAIL || err.message === 'אין עדיין שיחות לנתח.' || err.message === 'NOT_FOUND')) throw err
    throw new Error(FAIL)
  }
}

function nid(prefix: string): string {
  return `${prefix}_${randomUUID().slice(0, 8)}`
}

function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > max ? t.slice(0, max) : t
}

function quoteFrom(artifactText: string, quote: string | null): string | null {
  if (!quote) return null
  const q = clip(quote, 160)
  const hay = artifactText.replace(/\s+/g, ' ')
  return hay.includes(q.slice(0, Math.min(40, q.length))) ? q : null
}

function dayFromTs(ts: number): string {
  return new Date(ts).toISOString().slice(0, 10)
}

async function loadArtifacts(db: Db, personId: string): Promise<{ artifacts: Artifact[]; commitments: { content: string; status: string }[] }> {
  const analyses = await db
    .select({
      id: meetingAnalyses.id,
      updatedAt: meetingAnalyses.updatedAt,
      date: meetings.date,
      title: meetings.title,
      mood: meetingAnalyses.mood,
      subtext: meetingAnalyses.subtext,
      keyInsight: meetingAnalyses.keyInsight,
      scoreRationale: meetingAnalyses.scoreRationale,
    })
    .from(meetingAnalyses)
    .innerJoin(meetings, eq(meetings.id, meetingAnalyses.meetingId))
    .innerJoin(meetingPeople, eq(meetingPeople.meetingId, meetings.id))
    .where(and(eq(meetingPeople.personId, personId), eq(meetingAnalyses.status, 'completed')))
    .orderBy(desc(meetings.date))
    .limit(16)

  const summaries = await db
    .select()
    .from(whatsappDmSummaries)
    .where(eq(whatsappDmSummaries.personId, personId))
    .orderBy(desc(whatsappDmSummaries.toTs))
    .limit(8)

  const threads = await db
    .select()
    .from(personEmailThreads)
    .where(eq(personEmailThreads.personId, personId))
    .orderBy(desc(personEmailThreads.date))
    .limit(8)

  const commitmentRows = await db
    .select({ content: commitments.content, status: commitments.status })
    .from(commitments)
    .where(and(eq(commitments.personId, personId), eq(commitments.owner, 'them')))
    .orderBy(desc(commitments.updatedAt))
    .limit(12)

  const artifacts: Artifact[] = [
    ...analyses.map((a) => ({
      sourceKind: 'meeting_analysis' as const,
      sourceId: a.id,
      sourceUpdatedAt: a.updatedAt,
      sourceDate: a.date.slice(0, 10),
      text: [a.title, a.date, a.mood, a.subtext, a.keyInsight, a.scoreRationale].filter(Boolean).join('\n'),
    })),
    ...summaries.map((s) => ({
      sourceKind: 'whatsapp_dm_summary' as const,
      sourceId: s.id,
      sourceUpdatedAt: s.createdAt,
      sourceDate: dayFromTs(s.toTs),
      text: s.summary,
    })),
    ...threads.map((t) => ({
      sourceKind: 'email_thread' as const,
      sourceId: t.id,
      sourceUpdatedAt: t.lastSyncedAt,
      sourceDate: t.date.slice(0, 10),
      text: [t.subject, t.snippet].filter(Boolean).join('\n'),
    })),
  ]
  return { artifacts, commitments: commitmentRows }
}

function geminiModel(): PortraitModel {
  return {
    async extract(artifacts) {
      const parsed = await generateJson([
        'חלץ תצפיות על ההתנהגות של האדם מהשיחות. אפס עד שלוש תצפיות לכל פריט.',
        'כל תצפית היא משפט עברי אחד על מה שהוא עושה, לא אבחון ולא סוג אישיות.',
        'quote חייב להיות ציטוט מתוך הטקסט של אותו פריט. אם אין ציטוט, השאר ריק.',
        'החזר JSON: {"observations":[{"sourceId":"","claim":"","quote":""}]}',
        JSON.stringify(artifacts.map((a) => ({ sourceId: a.sourceId, sourceKind: a.sourceKind, date: a.sourceDate, text: a.text }))),
      ].join('\n'))
      const rows = Array.isArray((parsed as { observations?: unknown }).observations)
        ? (parsed as { observations: { sourceId?: string; claim?: string; quote?: string }[] }).observations
        : []
      return rows
        .filter((row) => row.sourceId && row.claim)
        .map((row) => ({ sourceId: String(row.sourceId), claim: String(row.claim), quote: row.quote ? String(row.quote) : null }))
    },
    async cluster(input) {
      const parsed = await generateJson([
        `קבץ את התצפיות על ${input.name} לתכונות אופי.`,
        'כל תכונה: label של מילה עד שלוש, clause קצרה, reasoning במשפט אחד, ו-observationIds מהרשימה בלבד.',
        'אל תמציא תכונה בלי תצפיות. אל תשתמש במונח קליני או במבחן אישיות.',
        input.excludedLabels.length ? `אל תחזיר את התכונות האלה: ${input.excludedLabels.join(', ')}` : '',
        'החזר JSON: {"traits":[{"label":"","clause":"","reasoning":"","observationIds":[]}]}',
        JSON.stringify({ observations: input.observations, commitments: input.commitments }),
      ].filter(Boolean).join('\n'))
      const rows = Array.isArray((parsed as { traits?: unknown }).traits)
        ? (parsed as { traits: ClusterTrait[] }).traits
        : []
      return rows
        .filter((row) => row && row.label && Array.isArray(row.observationIds))
        .map((row) => ({
          label: String(row.label),
          clause: String(row.clause ?? ''),
          reasoning: String(row.reasoning ?? ''),
          observationIds: row.observationIds.map(String),
        }))
    },
  }
}

async function generateJson(prompt: string): Promise<unknown> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error(FAIL)
  const model = new GoogleGenerativeAI(key).getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    generationConfig: { responseMimeType: 'application/json' },
  })
  let text = ''
  try {
    const result = await model.generateContent(prompt)
    text = result.response.text().trim()
  } catch {
    throw new Error(FAIL)
  }
  if (!text) throw new Error(FAIL)
  try {
    return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/```$/, '')) as unknown
  } catch {
    throw new Error(FAIL)
  }
}

async function summaryFor(db: Db, personId: string, artifacts: Artifact[]): Promise<TraitSummary> {
  const [person] = await db.select({ traitsAt: people.traitsAt }).from(people).where(eq(people.id, personId))
  const rows = await db.select().from(personTraits).where(and(eq(personTraits.personId, personId), eq(personTraits.status, 'shown')))
  const traits = rows
    .sort((a, b) => b.supportCount - a.supportCount || b.latestSourceDate.localeCompare(a.latestSourceDate))
    .slice(0, SHOWN_LIMIT)
  const evidence = traits.length === 0
    ? []
    : await db.select().from(personTraitEvidence).where(inArray(personTraitEvidence.traitId, traits.map((t) => t.id)))
  const observationIds = [...new Set(evidence.map((e) => e.observationId))]
  const observations = observationIds.length === 0
    ? []
    : await db.select().from(personObservations).where(inArray(personObservations.id, observationIds))
  const newest = artifacts.map((a) => a.sourceUpdatedAt).sort().at(-1) ?? null
  return {
    traits: traits.map((t) => ({ id: t.id, label: t.label, line: t.line, supportCount: t.supportCount })),
    traitsAt: person?.traitsAt ?? null,
    stale: traitsAreStale(person?.traitsAt ?? null, newest),
    hasSources: artifacts.length > 0,
    sourceCount: new Set(observations.map((o) => `${o.sourceKind}:${o.sourceId}`)).size,
    evidenceCount: evidence.length,
  }
}

export async function readPersonTraits(db: Db, personId: string): Promise<TraitSummary> {
  const { artifacts } = await loadArtifacts(db, personId)
  return summaryFor(db, personId, artifacts)
}

export async function readPersonTraitDetail(db: Db, personId: string): Promise<{ shown: TraitDetailRow[]; once: TraitDetailRow[] }> {
  const traits = await db.select().from(personTraits).where(eq(personTraits.personId, personId))
  const active = traits.filter((t) => t.status === 'shown' || t.status === 'once')
  const evidence = active.length === 0
    ? []
    : await db.select().from(personTraitEvidence).where(inArray(personTraitEvidence.traitId, active.map((t) => t.id)))
  const observationIds = [...new Set(evidence.map((e) => e.observationId))]
  const observations = observationIds.length === 0
    ? []
    : await db.select().from(personObservations).where(inArray(personObservations.id, observationIds))
  const byObs = new Map(observations.map((o) => [o.id, o]))
  const hrefs = await hrefsFor(db, observations)
  const row = (trait: typeof active[number]): TraitDetailRow => ({
    id: trait.id,
    label: trait.label,
    line: trait.line,
    reasoning: trait.reasoning,
    supportCount: trait.supportCount,
    evidence: evidence
      .filter((e) => e.traitId === trait.id)
      .map((e) => byObs.get(e.observationId))
      .filter((o): o is NonNullable<typeof o> => !!o)
      .sort((a, b) => b.sourceDate.localeCompare(a.sourceDate))
      .map((o) => ({
        observationId: o.id,
        sourceKind: o.sourceKind as SourceKind,
        sourceDate: o.sourceDate,
        quote: o.quote,
        href: hrefs.get(`${o.sourceKind}:${o.sourceId}`) ?? null,
      })),
  })
  const shown = traits.filter((t) => t.status === 'shown').sort((a, b) => b.supportCount - a.supportCount || b.latestSourceDate.localeCompare(a.latestSourceDate)).slice(0, SHOWN_LIMIT).map(row)
  const once = traits.filter((t) => t.status === 'once').sort((a, b) => b.latestSourceDate.localeCompare(a.latestSourceDate)).map(row)
  return { shown, once }
}

async function hrefsFor(db: Db, observations: { sourceKind: string; sourceId: string }[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const analysisIds = observations.filter((o) => o.sourceKind === 'meeting_analysis').map((o) => o.sourceId)
  const emailIds = observations.filter((o) => o.sourceKind === 'email_thread').map((o) => o.sourceId)
  if (analysisIds.length) {
    const rows = await db.select({ id: meetingAnalyses.id, meetingId: meetingAnalyses.meetingId }).from(meetingAnalyses).where(inArray(meetingAnalyses.id, analysisIds))
    for (const row of rows) out.set(`meeting_analysis:${row.id}`, `/meetings/${row.meetingId}`)
  }
  if (emailIds.length) {
    const rows = await db.select({ id: personEmailThreads.id, gmailThreadId: personEmailThreads.gmailThreadId }).from(personEmailThreads).where(inArray(personEmailThreads.id, emailIds))
    for (const row of rows) out.set(`email_thread:${row.id}`, gmailThreadUrl(row.gmailThreadId))
  }
  return out
}

export async function writePersonTraits(db: Db, personId: string, model: PortraitModel = geminiModel()): Promise<TraitSummary> {
  const [person] = await db.select({ id: people.id, name: people.name }).from(people).where(eq(people.id, personId))
  if (!person) throw new Error('NOT_FOUND')
  const { artifacts, commitments: commitmentRows } = await loadArtifacts(db, personId)
  if (artifacts.length === 0) throw new Error('אין עדיין שיחות לנתח.')

  const scans = await db.select().from(personSourceScans).where(eq(personSourceScans.personId, personId))
  const scanByKey = new Map(scans.map((s) => [`${s.sourceKind}:${s.sourceId}`, s]))
  const dirty = artifacts.filter((a) => {
    const scan = scanByKey.get(`${a.sourceKind}:${a.sourceId}`)
    return !scan || a.sourceUpdatedAt > scan.sourceUpdatedAt
  })
  const kept = await db.select().from(personObservations).where(eq(personObservations.personId, personId))
  const windowKeys = new Set(artifacts.map((a) => `${a.sourceKind}:${a.sourceId}`))
  const dirtyKeys = new Set(dirty.map((a) => `${a.sourceKind}:${a.sourceId}`))
  const keptDrafts: ObservationDraft[] = kept
    .filter((o) => windowKeys.has(`${o.sourceKind}:${o.sourceId}`) && !dirtyKeys.has(`${o.sourceKind}:${o.sourceId}`))
    .map((o) => ({ id: o.id, claim: o.claim, quote: o.quote, sourceKind: o.sourceKind as SourceKind, sourceId: o.sourceId, sourceDate: o.sourceDate }))

  const bySource = new Map(artifacts.map((a) => [a.sourceId, a]))
  let fresh: ObservationDraft[] = []
  if (dirty.length > 0) {
    const extracted = await callModel(() => model.extract(dirty))
    const counts = new Map<string, number>()
    fresh = extracted.flatMap((row) => {
      const artifact = bySource.get(row.sourceId)
      if (!artifact || !dirtyKeys.has(`${artifact.sourceKind}:${artifact.sourceId}`)) return []
      const n = counts.get(row.sourceId) ?? 0
      if (n >= 3) return []
      counts.set(row.sourceId, n + 1)
      const claim = clip(row.claim, 200)
      if (!claim) return []
      return [{
        id: nid('po'),
        claim,
        quote: quoteFrom(artifact.text, row.quote),
        sourceKind: artifact.sourceKind,
        sourceId: artifact.sourceId,
        sourceDate: artifact.sourceDate,
      }]
    })
  }

  const observations = [...keptDrafts, ...fresh]
  const dismissed = await db.select({ label: personTraits.label }).from(personTraits).where(and(eq(personTraits.personId, personId), eq(personTraits.status, 'dismissed')))
  const classified = classifyTraits(
    await callModel(() => model.cluster({
      name: person.name,
      observations: observations.map((o) => ({ id: o.id, claim: o.claim, sourceDate: o.sourceDate })),
      excludedLabels: dismissed.map((d) => d.label),
      commitments: commitmentRows,
    })),
    observations,
    dismissed.map((d) => d.label),
  )

  const now = new Date().toISOString()
  await db.delete(personTraits).where(and(eq(personTraits.personId, personId), inArray(personTraits.status, ['shown', 'once'])))
  for (const artifact of dirty) {
    await db.delete(personObservations).where(and(
      eq(personObservations.personId, personId),
      eq(personObservations.sourceKind, artifact.sourceKind),
      eq(personObservations.sourceId, artifact.sourceId),
    ))
  }
  if (fresh.length) {
    await db.insert(personObservations).values(fresh.map((o) => ({ ...o, personId, createdAt: now })))
  }
  for (const trait of classified) {
    const id = nid('ptr')
    await db.insert(personTraits).values({
      id,
      personId,
      label: trait.label,
      line: trait.line,
      reasoning: trait.reasoning || trait.line,
      supportCount: trait.supportCount,
      latestSourceDate: trait.latestSourceDate,
      status: trait.status,
      createdAt: now,
      updatedAt: now,
    })
    if (trait.observationIds.length) {
      await db.insert(personTraitEvidence).values(trait.observationIds.map((observationId) => ({ id: nid('pte'), traitId: id, observationId })))
    }
  }
  for (const artifact of dirty) {
    const existing = scanByKey.get(`${artifact.sourceKind}:${artifact.sourceId}`)
    if (existing) {
      await db.update(personSourceScans).set({ sourceUpdatedAt: artifact.sourceUpdatedAt, scannedAt: now }).where(eq(personSourceScans.id, existing.id))
    } else {
      await db.insert(personSourceScans).values({
        id: nid('ps'),
        personId,
        sourceKind: artifact.sourceKind,
        sourceId: artifact.sourceId,
        sourceUpdatedAt: artifact.sourceUpdatedAt,
        scannedAt: now,
      })
    }
  }
  await db.update(people).set({ traitsAt: now }).where(eq(people.id, personId))

  return summaryFor(db, personId, artifacts)
}

export async function dismissPersonTrait(db: Db, traitId: string): Promise<{ id: string }> {
  const [row] = await db.select({ id: personTraits.id }).from(personTraits).where(eq(personTraits.id, traitId))
  if (!row) throw new Error('NOT_FOUND')
  await db.update(personTraits).set({ status: 'dismissed', updatedAt: new Date().toISOString() }).where(eq(personTraits.id, traitId))
  return { id: traitId }
}

export async function restorePersonTrait(db: Db, traitId: string): Promise<{ id: string }> {
  const [row] = await db.select({ id: personTraits.id }).from(personTraits).where(eq(personTraits.id, traitId))
  if (!row) throw new Error('NOT_FOUND')
  await db.update(personTraits).set({ status: 'shown', updatedAt: new Date().toISOString() }).where(eq(personTraits.id, traitId))
  return { id: traitId }
}

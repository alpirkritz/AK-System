import { InsightStrands } from '@/components/relationship/InsightStrands'

type TimelinePoint = {
  meetingId: string
  date: string
  title: string
  score: number | null
  scoreRationale: string | null
  mood: string | null
  subtext: string | null
  keyInsight: string | null
}

type PersonStanding = {
  personId: string
  name: string
  color: string | null
  trend: 'warming' | 'cooling' | 'stable' | null
  text: string
}

export type ProjectWarmth = {
  dataReason: string
  scoreText: string
  people: PersonStanding[]
  timeline: TimelinePoint[]
}

export function ProjectWarmthCard({ warmth, projectId }: { warmth: ProjectWarmth; projectId: string }) {
  return (
    <InsightStrands
      atmosphereText={warmth.dataReason}
      atmosphere={warmth.timeline}
      people={warmth.people ?? []}
      scoreText={warmth.scoreText}
      scores={warmth.timeline.map((point) => ({
        meetingId: point.meetingId,
        date: point.date,
        title: point.title,
        score: point.score,
        rationale: point.scoreRationale,
      }))}
      insights={warmth.timeline
        .filter((point) => point.keyInsight?.trim())
        .map((point) => ({ meetingId: point.meetingId, title: point.title, text: point.keyInsight as string }))}
      projectId={projectId}
    />
  )
}

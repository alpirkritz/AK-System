'use client'

import { trpc } from '@/lib/trpc'
import { InsightStrands } from '@/components/relationship/InsightStrands'

/** Shown once this meeting has a completed analysis. */
export function MeetingInsight({ meetingId }: { meetingId: string }) {
  const { data } = trpc.meetings.getInsight.useQuery({ meetingId })
  if (!data) return null
  return (
    <InsightStrands
      atmosphereText={data.atmosphereText}
      atmosphere={data.atmosphere}
      people={data.people}
      scoreText={data.scoreText}
      scores={data.scores}
      insights={data.insights}
      projectId={data.projectId}
    />
  )
}

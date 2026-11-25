'use client'

/**
 * "תמלול מלא" section of the meeting page (docs/specs/meeting-full-transcript-view.md).
 * Hidden when the meeting has no recording; the transcript is fetched only once expanded.
 */
import { useState } from 'react'
import { format } from 'date-fns'
import { trpc } from '@/lib/trpc'
import { TranscriptView } from '@/app/voice/components/TranscriptView'

export function MeetingTranscript({ meetingId }: { meetingId: string }) {
  const [open, setOpen] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  const { data: recordings = [] } = trpc.voice.recordingsForMeeting.useQuery({ meetingId })

  if (recordings.length === 0) return null
  const recordingId = picked && recordings.some((r) => r.id === picked) ? picked : recordings[0].id

  return (
    <div className="mt-6 pt-6 border-t border-gray-200 dark:border-gray-700" data-testid="meeting-transcript">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100 font-medium"
      >
        {open ? '▼' : '▶'} תמלול מלא
      </button>
      {open && (
        <div className="mt-4 p-4 bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 space-y-3">
          {recordings.length > 1 && (
            <select
              className="input text-sm"
              value={recordingId}
              onChange={(e) => setPicked(e.target.value)}
              aria-label="בחירת הקלטה"
              data-testid="transcript-recording-select"
            >
              {recordings.map((r) => (
                <option key={r.id} value={r.id}>
                  {format(new Date(r.createdAt), 'dd/MM HH:mm')}
                </option>
              ))}
            </select>
          )}
          <TranscriptView recordingId={recordingId} />
        </div>
      )}
    </div>
  )
}

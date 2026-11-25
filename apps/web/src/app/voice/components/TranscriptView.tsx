'use client'

/**
 * Full transcript of one recording (docs/specs/meeting-full-transcript-view.md).
 * Mount it only once the user expands "תמלול מלא" — the query runs on mount, so nothing is
 * fetched for collapsed sections. Falls back to the stored plain text when diarization produced
 * no segments, so a failed speaker detection never hides the transcript.
 */
import { useState } from 'react'
import { trpc } from '@/lib/trpc'
import { groupTranscript, transcriptToPlainText, formatTimestamp } from '../lib/transcript'

export function TranscriptView({ recordingId }: { recordingId: string }) {
  const { data, isLoading, error } = trpc.voice.transcript.useQuery(
    { recordingId },
    { refetchInterval: (d) => (d && ['uploaded', 'processing'].includes(d.status) ? 4000 : false) },
  )
  const [copied, setCopied] = useState(false)

  if (isLoading) return <p className="text-sm text-gray-500" data-testid="transcript-loading">טוען תמלול…</p>
  if (error || !data) return <p className="text-sm text-red-500" role="alert">לא ניתן לטעון את התמלול</p>
  if (data.status === 'uploaded' || data.status === 'processing') {
    return <p className="text-sm text-gray-500" data-testid="transcript-processing">התמלול בעבודה…</p>
  }
  if (data.status === 'failed') {
    return <p className="text-sm text-red-500" role="alert">{data.error ?? 'התמלול נכשל'}</p>
  }

  const turns = groupTranscript(data.segments)
  const plain = transcriptToPlainText(data.segments, data.text)
  if (!plain) return <p className="text-sm text-gray-500" data-testid="transcript-empty">אין תמלול להקלטה זו</p>

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(plain)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard can be blocked (insecure context / permissions); the text stays selectable.
    }
  }

  return (
    <div className="space-y-3" data-testid="transcript-view">
      <div className="flex items-center gap-2">
        <button type="button" className="btn btn-ghost text-xs py-1 px-3" onClick={copy} data-testid="transcript-copy">
          העתק תמלול
        </button>
        {copied && <span className="text-xs text-teal-500" role="status">הועתק</span>}
      </div>
      <div className="max-h-[32rem] overflow-y-auto space-y-3 pe-1" dir="rtl">
        {turns.length > 0 ? (
          turns.map((turn, i) => (
            <div key={i} data-testid="transcript-turn">
              <div className="text-xs font-semibold text-gray-500 dark:text-gray-400">
                {turn.speaker}
                <span className="ms-2 font-normal tabular-nums">{formatTimestamp(turn.startMs)}</span>
              </div>
              <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap">{turn.text}</p>
            </div>
          ))
        ) : (
          <p className="text-sm leading-relaxed text-gray-800 dark:text-gray-200 whitespace-pre-wrap" data-testid="transcript-plain">
            {data.text}
          </p>
        )}
      </div>
    </div>
  )
}

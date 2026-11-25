/** Pure helpers for rendering a recording's transcript (docs/specs/meeting-full-transcript-view.md). */

export interface TranscriptSegmentLike {
  speakerKey: string
  speakerName: string | null
  startMs: number
  text: string
}

export interface TranscriptTurn {
  speaker: string
  startMs: number
  text: string
}

/** `mm:ss`, or `h:mm:ss` from one hour on. */
export function formatTimestamp(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

/** Consecutive segments of the same speaker read as one paragraph. */
export function groupTranscript(segments: TranscriptSegmentLike[]): TranscriptTurn[] {
  const turns: (TranscriptTurn & { key: string })[] = []
  for (const seg of segments) {
    const last = turns[turns.length - 1]
    if (last && last.key === seg.speakerKey) {
      last.text += `\n${seg.text}`
    } else {
      turns.push({ key: seg.speakerKey, speaker: seg.speakerName ?? seg.speakerKey, startMs: seg.startMs, text: seg.text })
    }
  }
  return turns.map(({ speaker, startMs, text }) => ({ speaker, startMs, text }))
}

/** What "העתק תמלול" puts on the clipboard: `דובר: טקסט` per turn, or the stored text as a fallback. */
export function transcriptToPlainText(segments: TranscriptSegmentLike[], fallback: string | null): string {
  const turns = groupTranscript(segments)
  if (turns.length === 0) return (fallback ?? '').trim()
  return turns.map((t) => `${t.speaker}: ${t.text.replace(/\n/g, ' ')}`).join('\n')
}

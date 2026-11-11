/** Markers around notes typed while a recording is in progress. A later save replaces this block. */
export const RECORDING_NOTES_START = '--- הערות מההקלטה ---'
export const RECORDING_NOTES_END = '--- סוף הערות מההקלטה ---'

/** Keep notes that were already on the meeting, and replace only the recording block. */
export function mergeRecordingNotes(existing: string | null | undefined, capture: string): string | null {
  const prev = existing ?? ''
  const start = prev.indexOf(RECORDING_NOTES_START)
  const end = prev.indexOf(RECORDING_NOTES_END)
  const without = (start >= 0 && end > start
    ? `${prev.slice(0, start)}${prev.slice(end + RECORDING_NOTES_END.length)}`
    : prev
  ).trim()
  const body = capture.trim()
  if (!body) return without || null
  const block = `${RECORDING_NOTES_START}\n${body}\n${RECORDING_NOTES_END}`
  return without ? `${without}\n\n${block}` : block
}

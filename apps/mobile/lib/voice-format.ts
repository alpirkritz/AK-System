/** Pure helpers for the recorder screen. Server limits live in packages/api/src/services/voice.ts. */

export const VOICE_MIN_SECONDS = 10
export const VOICE_STUCK_MS = 10 * 60_000
export const LEVEL_BARS = 28

export const VOICE_STATUS_LABELS: Record<string, string> = {
  uploaded: 'ממתין לעיבוד',
  processing: 'מתמלל ומנתח…',
  completed: 'נותח',
  failed: 'נכשל',
}

export function voiceClock(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

/** expo-audio metering is dBFS (about -160…0); map the audible -60…0 range to 0…1. */
export function meterLevel(metering: number | undefined): number {
  if (metering === undefined || !Number.isFinite(metering)) return 0
  return Math.min(1, Math.max(0, (metering + 60) / 60))
}

export function pushLevel(levels: number[], level: number, size = LEVEL_BARS): number[] {
  const next = [...levels, level]
  return next.length > size ? next.slice(next.length - size) : next
}

export function isVoicePending(status: string | undefined): boolean {
  return status === 'uploaded' || status === 'processing'
}

export function isVoiceStuck(rec: { status: string; createdAt: string }, now = Date.now()): boolean {
  return rec.status === 'processing' && now - new Date(rec.createdAt).getTime() > VOICE_STUCK_MS
}

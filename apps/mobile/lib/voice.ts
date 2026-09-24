import { API_URL, ApiError, CLIENT_HEADER } from './api'
import { createTrpcClient } from './trpc'

export type MobileVoiceRecording = {
  id: string
  createdAt: string
  duration: number
  status: string
  error: string | null
  meetingId: string | null
  meetingTitle: string | null
  topic: string | null
  people: { id: string; name: string }[]
}

export type MobileVoiceAnalysis = {
  keyInsight: string | null
  actionItems: { content: string; owner?: string }[]
}

export type MobileAttachCandidate = { id: string; title: string; time: string; endTime: string | null }

/**
 * Multipart upload to `/api/voice/upload` (not tRPC — audio would be base64 over JSON).
 * XMLHttpRequest because fetch in React Native reports no upload progress.
 */
export function uploadVoiceRecording(
  token: string,
  input: { uri: string; durationSeconds: number; personIds: string[]; meetingId?: string },
  onProgress: (fraction: number) => void,
): Promise<{ recordingId: string }> {
  if (!API_URL) return Promise.reject(new ApiError('EXPO_PUBLIC_API_URL is not configured', 0))
  const form = new FormData()
  // React Native's FormData takes a { uri, name, type } descriptor for files.
  form.append('audio', { uri: input.uri, name: 'recording.m4a', type: 'audio/mp4' } as unknown as Blob)
  form.append('durationSeconds', String(Math.round(input.durationSeconds)))
  form.append('consentConfirmed', 'true')
  form.append('personIds', input.personIds.join(','))
  if (input.meetingId) form.append('meetingId', input.meetingId)

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', `${API_URL}/api/voice/upload`)
    xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.setRequestHeader('X-AK-Client', CLIENT_HEADER)
    xhr.setRequestHeader('ngrok-skip-browser-warning', 'true')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      let body: { recordingId?: string; error?: string } = {}
      try {
        body = JSON.parse(xhr.responseText) as typeof body
      } catch {
        // non-JSON (proxy error page) — fall through to the status message
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.recordingId) resolve({ recordingId: body.recordingId })
      else reject(new ApiError(body.error ?? `ההעלאה נכשלה (${xhr.status})`, xhr.status))
    }
    xhr.onerror = () => reject(new ApiError('ההעלאה נכשלה. בדוק את החיבור ונסה שוב.', 0))
    xhr.send(form)
  })
}

export async function fetchVoiceRecording(token: string, recordingId: string): Promise<MobileVoiceRecording> {
  const client = createTrpcClient(token)
  return (await client.voice.get.query({ recordingId })) as MobileVoiceRecording
}

export async function fetchVoiceAnalysis(token: string, recordingId: string): Promise<MobileVoiceAnalysis | null> {
  const client = createTrpcClient(token)
  const a = (await client.voice.getAnalysis.query({ recordingId })) as MobileVoiceAnalysis | null
  return a ? { keyInsight: a.keyInsight, actionItems: a.actionItems ?? [] } : null
}

export async function fetchAttachCandidates(token: string, recordingId: string): Promise<MobileAttachCandidate[]> {
  const client = createTrpcClient(token)
  return (await client.voice.attachCandidates.query({ recordingId })) as MobileAttachCandidate[]
}

export async function attachVoiceToMeeting(
  token: string,
  input: { recordingId: string; personIds: string[]; meetingId?: string },
): Promise<{ meetingId: string | null }> {
  const client = createTrpcClient(token)
  return (await client.voice.attachToPeople.mutate(input)) as { meetingId: string | null }
}

export async function retryVoiceRecording(token: string, recordingId: string): Promise<void> {
  const client = createTrpcClient(token)
  await client.voice.retry.mutate({ recordingId })
}

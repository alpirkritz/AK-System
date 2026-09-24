'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type RecorderState = 'idle' | 'recording' | 'paused'

const BAR_COUNT = 32
const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
}

/** Browser microphone recorder with pause/resume, an elapsed timer that skips pauses, and levels. */
export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(0))
  const [error, setError] = useState<string | null>(null)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)
  const raf = useRef<number | null>(null)
  const accumulated = useRef(0)
  const segmentStart = useRef<number | null>(null)

  const currentMs = useCallback(() => accumulated.current + (segmentStart.current ? Date.now() - segmentStart.current : 0), [])

  const cleanup = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = null
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    void audioCtx.current?.close().catch(() => {})
    audioCtx.current = null
  }, [])

  useEffect(() => cleanup, [cleanup])

  useEffect(() => {
    if (state !== 'recording') return
    const id = setInterval(() => setElapsed(Math.floor(currentMs() / 1000)), 250)
    return () => clearInterval(id)
  }, [state, currentMs])

  const start = useCallback(async () => {
    setError(null)
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('הדפדפן לא תומך בהקלטה')
      return
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.current = media
      const mimeType = pickMimeType()
      const rec = new MediaRecorder(media, mimeType ? { mimeType } : undefined)
      chunks.current = []
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.current.push(e.data)
      }
      rec.start(1000)
      recorder.current = rec
      accumulated.current = 0
      segmentStart.current = Date.now()
      setElapsed(0)
      setState('recording')

      const ctx = new AudioContext()
      audioCtx.current = ctx
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      ctx.createMediaStreamSource(media).connect(analyser)
      const data = new Uint8Array(analyser.frequencyBinCount)
      let last = 0
      const tick = (t: number) => {
        raf.current = requestAnimationFrame(tick)
        if (t - last < 90) return
        last = t
        analyser.getByteTimeDomainData(data)
        let peak = 0
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128))
        const level = recorder.current?.state === 'recording' ? Math.min(1, peak / 64) : 0
        setLevels((prev) => [...prev.slice(1), level])
      }
      raf.current = requestAnimationFrame(tick)
    } catch (err) {
      cleanup()
      setError(err instanceof DOMException && err.name === 'NotAllowedError' ? 'אין הרשאה למיקרופון' : 'לא ניתן להתחיל הקלטה')
    }
  }, [cleanup])

  const pause = useCallback(() => {
    if (recorder.current?.state !== 'recording') return
    recorder.current.pause()
    accumulated.current = currentMs()
    segmentStart.current = null
    setState('paused')
  }, [currentMs])

  const resume = useCallback(() => {
    if (recorder.current?.state !== 'paused') return
    recorder.current.resume()
    segmentStart.current = Date.now()
    setState('recording')
  }, [])

  const stop = useCallback(
    () =>
      new Promise<{ blob: Blob; durationSeconds: number } | null>((resolve) => {
        const rec = recorder.current
        if (!rec) return resolve(null)
        const durationSeconds = Math.round(currentMs() / 1000)
        rec.onstop = () => {
          const blob = new Blob(chunks.current, { type: rec.mimeType || 'audio/webm' })
          recorder.current = null
          accumulated.current = 0
          segmentStart.current = null
          cleanup()
          setState('idle')
          setLevels(Array(BAR_COUNT).fill(0))
          resolve({ blob, durationSeconds })
        }
        rec.stop()
      }),
    [cleanup, currentMs],
  )

  return { state, elapsed, levels, error, start, pause, resume, stop }
}

/** Multipart upload with progress. Not tRPC: the audio is binary. */
export function uploadRecording(
  form: FormData,
  onProgress: (fraction: number) => void,
): Promise<{ recordingId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/voice/upload')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total)
    }
    xhr.onload = () => {
      let body: { recordingId?: string; error?: string } = {}
      try {
        body = JSON.parse(xhr.responseText) as typeof body
      } catch {
        /* non-JSON error page */
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.recordingId) resolve({ recordingId: body.recordingId })
      else reject(new Error(body.error ?? `ההעלאה נכשלה (${xhr.status})`))
    }
    xhr.onerror = () => reject(new Error('ההעלאה נכשלה · בדוק את החיבור'))
    xhr.send(form)
  })
}

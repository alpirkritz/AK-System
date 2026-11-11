'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export type RecorderState = 'idle' | 'recording' | 'paused'

const BAR_COUNT = 32
const PREFERRED_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined
  return PREFERRED_TYPES.find((t) => MediaRecorder.isTypeSupported(t))
}

/**
 * 'mic' records whichever input device is selected (the OS default, or an explicitly chosen one —
 * e.g. a virtual loopback device like BlackHole, see docs/specs/recording-call-audio-capture.md).
 * 'tab' additionally captures a shared browser tab/screen's audio (via getDisplayMedia) mixed with
 * the microphone, for calls that run inside a browser tab (e.g. Google Meet) with no OS setup.
 */
export type CaptureMode = 'mic' | 'tab'

const DEVICE_STORAGE_KEY = 'ak-voice-input-device-id'
const MODE_STORAGE_KEY = 'ak-voice-capture-mode'
/** Below this normalized peak (0-1), a source is treated as "not actually carrying audio". */
const SILENCE_THRESHOLD = 0.03
/** How long to wait after start before declaring the call source silent. */
const SILENCE_GRACE_MS = 4000

function readStoredString(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStoredString(key: string, value: string | null) {
  try {
    if (typeof window === 'undefined') return
    if (value) window.localStorage.setItem(key, value)
    else window.localStorage.removeItem(key)
  } catch {
    // best-effort only
  }
}

/**
 * Recording continues fine in a backgrounded/unfocused tab (audio capture isn't throttled the
 * way video/JS timers are) — the real risk is the OS/browser suspending the page or letting the
 * display sleep. A Screen Wake Lock reduces that risk while recording; it's best-effort and its
 * absence never blocks recording (see docs/specs/recording-background-and-speaker-id.md).
 */
type WakeLockSentinel = { release: () => Promise<void>; addEventListener: (type: 'release', cb: () => void) => void }
type NavigatorWithWakeLock = Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinel> } }

/**
 * Speech-quality Opus. ~14 MB per hour instead of the browser default's ~60 MB, which makes long
 * meetings far quicker (and less fragile) to upload — docs/specs/voice-recording-never-lost.md.
 */
export const RECORDING_BITS_PER_SECOND = 32_000

export interface RecorderHooks {
  /** A new recording started with this container type (before any chunk). */
  onStart?: (mimeType: string) => void
  /** Each chunk as MediaRecorder emits it (every ~1s), numbered from 0, with elapsed seconds. */
  onChunk?: (chunk: Blob, seq: number, elapsedSeconds: number) => void
}

/** Browser microphone recorder with pause/resume, an elapsed timer that skips pauses, and levels. */
export function useRecorder(hooks: RecorderHooks = {}) {
  const hooksRef = useRef(hooks)
  hooksRef.current = hooks
  const [state, setState] = useState<RecorderState>('idle')
  const [elapsed, setElapsed] = useState(0)
  const [levels, setLevels] = useState<number[]>(() => Array(BAR_COUNT).fill(0))
  const [error, setError] = useState<string | null>(null)
  const [wakeLockActive, setWakeLockActive] = useState(false)
  const [wakeLockSupported] = useState(
    () => typeof navigator !== 'undefined' && Boolean((navigator as NavigatorWithWakeLock).wakeLock),
  )
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([])
  const [selectedDeviceId, setSelectedDeviceIdState] = useState<string | null>(() => readStoredString(DEVICE_STORAGE_KEY))
  const [captureMode, setCaptureModeState] = useState<CaptureMode>(
    () => (readStoredString(MODE_STORAGE_KEY) as CaptureMode | null) ?? 'mic',
  )
  const [displayAudioSupported] = useState(
    () => typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getDisplayMedia),
  )
  const [noCallSignal, setNoCallSignal] = useState(false)
  const recorder = useRef<MediaRecorder | null>(null)
  const chunks = useRef<Blob[]>([])
  const stream = useRef<MediaStream | null>(null)
  const displayStream = useRef<MediaStream | null>(null)
  const audioCtx = useRef<AudioContext | null>(null)
  const raf = useRef<number | null>(null)
  const accumulated = useRef(0)
  const segmentStart = useRef<number | null>(null)
  const wakeLock = useRef<WakeLockSentinel | null>(null)
  const callPeak = useRef(0)
  const silenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return
    try {
      const list = await navigator.mediaDevices.enumerateDevices()
      setDevices(list.filter((d) => d.kind === 'audioinput'))
    } catch {
      // best-effort — the picker just stays empty (falls back to the OS default device)
    }
  }, [])

  useEffect(() => {
    void refreshDevices()
  }, [refreshDevices])

  const setSelectedDeviceId = useCallback((id: string | null) => {
    setSelectedDeviceIdState(id)
    writeStoredString(DEVICE_STORAGE_KEY, id)
  }, [])

  const setCaptureMode = useCallback((mode: CaptureMode) => {
    setCaptureModeState(mode)
    writeStoredString(MODE_STORAGE_KEY, mode)
  }, [])

  const currentMs = useCallback(() => accumulated.current + (segmentStart.current ? Date.now() - segmentStart.current : 0), [])

  const releaseWakeLock = useCallback(() => {
    const lock = wakeLock.current
    wakeLock.current = null
    setWakeLockActive(false)
    if (lock) void lock.release().catch(() => {})
  }, [])

  const requestWakeLock = useCallback(async () => {
    const nav = navigator as NavigatorWithWakeLock
    if (!nav.wakeLock) return
    try {
      const lock = await nav.wakeLock.request('screen')
      wakeLock.current = lock
      setWakeLockActive(true)
      lock.addEventListener('release', () => setWakeLockActive(false))
    } catch {
      // Best-effort only (battery saver, permissions policy, etc.) — recording proceeds regardless.
      setWakeLockActive(false)
    }
  }, [])

  const cleanup = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = null
    if (silenceTimer.current) clearTimeout(silenceTimer.current)
    silenceTimer.current = null
    callPeak.current = 0
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    displayStream.current?.getTracks().forEach((t) => t.stop())
    displayStream.current = null
    void audioCtx.current?.close().catch(() => {})
    audioCtx.current = null
    setNoCallSignal(false)
    releaseWakeLock()
  }, [releaseWakeLock])

  useEffect(() => cleanup, [cleanup])

  // The Wake Lock is released by the browser whenever the tab is hidden, and cannot be
  // re-requested until it's visible again — re-acquire on return if still recording.
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && recorder.current?.state === 'recording' && !wakeLock.current) {
        void requestWakeLock()
      }
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => document.removeEventListener('visibilitychange', onVisibilityChange)
  }, [requestWakeLock])

  useEffect(() => {
    if (state !== 'recording') return
    const id = setInterval(() => setElapsed(Math.floor(currentMs() / 1000)), 250)
    return () => clearInterval(id)
  }, [state, currentMs])

  const start = useCallback(async () => {
    setError(null)
    setNoCallSignal(false)
    callPeak.current = 0
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('הדפדפן לא תומך בהקלטה')
      return
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: selectedDeviceId ? { deviceId: { exact: selectedDeviceId } } : true,
      })
      stream.current = media
      void refreshDevices() // labels are only populated once permission is granted

      // Default path: MediaRecorder gets the (possibly non-default) input device's stream
      // directly, exactly as before this device-picker existed. The AudioContext below is only
      // for the level meter, same as before — recordStream only changes in 'tab' mode.
      let recordStream: MediaStream = media
      let callAnalyser: AnalyserNode | null = null
      const ctx = new AudioContext()
      audioCtx.current = ctx

      if (captureMode === 'tab') {
        try {
          // video: true is required by the spec even though we only want audio; dropped immediately.
          const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
          displayStream.current = display
          display.getVideoTracks().forEach((t) => t.stop())
          const audioOnly = new MediaStream(display.getAudioTracks())
          if (audioOnly.getAudioTracks().length > 0) {
            const mixBus = ctx.createGain()
            ctx.createMediaStreamSource(media).connect(mixBus)
            const displaySource = ctx.createMediaStreamSource(audioOnly)
            displaySource.connect(mixBus)
            callAnalyser = ctx.createAnalyser()
            callAnalyser.fftSize = 256
            displaySource.connect(callAnalyser)
            const dest = ctx.createMediaStreamDestination()
            mixBus.connect(dest)
            recordStream = dest.stream
          } else {
            setError('השיתוף לא כלל אודיו — יש לסמן "שיתוף אודיו" בחלון הבחירה כדי שהצד השני יוקלט')
          }
        } catch {
          // User cancelled the share picker (or it's unsupported despite feature detection) —
          // fall back to mic-only silently, same as if 'tab' mode had never been chosen.
        }
      }

      const mimeType = pickMimeType()
      const rec = new MediaRecorder(recordStream, {
        ...(mimeType ? { mimeType } : {}),
        audioBitsPerSecond: RECORDING_BITS_PER_SECOND,
      })
      chunks.current = []
      hooksRef.current.onStart?.(rec.mimeType || mimeType || 'audio/webm')
      rec.ondataavailable = (e) => {
        if (e.data.size === 0) return
        chunks.current.push(e.data)
        hooksRef.current.onChunk?.(e.data, chunks.current.length - 1, Math.round(currentMs() / 1000))
      }
      rec.start(1000)
      recorder.current = rec
      accumulated.current = 0
      segmentStart.current = Date.now()
      setElapsed(0)
      setState('recording')

      // Level meter reflects exactly what's being recorded: the merged bus in 'tab' mode, or the
      // selected device directly otherwise — so a silent meter is an accurate "nothing is being
      // captured" signal, not a red herring.
      const analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      ctx.createMediaStreamSource(recordStream).connect(analyser)

      // A non-default device (presumably a loopback device carrying call audio) gets the same
      // silence check as 'tab' mode's dedicated call-audio analyser.
      const silenceCheckAnalyser = callAnalyser ?? (selectedDeviceId ? analyser : null)
      if (silenceCheckAnalyser) {
        silenceTimer.current = setTimeout(() => {
          if (callPeak.current < SILENCE_THRESHOLD) setNoCallSignal(true)
        }, SILENCE_GRACE_MS)
      }

      const data = new Uint8Array(analyser.frequencyBinCount)
      const silenceData = silenceCheckAnalyser ? new Uint8Array(silenceCheckAnalyser.frequencyBinCount) : null
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

        if (silenceCheckAnalyser && silenceData) {
          silenceCheckAnalyser.getByteTimeDomainData(silenceData)
          let callPk = 0
          for (const v of silenceData) callPk = Math.max(callPk, Math.abs(v - 128))
          const normalized = callPk / 128
          callPeak.current = Math.max(callPeak.current, normalized)
          if (normalized >= SILENCE_THRESHOLD) setNoCallSignal(false)
        }
      }
      raf.current = requestAnimationFrame(tick)
      void requestWakeLock()
    } catch (err) {
      cleanup()
      setError(err instanceof DOMException && err.name === 'NotAllowedError' ? 'אין הרשאה למיקרופון' : 'לא ניתן להתחיל הקלטה')
    }
  }, [cleanup, captureMode, currentMs, refreshDevices, requestWakeLock, selectedDeviceId])

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

  return {
    state,
    elapsed,
    levels,
    error,
    start,
    pause,
    resume,
    stop,
    wakeLockActive,
    wakeLockSupported,
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    captureMode,
    setCaptureMode,
    displayAudioSupported,
    noCallSignal,
  }
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

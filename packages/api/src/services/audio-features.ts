/**
 * Lightweight, dependency-free (beyond the `ffmpeg` binary) audio feature extraction used for
 * self-voice matching (see voice-diarization.ts). This intentionally avoids any ML runtime
 * (no ONNX/PyTorch/Python) so it can run on a small box: it decodes to PCM via ffmpeg, frames it,
 * computes a log-mel spectrum per frame (the same features classic MFCC-based speaker
 * verification is built on), does simple energy-based voice-activity segmentation, and pools
 * per-segment log-mel frames into a fixed-length vector used as a "voiceprint".
 *
 * Known limitation: this is a hand-rolled spectral-similarity heuristic, not a trained neural
 * speaker-embedding model (e.g. an x-vector/d-vector network). It is cheap enough to run on a
 * 1GB box and good enough to distinguish "is this the same voice, roughly" for the MVP self/other
 * classification this system needs — but false positives/negatives are expected at the margins.
 * If real-world accuracy proves insufficient, swap `embedFrames`/the comparison in
 * voice-diarization.ts for a proper embedding model; the rest of the pipeline (VAD segmentation,
 * storage, matching threshold, orchestration) does not need to change.
 */
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export class AudioFeatureError extends Error {}

export const SAMPLE_RATE = 16000
const FRAME_SAMPLES = 512 // ~32ms at 16kHz, next pow2 above 25ms (400 samples)
const HOP_SAMPLES = 160 // 10ms
const MEL_BANDS = 24
const NYQUIST = SAMPLE_RATE / 2

// Voice-activity segmentation tuning
const VAD_MIN_SEGMENT_MS = 1200
const VAD_MAX_GAP_MS = 400
/** Below this, a frame is digital silence regardless of where an adaptive split lands. */
const VAD_ABSOLUTE_SILENCE_DB = -50

export interface SpeechSegment {
  startMs: number
  endMs: number
  /** Mean-pooled log-mel vector across the segment's frames (MEL_BANDS length). */
  embedding: number[]
}

/** Decodes any ffmpeg-readable audio file to mono PCM16 samples at SAMPLE_RATE. Requires the `ffmpeg` binary on PATH. */
export async function decodeToPcm16(audioPath: string): Promise<Int16Array> {
  try {
    const { stdout } = await execFileAsync(
      'ffmpeg',
      ['-v', 'error', '-i', audioPath, '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 's16le', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 1024 * 1024 * 256 },
    )
    const buf = stdout as unknown as Buffer
    const usable = buf.length - (buf.length % 2)
    return new Int16Array(buf.buffer, buf.byteOffset, usable / 2)
  } catch (err) {
    throw new AudioFeatureError(`ffmpeg decode failed (is ffmpeg installed?): ${err instanceof Error ? err.message : String(err)}`)
  }
}

/** In-place iterative radix-2 Cooley-Tukey FFT. `re`/`im` length must be a power of two. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j], re[i]]
      ;[im[i], im[j]] = [im[j], im[i]]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len
    const wRe = Math.cos(ang)
    const wIm = Math.sin(ang)
    for (let i = 0; i < n; i += len) {
      let curRe = 1
      let curIm = 0
      for (let k = 0; k < len / 2; k++) {
        const uRe = re[i + k]
        const uIm = im[i + k]
        const vRe = re[i + k + len / 2] * curRe - im[i + k + len / 2] * curIm
        const vIm = re[i + k + len / 2] * curIm + im[i + k + len / 2] * curRe
        re[i + k] = uRe + vRe
        im[i + k] = uIm + vIm
        re[i + k + len / 2] = uRe - vRe
        im[i + k + len / 2] = uIm - vIm
        const nextRe = curRe * wRe - curIm * wIm
        const nextIm = curRe * wIm + curIm * wRe
        curRe = nextRe
        curIm = nextIm
      }
    }
  }
}

function hzToMel(hz: number): number {
  return 2595 * Math.log10(1 + hz / 700)
}
function melToHz(mel: number): number {
  return 700 * (10 ** (mel / 2595) - 1)
}

/** Triangular mel filterbank over FFT bin magnitudes (FRAME_SAMPLES/2 + 1 bins). */
function buildMelFilters(): Float64Array[] {
  const numBins = FRAME_SAMPLES / 2 + 1
  const melMin = hzToMel(0)
  const melMax = hzToMel(NYQUIST)
  const melPoints = Array.from({ length: MEL_BANDS + 2 }, (_, i) => melMin + ((melMax - melMin) * i) / (MEL_BANDS + 1))
  const hzPoints = melPoints.map(melToHz)
  const binPoints = hzPoints.map((hz) => Math.floor(((FRAME_SAMPLES + 1) * hz) / SAMPLE_RATE))
  const filters: Float64Array[] = []
  for (let m = 1; m <= MEL_BANDS; m++) {
    const filter = new Float64Array(numBins)
    const left = binPoints[m - 1]
    const center = binPoints[m]
    const right = binPoints[m + 1]
    for (let k = left; k < center; k++) if (k >= 0 && k < numBins && center > left) filter[k] = (k - left) / (center - left)
    for (let k = center; k < right; k++) if (k >= 0 && k < numBins && right > center) filter[k] = (right - k) / (right - center)
    filters.push(filter)
  }
  return filters
}

let melFiltersCache: Float64Array[] | null = null
function melFilters(): Float64Array[] {
  if (!melFiltersCache) melFiltersCache = buildMelFilters()
  return melFiltersCache
}

/** Hamming window applied in place. */
function applyWindow(frame: Float64Array): void {
  const n = frame.length
  for (let i = 0; i < n; i++) frame[i] *= 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (n - 1))
}

interface Frame {
  startSample: number
  energyDb: number
  logMel: number[]
}

function computeFrames(pcm: Int16Array): Frame[] {
  const filters = melFilters()
  const frames: Frame[] = []
  const re = new Float64Array(FRAME_SAMPLES)
  const im = new Float64Array(FRAME_SAMPLES)
  for (let start = 0; start + FRAME_SAMPLES <= pcm.length; start += HOP_SAMPLES) {
    re.fill(0)
    im.fill(0)
    let energy = 0
    for (let i = 0; i < FRAME_SAMPLES; i++) {
      const sample = pcm[start + i] / 32768
      re[i] = sample
      energy += sample * sample
    }
    applyWindow(re)
    fft(re, im)
    const numBins = FRAME_SAMPLES / 2 + 1
    const power = new Float64Array(numBins)
    for (let i = 0; i < numBins; i++) power[i] = re[i] * re[i] + im[i] * im[i]
    const logMel = filters.map((filter) => {
      let sum = 0
      for (let i = 0; i < filter.length; i++) sum += filter[i] * power[i]
      return Math.log10(sum + 1e-10)
    })
    const energyDb = 10 * Math.log10(energy / FRAME_SAMPLES + 1e-12)
    frames.push({ startSample: start, energyDb, logMel })
  }
  return frames
}

/**
 * Otsu's method: picks the threshold that best splits `values` into two clusters (here: "speech"
 * vs "quiet") by maximizing between-class variance. Unlike a fixed percentile, this adapts to
 * whatever the actual speech/silence ratio in the file happens to be — a percentile-based floor
 * silently breaks when speech is the majority of the recording (the common case), since the
 * "quiet" percentile then lands inside the speech energy band itself.
 */
function otsuThreshold(values: number[]): number {
  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max - min < 1e-6) return min - 1 // degenerate: uniform energy throughout
  const BINS = 128
  const binWidth = (max - min) / BINS
  const hist = new Array(BINS).fill(0)
  for (const v of values) hist[Math.min(BINS - 1, Math.floor((v - min) / binWidth))]++
  const total = values.length
  let sumAll = 0
  for (let i = 0; i < BINS; i++) sumAll += i * hist[i]
  let sumB = 0
  let weightB = 0
  let bestVariance = -1
  let bestBin = 0
  for (let i = 0; i < BINS; i++) {
    weightB += hist[i]
    if (weightB === 0) continue
    const weightF = total - weightB
    if (weightF === 0) break
    sumB += i * hist[i]
    const meanB = sumB / weightB
    const meanF = (sumAll - sumB) / weightF
    const variance = weightB * weightF * (meanB - meanF) ** 2
    if (variance > bestVariance) {
      bestVariance = variance
      bestBin = i
    }
  }
  return min + (bestBin + 0.5) * binWidth
}

function meanVector(vectors: number[][]): number[] {
  const dims = vectors[0]?.length ?? 0
  const out = new Array(dims).fill(0)
  for (const v of vectors) for (let i = 0; i < dims; i++) out[i] += v[i] / vectors.length
  return out
}

/** Energy-based voice-activity segmentation + per-segment log-mel embedding. */
export function extractSpeechSegments(pcm: Int16Array): SpeechSegment[] {
  const frames = computeFrames(pcm)
  if (frames.length === 0) return []
  const energies = frames.map((f) => f.energyDb)
  if (Math.max(...energies) < VAD_ABSOLUTE_SILENCE_DB) return [] // nothing above noise floor anywhere in the file
  const threshold = Math.max(otsuThreshold(energies), VAD_ABSOLUTE_SILENCE_DB)
  const isSpeech = frames.map((f) => f.energyDb > threshold)
  const hopMs = (HOP_SAMPLES / SAMPLE_RATE) * 1000
  const maxGapFrames = Math.round(VAD_MAX_GAP_MS / hopMs)

  const segments: SpeechSegment[] = []
  let i = 0
  while (i < frames.length) {
    if (!isSpeech[i]) {
      i++
      continue
    }
    const segStart = i
    let segEnd = i
    let gap = 0
    let j = i + 1
    while (j < frames.length) {
      if (isSpeech[j]) {
        segEnd = j
        gap = 0
      } else {
        gap++
        if (gap > maxGapFrames) break
      }
      j++
    }
    const startMs = (frames[segStart].startSample / SAMPLE_RATE) * 1000
    const endMs = ((frames[segEnd].startSample + FRAME_SAMPLES) / SAMPLE_RATE) * 1000
    if (endMs - startMs >= VAD_MIN_SEGMENT_MS) {
      const segFrames = frames.slice(segStart, segEnd + 1).filter((_, idx) => isSpeech[segStart + idx])
      if (segFrames.length > 0) {
        segments.push({ startMs, endMs, embedding: meanVector(segFrames.map((f) => f.logMel)) })
      }
    }
    i = j
  }
  return segments
}

/** Mean-pooled embedding across ALL speech frames in a file (used for the enrollment sample, which is assumed single-speaker). */
export function extractOverallEmbedding(pcm: Int16Array): number[] | null {
  const segments = extractSpeechSegments(pcm)
  if (segments.length === 0) return null
  // Weight each segment's contribution by its duration so longer segments count more.
  const weighted: number[][] = []
  for (const seg of segments) {
    const weight = Math.max(1, Math.round((seg.endMs - seg.startMs) / 200))
    for (let k = 0; k < weight; k++) weighted.push(seg.embedding)
  }
  return meanVector(weighted)
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

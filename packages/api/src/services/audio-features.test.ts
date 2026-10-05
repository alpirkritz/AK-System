import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cosineSimilarity, decodeToPcm16, extractOverallEmbedding, extractSpeechSegments } from './audio-features'

// Synthetic fixtures generated with ffmpeg (no external assets needed): a sine tone is a stand-in
// for "someone talking" and silence for "nobody talking", enough to exercise VAD segmentation and
// the log-mel similarity heuristic without needing real speech recordings.
let dir = ''

function synthesize(outPath: string, parts: string[]) {
  const inputs = parts.flatMap((p) => ['-f', 'lavfi', '-i', p])
  const n = parts.length
  execFileSync('ffmpeg', [
    '-v', 'error', '-y',
    ...inputs,
    '-filter_complex', `${parts.map((_, i) => `[${i}:a]`).join('')}concat=n=${n}:v=0:a=1[out]`,
    '-map', '[out]',
    '-ar', '16000', '-ac', '1',
    outPath,
  ])
}

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ak-audio-features-'))
  // tone(2s) - silence(1s) - tone(2s), so VAD should find two separate speech segments
  synthesize(path.join(dir, 'tone-low.wav'), [
    'sine=frequency=220:duration=2:sample_rate=16000',
    'anullsrc=r=16000:cl=mono:d=1',
    'sine=frequency=220:duration=2:sample_rate=16000',
  ])
  synthesize(path.join(dir, 'tone-high.wav'), [
    'sine=frequency=1600:duration=2:sample_rate=16000',
    'anullsrc=r=16000:cl=mono:d=1',
    'sine=frequency=1600:duration=2:sample_rate=16000',
  ])
  synthesize(path.join(dir, 'silence.wav'), ['anullsrc=r=16000:cl=mono:d=3'])
})

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true })
})

describe('decodeToPcm16', () => {
  it('decodes a wav file to a non-empty PCM buffer', async () => {
    const pcm = await decodeToPcm16(path.join(dir, 'tone-low.wav'))
    expect(pcm.length).toBeGreaterThan(16000 * 4) // ~5s of audio at 16kHz
  })
})

describe('extractSpeechSegments (VAD)', () => {
  it('splits a tone-silence-tone file into two segments, skipping the silence gap', async () => {
    const pcm = await decodeToPcm16(path.join(dir, 'tone-low.wav'))
    const segments = extractSpeechSegments(pcm)
    expect(segments.length).toBe(2)
    for (const seg of segments) {
      expect(seg.endMs - seg.startMs).toBeGreaterThan(1000) // each tone block is ~2s, well above the 1.2s floor
      expect(seg.embedding.length).toBeGreaterThan(0)
    }
  })

  it('finds no speech in a silent file', async () => {
    const pcm = await decodeToPcm16(path.join(dir, 'silence.wav'))
    expect(extractSpeechSegments(pcm)).toEqual([])
  })
})

describe('cosineSimilarity + extractOverallEmbedding', () => {
  it('is ~1 for a vector compared with itself', () => {
    const v = [0.2, -0.4, 0.9, 0.1]
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5)
  })

  it('rates the same tone as more similar to itself than to a very different frequency', async () => {
    const low1 = extractOverallEmbedding(await decodeToPcm16(path.join(dir, 'tone-low.wav')))
    const low2 = extractOverallEmbedding(await decodeToPcm16(path.join(dir, 'tone-low.wav')))
    const high = extractOverallEmbedding(await decodeToPcm16(path.join(dir, 'tone-high.wav')))
    expect(low1).not.toBeNull()
    expect(low2).not.toBeNull()
    expect(high).not.toBeNull()
    const sameToneSim = cosineSimilarity(low1!, low2!)
    const differentToneSim = cosineSimilarity(low1!, high!)
    expect(sameToneSim).toBeGreaterThan(differentToneSim)
    // Same synthetic file processed twice should be near-identical, not just "somewhat higher".
    expect(sameToneSim).toBeGreaterThan(0.99)
  })

  it('returns null for a file with no detected speech', async () => {
    const embedding = extractOverallEmbedding(await decodeToPcm16(path.join(dir, 'silence.wav')))
    expect(embedding).toBeNull()
  })
})

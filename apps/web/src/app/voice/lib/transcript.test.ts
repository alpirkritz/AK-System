import { describe, expect, it } from 'vitest'
import { formatTimestamp, groupTranscript, transcriptToPlainText } from './transcript'

const seg = (speakerKey: string, startMs: number, text: string, speakerName: string | null = null) => ({
  speakerKey,
  speakerName,
  startMs,
  text,
})

describe('formatTimestamp', () => {
  it('formats mm:ss and h:mm:ss', () => {
    expect(formatTimestamp(0)).toBe('00:00')
    expect(formatTimestamp(65_000)).toBe('01:05')
    expect(formatTimestamp(3_725_000)).toBe('1:02:05')
    expect(formatTimestamp(-5)).toBe('00:00')
  })
})

describe('groupTranscript', () => {
  it('merges consecutive segments of the same speaker and prefers the identified name', () => {
    const turns = groupTranscript([
      seg('דובר 1', 0, 'שלום', 'ליאור'),
      seg('דובר 1', 1000, 'מה שלומך'),
      seg('דובר 2', 2000, 'טוב'),
      seg('דובר 1', 3000, 'מצוין', 'ליאור'),
    ])
    expect(turns).toEqual([
      { speaker: 'ליאור', startMs: 0, text: 'שלום\nמה שלומך' },
      { speaker: 'דובר 2', startMs: 2000, text: 'טוב' },
      { speaker: 'ליאור', startMs: 3000, text: 'מצוין' },
    ])
  })
})

describe('transcriptToPlainText', () => {
  it('writes one line per turn', () => {
    expect(transcriptToPlainText([seg('דובר 1', 0, 'א'), seg('דובר 1', 1, 'ב'), seg('דובר 2', 2, 'ג')], null)).toBe(
      'דובר 1: א ב\nדובר 2: ג',
    )
  })

  it('falls back to the stored text when there are no segments', () => {
    expect(transcriptToPlainText([], '  דובר 1: שלום ')).toBe('דובר 1: שלום')
    expect(transcriptToPlainText([], null)).toBe('')
  })
})

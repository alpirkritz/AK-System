import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isVoicePending, isVoiceStuck, meterLevel, pushLevel, voiceClock, VOICE_STUCK_MS } from './voice-format.ts'

describe('voice format', () => {
  it('formats the elapsed clock', () => {
    assert.equal(voiceClock(0), '00:00')
    assert.equal(voiceClock(9.7), '00:09')
    assert.equal(voiceClock(754), '12:34')
    assert.equal(voiceClock(-3), '00:00')
  })

  it('maps dBFS metering onto 0…1', () => {
    assert.equal(meterLevel(undefined), 0)
    assert.equal(meterLevel(-160), 0)
    assert.equal(meterLevel(-30), 0.5)
    assert.equal(meterLevel(0), 1)
    assert.equal(meterLevel(4), 1)
    assert.equal(meterLevel(Number.NaN), 0)
  })

  it('keeps a fixed window of level bars', () => {
    assert.deepEqual(pushLevel([0.1, 0.2], 0.3, 2), [0.2, 0.3])
    assert.deepEqual(pushLevel([], 0.5, 3), [0.5])
  })

  it('knows pending and stuck recordings', () => {
    assert.equal(isVoicePending('uploaded'), true)
    assert.equal(isVoicePending('processing'), true)
    assert.equal(isVoicePending('completed'), false)
    const now = Date.parse('2026-09-24T12:00:00Z')
    const old = new Date(now - VOICE_STUCK_MS - 1000).toISOString()
    const fresh = new Date(now - 60_000).toISOString()
    assert.equal(isVoiceStuck({ status: 'processing', createdAt: old }, now), true)
    assert.equal(isVoiceStuck({ status: 'processing', createdAt: fresh }, now), false)
    assert.equal(isVoiceStuck({ status: 'failed', createdAt: old }, now), false)
  })
})

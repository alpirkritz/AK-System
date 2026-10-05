import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatSentiment, WARMTH_TREND_LABEL } from './warmth-format.ts'

describe('warmth format', () => {
  it('prints the −1…+1 score with a sign', () => {
    assert.equal(formatSentiment(1), '+1.00')
    assert.equal(formatSentiment(-1), '-1.00')
    assert.equal(formatSentiment(0.804), '+0.80')
    assert.equal(formatSentiment(-0.396), '-0.40')
    assert.equal(formatSentiment(0), '0.00')
    assert.equal(formatSentiment(null), '—')
    assert.equal(formatSentiment(Number.NaN), '—')
  })

  it('names the three trends', () => {
    assert.equal(WARMTH_TREND_LABEL.warming, 'מתחמם')
    assert.equal(WARMTH_TREND_LABEL.cooling, 'מתקרר')
    assert.equal(WARMTH_TREND_LABEL.stable, 'יציב')
  })
})

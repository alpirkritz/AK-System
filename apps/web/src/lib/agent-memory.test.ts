import { describe, it, expect } from 'vitest'
import { composeMemoryPromptBlock, MEMORY_TRUNCATION_MARKER } from './agent-memory'

describe('composeMemoryPromptBlock', () => {
  it('returns empty string when there is nothing to inject', () => {
    expect(composeMemoryPromptBlock('', [])).toBe('')
  })

  it('includes full instructions when under the cap', () => {
    const block = composeMemoryPromptBlock('תמיד תכתוב בעברית.\nבלי טבלאות.', [])
    expect(block).toContain('תמיד תכתוב בעברית.')
    expect(block).toContain('בלי טבלאות.')
    expect(block).not.toContain(MEMORY_TRUNCATION_MARKER.trim())
  })

  it('truncates at a line boundary with an explicit marker when over the cap', () => {
    const line = 'הוראה חשובה מספר X שאסור לחתוך באמצע.'
    const long = Array.from({ length: 500 }, (_, i) => line.replace('X', String(i))).join('\n')
    const block = composeMemoryPromptBlock(long, [], 2000)

    expect(block).toContain(MEMORY_TRUNCATION_MARKER.trim())
    // No mid-line cut: every included instruction line is complete.
    const included = block
      .split('\n')
      .filter((l) => l.startsWith('הוראה חשובה'))
    for (const l of included) {
      expect(l.endsWith('באמצע.')).toBe(true)
    }
  })

  it('appends memories after instructions when budget remains', () => {
    const block = composeMemoryPromptBlock('הוראה קצרה', [
      { content: 'זיכרון ראשון', kind: 'memory', pinned: 1 },
      { content: 'עובדה', kind: 'knowledge', pinned: 0 },
    ])
    expect(block).toContain('הוראה קצרה')
    expect(block).toContain('📌 [זיכרון] זיכרון ראשון')
    expect(block).toContain('[ידע] עובדה')
  })

  it('skips memories when instructions consume the whole budget', () => {
    const long = 'א'.repeat(3000)
    const block = composeMemoryPromptBlock(long, [{ content: 'זיכרון', kind: 'memory', pinned: 0 }], 3000)
    expect(block).not.toContain('memories & knowledge')
  })
})

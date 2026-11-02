import { describe, expect, it } from 'vitest'
// @ts-expect-error plain ESM script, no types
import { esc, fallbackSummary, normalizeSummary, parseGitLog, renderHtml, renderText } from './release-notes.mjs'

const raw =
  ['aaa1111111\x1fAlpir\x1f2026-11-02T10:00:00+02:00\x1fAdd a waiting view\x1fBody line\n\nCo-Authored-By: Claude <x@y>\x1e',
   'bbb2222222\x1fAlpir\x1f2026-11-01T10:00:00+02:00\x1fFix the <today> list\x1f\x1e'].join('\n')

describe('release notes', () => {
  const commits = parseGitLog(raw)
  const meta = { build: 'abc', dateLabel: 'יום שני', uncommitted: 0, subject: 'נושא' }

  it('parses commits and drops the co-author trailer', () => {
    expect(commits.map((c: { short: string }) => c.short)).toEqual(['aaa1111', 'bbb2222'])
    expect(commits[0].body).toBe('Body line')
  })

  it('escapes HTML', () => {
    expect(esc('<b>"x" & y</b>')).toBe('&lt;b&gt;&quot;x&quot; &amp; y&lt;/b&gt;')
  })

  it('falls back to grouping by the commit verb', () => {
    const s = fallbackSummary(commits)
    expect(s.sections.map((x: { kind: string }) => x.kind)).toEqual(['new', 'fixed'])
  })

  it('normalizes a model answer and ignores junk', () => {
    const s = normalizeSummary(
      {
        headline: 'כותרת',
        sections: [
          { kind: 'fixed', items: [{ text: 'תוקן משהו' }, { text: '' }] },
          { kind: 'bogus', items: [{ text: 'x' }] },
          { kind: 'new', items: [{ text: 'חדש', detail: 'כאן' }] },
        ],
        needsAction: ['להתקין APK', 3],
      },
      commits,
    )
    expect(s.sections.map((x: { kind: string }) => x.kind)).toEqual(['new', 'fixed'])
    expect(s.needsAction).toEqual(['להתקין APK'])
    expect(normalizeSummary(null, commits).sections.length).toBeGreaterThan(0)
    expect(normalizeSummary({ sections: [] }, commits).sections.length).toBeGreaterThan(0)
  })

  it('renders RTL html with sections, the action box and a warning for uncommitted files', () => {
    const summary = normalizeSummary(
      { headline: 'H', sections: [{ kind: 'new', items: [{ text: '<script>x</script>' }] }], needsAction: ['פעולה'] },
      commits,
    )
    const html = renderHtml({ summary, commits, meta: { ...meta, uncommitted: 2 } })
    expect(html).toContain('dir="rtl"')
    expect(html).toContain('דורש פעולה ממך')
    expect(html).toContain('2 קבצים')
    expect(html).not.toContain('<script>')
    expect(html).toContain('aaa1111')
    expect(renderText({ summary, commits, meta })).toContain('חדש:')
  })
})

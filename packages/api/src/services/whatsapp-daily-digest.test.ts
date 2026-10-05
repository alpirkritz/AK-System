import { describe, expect, it } from 'vitest'
import { getDb } from '@ak-system/database'
import {
  ACTION_HEADING,
  arrangeDailyDigest,
  clipNarrative,
  DEFAULT_DAILY_DIGEST_PROMPT,
  DIGEST_TITLE,
  digestTitle,
  effectiveDigestPrompt,
  getDailyDigestPrompt,
  NARRATIVE_CAP,
  normalizeDigestPrompt,
  renderDailyDigestMarkdown,
  renderDailyDigestPlain,
  resetDailyDigestPrompt,
  saveDailyDigestPrompt,
  shouldSkipScheduledGroupSummaries,
  type FollowedDigestGroup,
} from './whatsapp-daily-digest'
import { buildDailyDigestPrompt, DIGEST_NARRATIVE_FALLBACK, parseFreeformDigestText, type DailyDigestModel } from './whatsapp-insights'

function group(partial: Partial<FollowedDigestGroup> & Pick<FollowedDigestGroup, 'jid' | 'name'>): FollowedDigestGroup {
  return {
    labelName: null,
    priority: 0,
    messageCount: 1,
    messages: [],
    ...partial,
  }
}

const dateLabel = 'יום שלישי, 22.9'

describe('arrangeDailyDigest', () => {
  it('puts actions first and tells the day as prose, without quiet groups', () => {
    const model: DailyDigestModel = {
      actions: [
        { text: 'לאשר הגעה', source: 'גן' },
        { text: 'לענות על המייל', source: 'עבודה' },
      ],
      narrative: 'הטיול ביום חמישי אושר. בגן דיברו על כובע ויציאה ב-8:00. בעבודה שאלו אם מגיעים.',
    }
    const arranged = arrangeDailyDigest({
      dateLabel,
      model,
      groups: [
        group({ jid: '1', name: 'הורים', labelName: 'גן', priority: 0, messageCount: 4 }),
        group({ jid: '2', name: 'צוות', labelName: 'גן', priority: 0, messageCount: 3 }),
        group({ jid: '3', name: 'צוות עבודה', labelName: 'עבודה', priority: 2, messageCount: 2 }),
        group({ jid: '4', name: 'שכונה', labelName: null, priority: 1, messageCount: 2 }),
        group({ jid: '5', name: 'שקטה', labelName: 'גן', priority: 0, messageCount: 0 }),
      ],
    })

    expect(arranged.actions.map((a) => a.source)).toEqual(['עבודה', 'גן'])
    expect(arranged.narrative).toContain('הטיול ביום חמישי אושר.')

    const plain = renderDailyDigestPlain(arranged)
    expect(plain.startsWith(`${DIGEST_TITLE} — ${dateLabel}`)).toBe(true)
    expect(plain.indexOf(ACTION_HEADING)).toBeGreaterThan(plain.indexOf(DIGEST_TITLE))
    expect(plain.indexOf('הטיול ביום חמישי אושר.')).toBeGreaterThan(plain.indexOf(ACTION_HEADING))
    expect(plain.split('הטיול ביום חמישי אושר.').length - 1).toBe(1)
    expect(plain).not.toContain('שקטה')
    expect(plain).not.toContain('שקט היום')
    expect(plain).not.toContain('• הורים')
    expect(plain).not.toContain('צריך אותך')
    expect(plain).not.toContain('מה היה היום —')
    expect(digestTitle(arranged)).toBe(DIGEST_TITLE)

    const markdown = renderDailyDigestMarkdown(arranged)
    expect(markdown.startsWith(`# ${DIGEST_TITLE} — יום שלישי, 22.9`)).toBe(true)
    expect(markdown.indexOf(`## ${ACTION_HEADING}`)).toBeGreaterThan(0)
    expect(markdown).not.toContain('## גן')
    expect(markdown).not.toContain('שקט היום')
    expect(markdown).not.toContain('צריך אותך')
    expect(markdown.indexOf('- לענות על המייל — עבודה')).toBeGreaterThan(0)
    expect(markdown).toContain('הטיול ביום חמישי אושר.')
  })

  it('omits the action heading when there is nothing to do', () => {
    const arranged = arrangeDailyDigest({
      dateLabel,
      model: {
        actions: [],
        narrative: 'תזכורת לחופש בגן.',
      },
      groups: [group({ jid: '1', name: 'הורים', labelName: 'גן', messageCount: 2 })],
    })
    const plain = renderDailyDigestPlain(arranged)
    expect(plain).not.toContain(ACTION_HEADING)
    expect(plain).not.toContain('צריך אותך')
    expect(plain).toContain('תזכורת לחופש בגן.')
    expect(plain).not.toContain('שקט היום')
    expect(digestTitle(arranged)).toBe(DIGEST_TITLE)
  })

  it('says nothing happened and hides the quiet list when every followed group is empty', () => {
    const arranged = arrangeDailyDigest({
      dateLabel,
      model: null,
      groups: [
        group({ jid: '1', name: 'הורים', labelName: 'גן', messageCount: 0 }),
        group({ jid: '2', name: 'צוות', messageCount: 0 }),
      ],
    })
    const plain = renderDailyDigestPlain(arranged)
    expect(plain).toBe(`${DIGEST_TITLE} — יום שלישי, 22.9\n\nהיום לא קרה כלום.`)
    expect(plain).not.toContain(ACTION_HEADING)
    expect(plain).not.toContain('צריך אותך')
    expect(plain).not.toContain('הורים')
    expect(plain).not.toContain('שקט היום')
    expect(digestTitle(arranged)).toBe(DIGEST_TITLE)
  })

  it('drops an action whose source is not a followed group', () => {
    const arranged = arrangeDailyDigest({
      dateLabel,
      model: {
        actions: [{ text: 'להביא כובע', source: 'קבוצה שלא קיימת' }],
        narrative: 'שקט יחסית אצל ההורים.',
      },
      groups: [group({ jid: '1', name: 'הורים', labelName: 'גן', messageCount: 1 })],
    })
    expect(arranged.actions).toEqual([])
    expect(renderDailyDigestPlain(arranged)).not.toContain(ACTION_HEADING)
    expect(renderDailyDigestPlain(arranged)).not.toContain('צריך אותך')
  })
})

describe('shouldSkipScheduledGroupSummaries', () => {
  it('skips later the same local day after the digest was sent', () => {
    const sent = new Date().toISOString()
    expect(
      shouldSkipScheduledGroupSummaries({
        digestEnabled: true,
        lastSentAt: sent,
        timeZone: 'Asia/Jerusalem',
      }),
    ).toBe(true)
  })

  it('keeps per-group summaries when the digest is off or has not been sent today', () => {
    expect(
      shouldSkipScheduledGroupSummaries({
        digestEnabled: false,
        lastSentAt: new Date().toISOString(),
        timeZone: 'Asia/Jerusalem',
      }),
    ).toBe(false)
    expect(
      shouldSkipScheduledGroupSummaries({
        digestEnabled: true,
        lastSentAt: '2020-01-01T10:00:00.000Z',
        timeZone: 'Asia/Jerusalem',
      }),
    ).toBe(false)
  })
})

describe('digest story length and prompt', () => {
  it('clips a long story at a sentence boundary under 900 characters', () => {
    const sentence = 'בגן דיברו על הטיול וסגרו שיוצאים בחמישי בבוקר. '
    const long = sentence.repeat(40)
    const clipped = clipNarrative(long)
    expect(clipped.length).toBeLessThanOrEqual(NARRATIVE_CAP)
    expect(clipped.endsWith('.')).toBe(true)
    expect(clipped.length).toBeGreaterThan(NARRATIVE_CAP * 0.5)
  })

  it('uses the fallback and drops actions when the model returns no story', () => {
    const arranged = arrangeDailyDigest({
      dateLabel,
      model: { actions: [{ text: 'לאשר', source: 'הורים' }], narrative: '   ' },
      groups: [group({ jid: '1', name: 'הורים', labelName: 'גן', messageCount: 2 })],
    })
    expect(arranged.actions).toEqual([])
    expect(arranged.narrative).toBe(DIGEST_NARRATIVE_FALLBACK)
    expect(renderDailyDigestPlain(arranged)).not.toContain(ACTION_HEADING)
    expect(renderDailyDigestPlain(arranged)).not.toContain('צריך אותך')
    expect(renderDailyDigestPlain(arranged)).not.toContain('שקט היום')
  })

  it('prefers a saved prompt and leaves empty groups out of the model text', () => {
    expect(effectiveDigestPrompt(null)).toBe(DEFAULT_DAILY_DIGEST_PROMPT)
    expect(effectiveDigestPrompt('   ')).toBe(DEFAULT_DAILY_DIGEST_PROMPT)
    expect(DEFAULT_DAILY_DIGEST_PROMPT).toMatch(/חבר שמספר/)
    expect(DEFAULT_DAILY_DIGEST_PROMPT).toContain('🏫')
    const saved = 'ספר את היום בקצרה כמו חבר, בלי רשימות ובלי קבוצות שקטות בכלל.'
    expect(effectiveDigestPrompt(saved)).toBe(saved)

    const prompt = buildDailyDigestPrompt(saved, [
      { name: 'הורים', label: 'גן', priority: 0, messages: [{ senderName: 'דני', text: 'יציאה ב-8', ts: 1 }] },
      { name: 'שקטה', label: 'גן', priority: 0, messages: [] },
    ])
    expect(prompt.startsWith(saved)).toBe(true)
    expect(prompt).toContain('"narrative"')
    expect(prompt).toContain('single emoji')
    expect(prompt).toContain('הורים')
    expect(prompt).not.toContain('שקטה')
  })

  it('lets a saved prompt keep headings and bullets instead of forcing JSON', () => {
    const saved = [
      'תפקידך לספק תדריך יומי ממוקד ומובנה של קבוצות הוואטסאפ שבמעקב.',
      'השתמש בבולטים ובהדגשות לסריקה מהירה.',
    ].join('\n')
    const prompt = buildDailyDigestPrompt(
      saved,
      [
        { name: 'הורים', label: 'רמת גן', priority: 0, messages: [{ senderName: 'דני', text: 'יציאה ב-8', ts: 1 }] },
        { name: 'שקטה', label: 'רמת גן', priority: 0, messages: [] },
      ],
      { contract: 'freeform' },
    )
    expect(prompt.startsWith(saved)).toBe(true)
    expect(prompt).not.toContain('Respond in JSON only')
    expect(prompt).not.toContain('No bullets')
    expect(prompt).not.toContain('no label headings')
    expect(prompt).toContain('Do not wrap the answer in JSON')
    expect(prompt).toContain('הורים')
    expect(prompt).not.toContain('שקטה')

    const body = [
      '## ⚡ Action Items',
      '- [הורים] **מה נדרש**: לאשר הגעה.',
      '',
      '## 📌 עדכונים לפי תוויות',
      '### רמת גן',
      '**הורים**',
      '- הטיול ביום חמישי אושר.',
    ].join('\n')
    const arranged = arrangeDailyDigest({
      dateLabel,
      model: {
        actions: [{ text: 'should-not-appear', source: 'הורים' }],
        narrative: body,
        passthrough: true,
      },
      groups: [group({ jid: '1', name: 'הורים', labelName: 'רמת גן', messageCount: 3 })],
    })
    expect(arranged.passthrough).toBe(true)
    expect(arranged.actions).toEqual([])
    expect(arranged.narrative).toBe(body)

    const plain = renderDailyDigestPlain(arranged)
    expect(plain).toContain('## ⚡ Action Items')
    expect(plain).toContain('- [הורים] **מה נדרש**: לאשר הגעה.')
    expect(plain).toContain('### רמת גן')
    expect(plain).not.toContain(ACTION_HEADING)
    expect(plain.startsWith(`${DIGEST_TITLE} — ${dateLabel}`)).toBe(true)

    const longBody = 'שורה על מה שקרה בקבוצה. '.repeat(80)
    expect(longBody.length).toBeGreaterThan(NARRATIVE_CAP)
    const longArranged = arrangeDailyDigest({
      dateLabel,
      model: { actions: [], narrative: longBody, passthrough: true },
      groups: [group({ jid: '1', name: 'הורים', labelName: 'גן', messageCount: 2 })],
    })
    expect(longArranged.narrative.length).toBeGreaterThan(NARRATIVE_CAP)
  })

  it('unwraps fenced markdown and a JSON narrative in freeform replies', () => {
    expect(parseFreeformDigestText('```markdown\n## ⚡ Action Items\n- x\n```')).toBe(
      '## ⚡ Action Items\n- x',
    )
    expect(parseFreeformDigestText('{"narrative":"סיפור קצר","actions":[]}')).toBe('סיפור קצר')
  })

  it('rejects a too-short prompt, keeps the previous text, and reset returns the default', async () => {
    const db = getDb()
    const saved = 'ספר את היום בקצרה כמו חבר, בלי רשימות ובלי קבוצות שקטות בכלל.'
    await saveDailyDigestPrompt(db, saved)
    expect(() => normalizeDigestPrompt('קצר')).toThrow(/DIGEST_PROMPT_LENGTH/)
    await expect(saveDailyDigestPrompt(db, 'קצר')).rejects.toThrow(/DIGEST_PROMPT_LENGTH/)
    const kept = await getDailyDigestPrompt(db)
    expect(kept).toEqual({ prompt: saved, customized: true })

    const reset = await resetDailyDigestPrompt(db)
    expect(reset).toEqual({ prompt: DEFAULT_DAILY_DIGEST_PROMPT, customized: false })
    expect(await getDailyDigestPrompt(db)).toEqual({
      prompt: DEFAULT_DAILY_DIGEST_PROMPT,
      customized: false,
    })
  })
})

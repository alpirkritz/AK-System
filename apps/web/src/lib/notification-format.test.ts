import { describe, expect, it } from 'vitest'
import { parseNotificationBody } from './notification-format'

describe('parseNotificationBody', () => {
  it('turns markdown headings into levelled heading blocks', () => {
    expect(parseNotificationBody('# ראשי\n## משני\n### שלישי')).toEqual([
      { kind: 'heading', level: 1, text: 'ראשי' },
      { kind: 'heading', level: 2, text: 'משני' },
      { kind: 'heading', level: 3, text: 'שלישי' },
    ])
  })

  it('caps deep headings at level 3', () => {
    expect(parseNotificationBody('##### עמוק')).toEqual([
      { kind: 'heading', level: 3, text: 'עמוק' },
    ])
  })

  it('recognises the bullet markers agents emit', () => {
    expect(parseNotificationBody('* אחד\n- שתיים\n+ שלוש')).toEqual([
      { kind: 'bullet', text: 'אחד' },
      { kind: 'bullet', text: 'שתיים' },
      { kind: 'bullet', text: 'שלוש' },
    ])
  })

  it('keeps the marker on numbered steps', () => {
    expect(parseNotificationBody('1. ראשון\n2) שני')).toEqual([
      { kind: 'numbered', marker: '1', text: 'ראשון' },
      { kind: 'numbered', marker: '2', text: 'שני' },
    ])
  })

  it('strips inline emphasis and code markers', () => {
    expect(parseNotificationBody('זה **מודגש** וזה `קוד`')).toEqual([
      { kind: 'paragraph', text: 'זה מודגש וזה קוד' },
    ])
  })

  it('drops blank lines so spacing comes from the renderer', () => {
    expect(parseNotificationBody('שורה\n\n\nשורה שנייה')).toEqual([
      { kind: 'paragraph', text: 'שורה' },
      { kind: 'paragraph', text: 'שורה שנייה' },
    ])
  })

  it('leaves plain text untouched', () => {
    expect(parseNotificationBody('יש לך 3 משימות שעברו את תאריך היעד.')).toEqual([
      { kind: 'paragraph', text: 'יש לך 3 משימות שעברו את תאריך היעד.' },
    ])
  })

  it('handles a realistic agent brief end to end', () => {
    const brief = '🤖 Meeting Prep Herald\n\n# תדריך\n\n## שורה תחתונה\n* פריט\n\n1. שלב'
    expect(parseNotificationBody(brief)).toEqual([
      { kind: 'paragraph', text: '🤖 Meeting Prep Herald' },
      { kind: 'heading', level: 1, text: 'תדריך' },
      { kind: 'heading', level: 2, text: 'שורה תחתונה' },
      { kind: 'bullet', text: 'פריט' },
      { kind: 'numbered', marker: '1', text: 'שלב' },
    ])
  })
})

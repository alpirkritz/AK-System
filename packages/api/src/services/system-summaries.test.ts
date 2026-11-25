import { beforeEach, describe, expect, it } from 'vitest'
import { meetingAnalyses, meetings } from '@ak-system/database'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { mergeSystemFirst, systemSummaryText, type SummaryNote, type SystemSummary } from './system-summaries'

const NOW = new Date().toISOString()
const DAY = '2026-11-16'

const note = (over: Partial<SummaryNote> = {}): SummaryNote => ({
  id: 'n1', title: 'Notion note', date: DAY, snippet: 'notion snippet', bodyText: 'notion body',
  notionUrl: 'https://notion.so/x', meetingId: 'm1', meetingTitle: 'M1', sourceKind: 'ai_block', ...over,
})
const summary = (meetingId: string): SystemSummary => ({
  analysisId: `a_${meetingId}`, meetingId, topic: 'נושא', keyInsight: 'תובנה', text: 'נושא: נושא\nתובנה מרכזית: תובנה',
})

describe('mergeSystemFirst', () => {
  it('replaces the Notion body when the meeting has a system summary', () => {
    const out = mergeSystemFirst([note()], new Map([['m1', summary('m1')]]), [])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ bodyText: 'נושא: נושא\nתובנה מרכזית: תובנה', sourceKind: 'system', snippet: 'תובנה' })
  })

  it('keeps the Notion note when there is no system summary', () => {
    const out = mergeSystemFirst([note()], new Map(), [{ id: 'm1', title: 'M1', date: DAY }])
    expect(out[0]).toMatchObject({ bodyText: 'notion body', sourceKind: 'ai_block' })
  })

  it('adds a synthetic entry for a meeting that has a system summary but no Notion note', () => {
    const out = mergeSystemFirst([], new Map([['m2', summary('m2')]]), [{ id: 'm2', title: 'התייעצות', date: DAY }])
    expect(out).toEqual([expect.objectContaining({ id: 'sys_a_m2', title: 'התייעצות', meetingId: 'm2', sourceKind: 'system', notionUrl: null })])
  })

  it('does not duplicate a meeting that already has a note', () => {
    const out = mergeSystemFirst([note()], new Map([['m1', summary('m1')]]), [{ id: 'm1', title: 'M1', date: DAY }])
    expect(out).toHaveLength(1)
  })
})

describe('systemSummaryText', () => {
  it('renders topic, insight, action items with owners and open question', () => {
    const text = systemSummaryText({
      topic: 'T', keyInsight: 'K', openQuestion: 'Q',
      actionItemsJson: JSON.stringify([{ content: 'לשלוח', owner: 'דנה' }, { content: '' }]),
    })
    expect(text).toBe('נושא: T\nתובנה מרכזית: K\nמשימות:\n- לשלוח (דנה)\nשאלה פתוחה: Q')
  })

  it('is empty when nothing is filled in', () => {
    expect(systemSummaryText({ topic: null, keyInsight: ' ', openQuestion: null, actionItemsJson: 'bad json' })).toBe('')
  })
})

describe('insights.meetingNotes with system summaries', () => {
  beforeEach(async () => {
    await resetDb()
    await getTestDb().insert(meetings).values([
      { id: 'm1', title: 'Weekly', date: DAY, time: '10:00', source: 'manual', createdAt: NOW, updatedAt: NOW },
      { id: 'm2', title: 'התייעצות עם ליאור', date: DAY, time: '18:00', source: 'manual', createdAt: NOW, updatedAt: NOW },
    ])
  })

  async function analysis(id: string, meetingId: string, status: string, keyInsight: string, createdAt = NOW) {
    await getTestDb().insert(meetingAnalyses).values({
      id, meetingId, source: 'voice', status, topic: 'נושא', keyInsight, createdAt, updatedAt: createdAt,
    })
  }

  it('returns a completed analysis for a meeting with no Notion note, newest wins, pending ignored', async () => {
    await analysis('old', 'm2', 'completed', 'ישן', '2026-11-16T10:00:00.000Z')
    await analysis('new', 'm2', 'completed', 'חדש', '2026-11-16T12:00:00.000Z')
    await analysis('pend', 'm1', 'pending', 'לא גמור')
    const caller = await createTestCaller()
    const res = await caller.insights.meetingNotes({ date: DAY })
    const sys = res.notes.filter((n) => n.sourceKind === 'system')
    expect(sys).toHaveLength(1)
    expect(sys[0]).toMatchObject({ meetingId: 'm2', meetingTitle: 'התייעצות עם ליאור' })
    expect(sys[0].bodyText).toContain('חדש')
    expect(sys[0].bodyText).not.toContain('ישן')
    expect(res.notes.some((n) => n.meetingId === 'm1')).toBe(false)
  })
})

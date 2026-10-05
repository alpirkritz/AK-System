import { describe, it, expect, vi } from 'vitest'
import {
  classifyBug,
  routeOwner,
  detectGaps,
  computeStats,
  computeDiff,
  stripNotionSourceUri,
  jerusalemDateKey,
  formatIncompleteMessage,
  buildGroundingPayload,
  runTier1QaScan,
  type Tier1TestRecord,
  type Tier1BugRecord,
  type Tier1QaSnapshotPayload,
} from './notion-tier1-qa'

vi.mock('./notion-tasks-sync', () => ({ findNotionAccountToken: vi.fn(() => null) }))

function test_(overrides: Partial<Tier1TestRecord> = {}): Tier1TestRecord {
  return {
    testId: 'T1',
    pageId: 'page-t1',
    pageUrl: 'https://notion.so/t1',
    street: 'הזוהר',
    gush: '1234',
    chelka: '56',
    statusBdika: 'ממתין לתיקון',
    resultLink: 'https://runs/1',
    testedBy: [],
    done: false,
    linkedBugIds: [],
    bodyText: '',
    comments: [],
    ...overrides,
  }
}

function bug_(overrides: Partial<Tier1BugRecord> = {}): Tier1BugRecord {
  return {
    bugId: 'B1',
    taskId: 'B1',
    pageId: 'page-b1',
    pageUrl: 'https://notion.so/b1',
    taskName: 'Fix something',
    status: 'Pending',
    classification: 'open',
    priority: 'Medium',
    assignee: [],
    qa: [],
    reporter: [],
    type: 'Bug',
    due: null,
    linkedTestIds: [],
    bodyText: '',
    comments: [],
    ...overrides,
  }
}

describe('classifyBug', () => {
  it('classifies Released as released, not open', () => {
    expect(classifyBug('Released', false)).toBe('released')
  })
  it('classifies Cancelled/Archived as not open', () => {
    expect(classifyBug('Cancelled', false)).toBe('cancelled')
    expect(classifyBug('Archived', false)).toBe('archived')
  })
  it('treats a purged (404) page as deleted regardless of status text', () => {
    expect(classifyBug('', true)).toBe('deleted')
  })
  it('treats Pending / Not started / Reopen / In Dev / Ready for QA / In QA as open', () => {
    for (const s of ['Pending', 'Not started', 'Reopen', 'In Dev', 'Ready for QA', 'In QA', 'Something Unrecognized']) {
      expect(classifyBug(s, false)).toBe('open')
    }
  })
})

describe('routeOwner', () => {
  it('routes אור-review and unanswered questions to לאור', () => {
    expect(routeOwner({ type: 'waiting_on_or_review', note: 'x' })).toBe('לאור')
    expect(routeOwner({ type: 'unanswered_question', note: 'x' })).toBe('לאור')
  })
  it('routes missing assignee/due and released-but-open-test to לדור', () => {
    expect(routeOwner({ type: 'open_bug_missing_assignee', note: 'x' })).toBe('לדור')
    expect(routeOwner({ type: 'open_bug_missing_due', note: 'x' })).toBe('לדור')
  })
  it('routes regression to לאלפיר/QA', () => {
    expect(routeOwner({ type: 'regression_needed', note: 'x' })).toBe('לאלפיר/QA')
  })
  it('falls back to נדרש לקבוע בעלים for an unrecognized gap type with no hint text', () => {
    expect(routeOwner({ type: 'something_else', note: 'סתם משהו' })).toBe('נדרש לקבוע בעלים')
  })
})

describe('detectGaps', () => {
  it('flags a waiting-for-fix test with no linked bug at all', () => {
    const gaps = detectGaps([test_({ statusBdika: 'ממתין לתיקון', linkedBugIds: [] })], [])
    expect(gaps.some((g) => g.type === 'waiting_for_fix_no_active_bug')).toBe(true)
  })

  it('requires regression when a linked bug is Released but the test is not Done', () => {
    const bug = bug_({ pageId: 'b-released', status: 'Released', classification: 'released' })
    const t = test_({ linkedBugIds: ['b-released'], done: false })
    const gaps = detectGaps([t], [bug])
    expect(gaps.some((g) => g.type === 'regression_needed')).toBe(true)
  })

  it('does not require regression once the test is Done', () => {
    const bug = bug_({ pageId: 'b-released', status: 'Released', classification: 'released' })
    const t = test_({ linkedBugIds: ['b-released'], done: true })
    const gaps = detectGaps([t], [bug])
    expect(gaps.some((g) => g.type === 'regression_needed')).toBe(false)
  })

  it('flags a test waiting-for-fix that is linked only to a cancelled bug', () => {
    const bug = bug_({ pageId: 'b-cancelled', status: 'Cancelled', classification: 'cancelled' })
    const t = test_({ statusBdika: 'ממתין לתיקון', linkedBugIds: ['b-cancelled'] })
    const gaps = detectGaps([t], [bug])
    expect(gaps.some((g) => g.type === 'test_linked_only_to_inactive_bug')).toBe(true)
  })

  it('flags an open bug missing an Assignee, and separately missing a Due date', () => {
    const bug = bug_({ classification: 'open', assignee: [], due: null })
    const gaps = detectGaps([], [bug])
    expect(gaps.some((g) => g.type === 'open_bug_missing_assignee')).toBe(true)
    expect(gaps.some((g) => g.type === 'open_bug_missing_due')).toBe(true)
  })

  it('does not flag a released/cancelled bug for missing assignee/due (only open bugs count)', () => {
    const bug = bug_({ classification: 'released', assignee: [], due: null })
    const gaps = detectGaps([], [bug])
    expect(gaps.some((g) => g.type === 'open_bug_missing_assignee')).toBe(false)
  })

  it('does not flag a Ready for QA bug missing assignee/due — that is not דור\'s job once it reaches QA (2026-10-05)', () => {
    const bug = bug_({ status: 'Ready for QA', classification: 'open', assignee: [], due: null, qa: ['Or'] })
    const gaps = detectGaps([], [bug])
    expect(gaps.some((g) => g.type === 'open_bug_missing_assignee')).toBe(false)
    expect(gaps.some((g) => g.type === 'open_bug_missing_due')).toBe(false)
    expect(gaps.some((g) => g.type === 'ready_for_qa')).toBe(true)
    expect(routeOwner(gaps.find((g) => g.type === 'ready_for_qa')!)).not.toBe('לדור')
  })

  it('flags a deleted-but-still-linked task', () => {
    const bug = bug_({ classification: 'deleted', linkedTestIds: ['t1'], purged: true })
    const gaps = detectGaps([], [bug])
    expect(gaps.some((g) => g.type === 'deleted_task_still_linked')).toBe(true)
  })
})

describe('Ready for QA routing', () => {
  const readyGap = (bug: Tier1BugRecord) => detectGaps([], [bug]).find((g) => g.type === 'ready_for_qa')

  it("routes to the ticket's QA when QA is set (Reporter ignored)", () => {
    const gap = readyGap(bug_({ status: 'Ready for QA', qa: ['Noa'], reporter: ['Dor'] }))
    expect(gap?.people).toEqual(['Noa'])
    expect(gap?.peopleSource).toBe('qa')
    expect(routeOwner(gap!)).toBe('לבעלים מהטיקט')
  })

  it('falls back to the Reporter when QA is empty', () => {
    const gap = readyGap(bug_({ status: 'Ready for QA', qa: [], reporter: ['Dor'] }))
    expect(gap?.people).toEqual(['Dor'])
    expect(gap?.peopleSource).toBe('reporter')
    expect(routeOwner(gap!)).toBe('לבעלים מהטיקט')
  })

  it('is unassigned ("נדרש לקבוע בעלים") when neither QA nor Reporter is set', () => {
    const gap = readyGap(bug_({ status: 'Ready for QA', qa: [], reporter: [] }))
    expect(gap?.people).toEqual([])
    expect(gap?.peopleSource).toBeUndefined()
    expect(routeOwner(gap!)).toBe('נדרש לקבוע בעלים')
  })

  it('matches status spelling variants', () => {
    for (const status of ['ready for qa', 'Ready-for-QA', 'READY  FOR QA']) {
      expect(readyGap(bug_({ status, qa: ['Noa'] }))).toBeDefined()
    }
  })

  it('does not fire for other statuses, or for a non-open bug', () => {
    expect(readyGap(bug_({ status: 'In QA', qa: ['Noa'] }))).toBeUndefined()
    expect(readyGap(bug_({ status: 'Ready for QA', classification: 'cancelled', qa: ['Noa'] }))).toBeUndefined()
  })
})

describe('computeStats', () => {
  it('sums the status breakdown to exactly the total test count (pre-send validation invariant)', () => {
    const tests = [
      test_({ testId: 'a', statusBdika: 'ממתין לתיקון' }),
      test_({ testId: 'b', statusBdika: 'ממתין לתיקון' }),
      test_({ testId: 'c', statusBdika: 'Done', done: true }),
    ]
    const stats = computeStats(tests, [])
    const sum = Object.values(stats.byStatusBdika).reduce((a, b) => a + b, 0)
    expect(sum).toBe(stats.totalTests)
    expect(stats.totalTests).toBe(3)
    expect(stats.doneCount).toBe(1)
  })

  it('counts each open bug exactly once across classification buckets', () => {
    const bugs = [
      bug_({ bugId: '1', classification: 'open' }),
      bug_({ bugId: '2', classification: 'released' }),
      bug_({ bugId: '3', classification: 'cancelled' }),
    ]
    const stats = computeStats([], bugs)
    expect(stats.bugsByClassification.open).toBe(1)
    expect(stats.bugsByClassification.released).toBe(1)
    expect(stats.bugsByClassification.cancelled).toBe(1)
    expect(stats.totalLinkedBugs).toBe(3)
  })
})

describe('computeDiff', () => {
  const prior: Tier1QaSnapshotPayload = {
    snapshotDate: '2026-09-29',
    testsSnapshot: [{ testId: 'a', statusBdika: 'ממתין לתיקון', done: false, testedBy: [], hasResultLink: false, linkedBugIds: [] }],
    bugsSnapshot: [{ bugId: '1', status: 'Pending', priority: 'Medium', assignee: [], due: null, classification: 'open' }],
    summaryStats: computeStats([], []),
  }

  it('reports a test status change', () => {
    const diff = computeDiff([test_({ testId: 'a', statusBdika: 'Done', done: true })], [], prior)
    expect(diff.some((d) => d.kind === 'test_status_changed')).toBe(true)
  })

  it('reports a bug newly released', () => {
    const diff = computeDiff([], [bug_({ bugId: '1', classification: 'released', status: 'Released' })], prior)
    expect(diff.some((d) => d.kind === 'bug_released')).toBe(true)
  })

  it('caps the diff at 5 entries', () => {
    const manyTests = Array.from({ length: 10 }, (_, i) => test_({ testId: `t${i}`, statusBdika: 'Done', done: true }))
    const manyPrior: Tier1QaSnapshotPayload = {
      ...prior,
      testsSnapshot: Array.from({ length: 10 }, (_, i) => ({
        testId: `t${i}`,
        statusBdika: 'ממתין לתיקון',
        done: false,
        testedBy: [],
        hasResultLink: false,
        linkedBugIds: [],
      })),
    }
    expect(computeDiff(manyTests, [], manyPrior).length).toBeLessThanOrEqual(5)
  })
})

describe('formatIncompleteMessage', () => {
  it('matches the exact fixed safety-fallback wording', () => {
    const msg = formatIncompleteMessage(['תגובות על בדיקה T1: timeout'])
    expect(msg).toBe('עדכון Tier 1 לא נשלח: הסריקה לא הושלמה. חסרים הנתונים הבאים: תגובות על בדיקה T1: timeout.')
  })
})

describe('stripNotionSourceUri / jerusalemDateKey', () => {
  it('strips the collection:// wrapper', () => {
    expect(stripNotionSourceUri('collection://abc-123')).toBe('abc-123')
    expect(stripNotionSourceUri('abc-123')).toBe('abc-123')
  })
  it('produces a YYYY-MM-DD key', () => {
    expect(jerusalemDateKey(new Date('2026-09-30T04:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })
})

describe('buildGroundingPayload', () => {
  it('never includes raw page body text or comment text — narration surface stays small', () => {
    const t = test_({ bodyText: 'some long body', comments: [{ authorName: 'x', createdTime: 't', text: 'secret comment' }] })
    const payload = buildGroundingPayload({
      generatedAtIso: new Date().toISOString(),
      jerusalemDateKey: '2026-09-30',
      jerusalemDateTimeLabel: '30.09.2026 07:00',
      incomplete: false,
      missingParts: [],
      stats: computeStats([t], []),
      tests: [t],
      bugs: [],
      gaps: [],
      ownerActions: [],
      diff: null,
    })
    expect(JSON.stringify(payload)).not.toContain('some long body')
    expect(JSON.stringify(payload)).not.toContain('secret comment')
  })

  it("exposes each bug's QA and Reporter names (so wording rules can live in the agent card)", () => {
    const b = bug_({ qa: ['Noa'], reporter: ['Dor'], bodyText: 'bug body' })
    const payload = buildGroundingPayload({
      generatedAtIso: new Date().toISOString(),
      jerusalemDateKey: '2026-10-05',
      jerusalemDateTimeLabel: '05.10.2026 07:00',
      incomplete: false,
      missingParts: [],
      stats: computeStats([], [b]),
      tests: [],
      bugs: [b],
      gaps: [],
      ownerActions: [],
      diff: null,
    })
    expect(payload.bugs[0]).toMatchObject({ qa: ['Noa'], reporter: ['Dor'] })
    expect(JSON.stringify(payload)).not.toContain('bug body')
  })
})

describe('runTier1QaScan — hard safety rule', () => {
  it('blocks (incomplete=true) when no Notion account/token is configured, with an explanatory missingParts entry', async () => {
    const result = await runTier1QaScan({} as never)
    expect(result.incomplete).toBe(true)
    expect(result.missingParts.length).toBeGreaterThan(0)
    expect(result.diff).toBeNull()
  })
})

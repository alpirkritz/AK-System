import { describe, expect, it } from 'vitest'
import {
  collectParticipantLabels,
  extractParticipantsFromDescription,
  findPriorMeetingNotes,
  formatParticipantsForBrief,
  formatPreMeetingBrief,
  isUsefulAgenda,
  selectRelatedOpenTasks,
  shouldRunPreMeetingAgent,
  stripCalendarDescriptionHtml,
} from './pre-meeting-brief'

describe('stripCalendarDescriptionHtml', () => {
  it('strips HTML and keeps agenda text', () => {
    const raw =
      '<div>Agenda:<br/>1. Status<br/>2. Risks</div><p>________________________________________________________________________________</p><a href="https://teams.microsoft.com/l/meetup-join/xxx">Join the meeting now</a>'
    const text = stripCalendarDescriptionHtml(raw)
    expect(text).toContain('Agenda:')
    expect(text).toContain('1. Status')
    expect(text).not.toMatch(/teams\.microsoft|Join the meeting|____/i)
    expect(text).not.toContain('<')
  })

  it('returns empty for blank input', () => {
    expect(stripCalendarDescriptionHtml(null)).toBe('')
    expect(stripCalendarDescriptionHtml('   ')).toBe('')
  })

  it('removes משתתפים section from agenda body', () => {
    const text = stripCalendarDescriptionHtml(
      'Discuss M1 risks and timeline\n\nמשתתפים: Dana <dana@ex.com>, Ori <ori@ex.com>',
    )
    expect(text).toContain('Discuss M1 risks')
    expect(text).not.toMatch(/משתתפים|Dana|Ori/)
  })

  it('discards Outlook invite metadata as non-agenda', () => {
    const raw = `From: Klein, Guy >
Sent: Monday, 29 July 2024 15:55
To: Klein, Guy; Bachar, Tal
Cc: Gueta, Eden
Subject: US:CONNECT
When: Occurs every Monday effective 29/07/2024 from 9:00 to 10:00 (UTC-05:00) Eastern Time (US & Canada).
Download Teams | Join on the web
teams@teams.yum.com
Alternate VTC instructions
Or call in (audio only)
+1 502-495-3669,,965546957# United States`
    expect(stripCalendarDescriptionHtml(raw)).toBe('')
    expect(isUsefulAgenda(raw)).toBe(false)
  })

  it('discards Unleash-style mission fluff + Teams help', () => {
    const raw = `Our goal is to operate with a clear, fast, and focused path from idea to execution.
Every initiative should move through defined stages with strong ownership and minimal friction.
Speed with discipline, and execution that turns ideas into measurable impact.
Need help? | System reference
Find a local number`
    expect(isUsefulAgenda(raw)).toBe(false)
    expect(stripCalendarDescriptionHtml(raw)).toBe('')
  })
})

describe('shouldRunPreMeetingAgent', () => {
  it('runs when real attendees exist', () => {
    expect(
      shouldRunPreMeetingAgent({
        attendees: [
          { self: true, email: 'me@x.com' },
          { displayName: 'Shani', email: 'shani@yum.com' },
        ],
      }),
    ).toBe(true)
  })

  it('skips solo / bot-only', () => {
    expect(
      shouldRunPreMeetingAgent({
        attendees: [
          { self: true, email: 'me@x.com' },
          { email: 'dtmeetingbot@gmail.com' },
        ],
      }),
    ).toBe(false)
  })

  it('runs when Dragontail משתתפים present', () => {
    expect(
      shouldRunPreMeetingAgent({
        attendees: [],
        description: 'משתתפים: Shani <shani@yum.com>, Elad <elad@yum.com>',
      }),
    ).toBe(true)
  })
})

describe('extractParticipantsFromDescription', () => {
  it('parses Dragontail bridge משתתפים line', () => {
    const labels = extractParticipantsFromDescription(
      'Sync notes here\n\nמשתתפים: Shani <shani@yum.com>, Tinko <tinko@yum.com>',
    )
    expect(labels).toEqual(['Shani (shani@yum.com)', 'Tinko (tinko@yum.com)'])
  })

  it('parses HTML-wrapped participants heading', () => {
    const labels = extractParticipantsFromDescription(
      '<div>Agenda</div><br/>משתתפים: Dana Cohen &lt;dana@ex.com&gt;, Ori',
    )
    expect(labels.some((l) => l.includes('Dana'))).toBe(true)
    expect(labels.some((l) => l.includes('Ori'))).toBe(true)
  })
})

describe('collectParticipantLabels', () => {
  it('merges CRM + calendar attendees + description, skips self, dedupes by email', () => {
    const labels = collectParticipantLabels(
      [{ id: '1', name: 'Dana', email: 'dana@ex.com' }],
      [
        { email: 'dana@ex.com', displayName: 'Dana Cohen' },
        { email: 'me@ex.com', displayName: 'Me', self: true },
        { email: 'ori@ex.com', displayName: 'Ori' },
      ],
      ['Dana (dana@ex.com)', 'Shani (shani@yum.com)'],
    )
    expect(labels).toEqual(['Dana', 'Ori (ori@ex.com)', 'Shani (shani@yum.com)'])
  })
})

describe('formatParticipantsForBrief', () => {
  it('caps long lists and drops bots', () => {
    const labels = Array.from({ length: 12 }, (_, i) => `Person${i} (p${i}@yum.com)`)
    labels.push('dtmeetingbot@gmail.com')
    const line = formatParticipantsForBrief(labels)
    expect(line).toContain('ועוד 4')
    expect(line).not.toMatch(/meetingbot/)
    expect(line).not.toMatch(/@yum\.com/)
  })
})

describe('selectRelatedOpenTasks', () => {
  const tasks = [
    { id: 'a', title: 'Linked', priority: 'high', done: false, meetingId: 'm1', projectId: null },
    { id: 'b', title: 'Project', priority: 'low', done: false, meetingId: null, projectId: 'p1' },
    { id: 'c', title: 'Unrelated', priority: 'high', done: false, meetingId: 'other', projectId: 'px' },
    { id: 'd', title: 'Done', priority: 'high', done: true, meetingId: 'm1', projectId: null },
  ]

  it('returns only meeting/project related open tasks', () => {
    const related = selectRelatedOpenTasks(tasks, { id: 'm1', projectId: 'p1' })
    expect(related.map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('matches by title token when no meeting link', () => {
    const related = selectRelatedOpenTasks(
      [
        ...tasks,
        {
          id: 'e',
          title: 'Features for Algo 4.0',
          priority: 'medium',
          done: false,
          meetingId: null,
          projectId: null,
        },
      ],
      null,
      'Algo Brain follow up',
    )
    expect(related.map((t) => t.id)).toEqual(['e'])
  })

  it('returns empty without link or meaningful title tokens', () => {
    expect(selectRelatedOpenTasks(tasks, null, 'up')).toEqual([])
  })
})

describe('findPriorMeetingNotes', () => {
  it('returns newest past notes with same title', () => {
    const notes = findPriorMeetingNotes(
      [
        { title: 'Algo Brain follow up', date: '2026-07-01', notes: 'old note xx' },
        { title: 'Algo Brain follow up', date: '2026-07-10', notes: 'recent agenda' },
        { title: 'Algo Brain follow up', date: '2026-07-20', notes: 'today should ignore' },
        { title: 'Other', date: '2026-07-15', notes: 'nope' },
      ],
      'Algo Brain follow up',
      '2026-07-20',
    )
    expect(notes).toBe('recent agenda')
  })
})

describe('formatPreMeetingBrief', () => {
  it('builds Hebrew brief with attendees, agenda, and related tasks', () => {
    const text = formatPreMeetingBrief({
      event: {
        title: 'Algo Brain follow up',
        start: '2026-07-20T12:00:00',
        location: 'Microsoft Teams Meeting',
        description:
          '<html><body>Discuss M1 risks and blockers<br/><a href="https://teams.microsoft.com/x">Join</a></body></html>',
        attendees: [
          { email: 'me@x.com', self: true },
          { email: 'dana@x.com', displayName: 'Dana' },
        ],
      },
      linkedMeeting: { id: 'm1', projectName: 'Algo', projectId: 'p1' },
      relatedTasks: [
        { id: 't1', title: 'Features for Algo 4.0', priority: 'high', done: false },
      ],
    })
    expect(text).toContain('⏰ הכנה לפגישה – Algo Brain follow up')
    expect(text).toContain('שעה: 12:00')
    expect(text).toContain('מיקום: Microsoft Teams Meeting')
    expect(text).toContain('פרויקט: Algo')
    expect(text).toContain('משתתפים: Dana (dana@x.com)')
    expect(text).toContain('על מה הולכים לדבר:')
    expect(text).toContain('Discuss M1 risks')
    expect(text).toContain('• [high] Features for Algo 4.0')
    expect(text).not.toMatch(/teams\.microsoft|Join/i)
  })

  it('reads Dragontail משתתפים from description when attendees[] empty', () => {
    const text = formatPreMeetingBrief({
      event: {
        title: 'Shani & Alpir 1:1',
        start: '2026-07-20T16:30:00',
        location: 'Teams',
        description: 'Weekly sync notes for today\n\nמשתתפים: Shani <shani@yum.com>, Alpir <alpir@yum.com>',
        attendees: [],
      },
    })
    expect(text).toContain('משתתפים: Shani (shani@yum.com), Alpir (alpir@yum.com)')
    expect(text).toContain('Weekly sync')
    const agendaPart = text.split('על מה הולכים לדבר:')[1] ?? ''
    expect(agendaPart).not.toMatch(/משתתפים:/)
  })

  it('omits empty sections and Outlook invite paste', () => {
    const text = formatPreMeetingBrief({
      event: {
        title: 'US:CONNECT',
        start: '2026-07-20T16:00:00',
        location: 'Microsoft Teams Meeting',
        description: `From: Klein, Guy >
Sent: Monday, 29 July 2024 15:55
To: Klein, Guy; Bachar, Tal
Subject: US:CONNECT
When: Occurs every Monday effective 29/07/2024 from 9:00 to 10:00.
Download Teams | Join on the web
+1 502-495-3669,,965546957#`,
        attendees: Array.from({ length: 20 }, (_, i) => ({
          email: `p${i}@yum.com`,
          displayName: `Person ${i}`,
        })),
      },
    })
    expect(text).toContain('⏰ הכנה לפגישה – US:CONNECT')
    expect(text).toContain('שעה: 16:00')
    expect(text).not.toContain('על מה הולכים לדבר')
    expect(text).not.toContain('From:')
    expect(text).not.toContain('משימות קשורות')
    expect(text).not.toContain('לא נמצאו')
    expect(text).toContain('ועוד')
    expect(text).not.toMatch(/@yum\.com/)
  })
})

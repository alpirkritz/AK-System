/**
 * Tests for docs/specs/calendar-link-and-commitment-task-modal.md
 *
 * Covers:
 *  - meetings.calendarOnDate — returns only calendar-source meetings for a given date
 *  - meetings.attachToCalendar — merges voice/notion meeting into a calendar meeting
 *  - commitments.taskPrefill — returns prefill data with Hebrew explanations
 *  - commitments.accept with taskId — fast-path linking a pre-created task
 */

import { beforeEach, describe, expect, it } from 'vitest'
import { commitments, meetingAnalyses, meetingPeople, meetings, people, projectPeople, projects, tasks } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'

const NOW = new Date().toISOString()
const TODAY = new Date().toISOString().slice(0, 10)

beforeEach(async () => {
  await resetDb()
})

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

async function seedCalendarMeeting(over: Partial<{ id: string; date: string; title: string }> = {}) {
  const id = over.id ?? 'cal-1'
  await getTestDb().insert(meetings).values({
    id,
    title: over.title ?? 'Weekly Sync',
    date: over.date ?? TODAY,
    time: '10:00',
    endTime: '11:00',
    source: 'calendar',
    createdAt: NOW,
    updatedAt: NOW,
  })
  return id
}

async function seedVoiceMeeting(over: Partial<{ id: string; date: string; title: string }> = {}) {
  const id = over.id ?? 'voice-1'
  await getTestDb().insert(meetings).values({
    id,
    title: over.title ?? 'הקלטת שיחה',
    date: over.date ?? TODAY,
    time: '10:00',
    source: 'voice',
    createdAt: NOW,
    updatedAt: NOW,
  })
  return id
}

async function seedPerson(id = 'p1') {
  await getTestDb().insert(people).values({
    id,
    name: 'Dana Levi',
    status: 'confirmed',
    source: 'manual',
    createdAt: NOW,
  })
  return id
}

async function seedCommitment(personId: string, overrides: { source?: string; sourceId?: string; owner?: string; dueInferred?: string } = {}) {
  const id = 'c1'
  await getTestDb().insert(commitments).values({
    id,
    personId,
    owner: overrides.owner ?? 'me',
    content: 'לשלוח עדכון לצוות',
    status: 'proposed',
    source: overrides.source ?? 'manual',
    sourceId: overrides.sourceId ?? null,
    dueInferred: overrides.dueInferred ?? null,
    createdAt: NOW,
    updatedAt: NOW,
  })
  return id
}

// ---------------------------------------------------------------------------
// meetings.calendarOnDate
// ---------------------------------------------------------------------------

describe('meetings.calendarOnDate', () => {
  it('returns only calendar-source meetings for the given date', async () => {
    const caller = await createTestCaller()
    const calId = await seedCalendarMeeting({ date: TODAY })
    await seedVoiceMeeting({ date: TODAY })
    // Different date calendar meeting — should not appear
    await seedCalendarMeeting({ id: 'cal-other', date: '2020-01-01', title: 'Old meeting' })

    const { meetings: result } = await caller.meetings.calendarOnDate({ date: TODAY })
    expect(result).toHaveLength(1)
    expect(result[0]!.id).toBe(calId)
  })

  it('returns an empty list when no calendar meetings exist for date', async () => {
    const caller = await createTestCaller()
    await seedVoiceMeeting({ date: TODAY })

    const { meetings: result } = await caller.meetings.calendarOnDate({ date: TODAY })
    expect(result).toHaveLength(0)
  })
})

// ---------------------------------------------------------------------------
// meetings.attachToCalendar
// ---------------------------------------------------------------------------

describe('meetings.attachToCalendar', () => {
  it('redirects to the calendar meeting and deletes the voice meeting', async () => {
    const caller = await createTestCaller()
    const calId = await seedCalendarMeeting()
    const voiceId = await seedVoiceMeeting()

    // Add a meeting analysis on the voice meeting
    await getTestDb().insert(meetingAnalyses).values({
      id: 'ma1',
      meetingId: voiceId,
      source: 'voice',
      topic: 'דיון',
      mood: 'focused',
      subtext: '',
      keyInsight: 'key',
      score: 7,
      scoreRationale: '',
      kaizenKeep: '',
      kaizenImprove: '',
      openQuestion: '',
      participantsJson: '[]',
      actionItemsJson: '[]',
      hatName: 'Default',
      status: 'completed',
      createdAt: NOW,
      updatedAt: NOW,
    })

    const person = await seedPerson()
    await getTestDb().insert(meetingPeople).values({
      meetingId: voiceId,
      personId: person,
    })

    const res = await caller.meetings.attachToCalendar({ meetingId: voiceId, calendarMeetingId: calId })
    expect(res.calendarMeetingId).toBe(calId)

    // Voice meeting should be deleted
    const [voiceRow] = await getTestDb().select().from(meetings).where(eq(meetings.id, voiceId))
    expect(voiceRow).toBeUndefined()

    // Analysis should be moved to cal meeting
    const [ma] = await getTestDb().select().from(meetingAnalyses).where(eq(meetingAnalyses.meetingId, calId))
    expect(ma).toBeDefined()

    // Person should be linked to cal meeting
    const [mp] = await getTestDb().select().from(meetingPeople).where(eq(meetingPeople.meetingId, calId))
    expect(mp?.personId).toBe(person)
  })

  it('throws NOT_FOUND for an unknown source meeting', async () => {
    const caller = await createTestCaller()
    const calId = await seedCalendarMeeting()
    await expect(caller.meetings.attachToCalendar({ meetingId: 'no-such', calendarMeetingId: calId })).rejects.toThrow('פגישת מקור לא נמצאה')
  })

  it('throws BAD_REQUEST if source is already a calendar meeting', async () => {
    const caller = await createTestCaller()
    const calId = await seedCalendarMeeting()
    const calId2 = await seedCalendarMeeting({ id: 'cal-2', title: 'Other' })
    await expect(caller.meetings.attachToCalendar({ meetingId: calId, calendarMeetingId: calId2 })).rejects.toThrow('פגישת המקור כבר אירוע יומן')
  })
})

// ---------------------------------------------------------------------------
// commitments.taskPrefill
// ---------------------------------------------------------------------------

describe('commitments.taskPrefill', () => {
  it('returns content as title with explanation', async () => {
    const caller = await createTestCaller()
    await seedPerson()
    const cid = await seedCommitment('p1')

    const prefill = await caller.commitments.taskPrefill({ commitmentId: cid })
    expect(prefill.title).toBe('לשלוח עדכון לצוות')
    expect(prefill.explanations.title).toBeTruthy()
  })

  it('returns dueDate explanation when inferred date is present', async () => {
    const caller = await createTestCaller()
    await seedPerson()
    const cid = await seedCommitment('p1', { dueInferred: TODAY })

    const prefill = await caller.commitments.taskPrefill({ commitmentId: cid })
    expect(prefill.dueDate).toBe(TODAY)
    expect(prefill.explanations.dueDate).toBeTruthy()
  })

  it('sets assigneeId and explanation when owner is them', async () => {
    const caller = await createTestCaller()
    await seedPerson()
    const cid = await seedCommitment('p1', { owner: 'them' })

    const prefill = await caller.commitments.taskPrefill({ commitmentId: cid })
    expect(prefill.assigneeId).toBe('p1')
    expect(prefill.explanations.assigneeId).toContain('Dana Levi')
  })

  it('includes project when person has a primary project', async () => {
    const caller = await createTestCaller()
    await seedPerson()
    await getTestDb().insert(projects).values({ id: 'proj1', name: 'AK System', createdAt: NOW, updatedAt: NOW })
    await getTestDb().insert(projectPeople).values({ projectId: 'proj1', personId: 'p1' })
    const cid = await seedCommitment('p1')

    const prefill = await caller.commitments.taskPrefill({ commitmentId: cid })
    expect(prefill.projectId).toBe('proj1')
    expect(prefill.explanations.projectId).toContain('AK System')
  })

  it('throws NOT_FOUND for unknown commitment', async () => {
    const caller = await createTestCaller()
    await expect(caller.commitments.taskPrefill({ commitmentId: 'no-such' })).rejects.toThrow('Commitment not found')
  })
})

// ---------------------------------------------------------------------------
// commitments.accept with pre-created taskId
// ---------------------------------------------------------------------------

describe('commitments.accept with taskId', () => {
  it('fast-paths: links commitment to an existing task without creating a new one', async () => {
    const caller = await createTestCaller()
    await seedPerson()
    const cid = await seedCommitment('p1')

    // Create a task manually (bypassing tRPC to keep the test simple)
    const taskId = 'task-from-modal'
    await getTestDb().insert(tasks).values({
      id: taskId,
      title: 'לשלוח עדכון',
      status: 'not_started',
      priority: 'medium',
      createdAt: NOW,
      updatedAt: NOW,
    })

    const res = await caller.commitments.accept({ commitmentId: cid, taskId })
    expect(res.taskId).toBe(taskId)

    const [c] = await getTestDb().select({ status: commitments.status, taskId: commitments.taskId }).from(commitments).where(eq(commitments.id, cid))
    expect(c?.status).toBe('accepted')
    expect(c?.taskId).toBe(taskId)

    // Confirm no extra task was created
    const allTasks = await getTestDb().select().from(tasks)
    expect(allTasks).toHaveLength(1)
  })
})

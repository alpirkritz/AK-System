/**
 * docs/specs/commitment-task-linking.md — a meeting action item and its commitment are one
 * thing: they share an id and every action on either side shows on both.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { commitments, meetingAnalyses, meetingPeople, meetings, people, tasks } from '@ak-system/database'
import { eq } from 'drizzle-orm'
import { createTestCaller, getTestDb, resetDb } from '../test-utils'
import { proposeCommitmentsFromAnalysis } from '../services/commitments'
import type { LinkedActionItem } from '../services/action-item-link'

const NOW = new Date().toISOString()

async function seed(items: { content: string; owner?: string }[], meetingId = 'm1') {
  const db = getTestDb()
  await db.insert(people).values({ id: 'p2', name: 'Ron Cohen', status: 'confirmed', source: 'manual', createdAt: NOW })
  await db.insert(meetings).values({ id: meetingId, title: 'Sync', date: '2026-11-20', time: '10:00', source: 'calendar', createdAt: NOW, updatedAt: NOW })
  await db.insert(meetingPeople).values({ meetingId, personId: 'p2' })
  const analysisId = `ma_${meetingId}`
  await db.insert(meetingAnalyses).values({
    id: analysisId, meetingId, source: 'notion_transcript', status: 'completed', actionItemsJson: JSON.stringify(items), createdAt: NOW, updatedAt: NOW,
  })
  await proposeCommitmentsFromAnalysis(db, analysisId)
  return analysisId
}

async function itemsOf(analysisId: string): Promise<LinkedActionItem[]> {
  const [row] = await getTestDb().select({ json: meetingAnalyses.actionItemsJson }).from(meetingAnalyses).where(eq(meetingAnalyses.id, analysisId))
  return JSON.parse(row.json ?? '[]') as LinkedActionItem[]
}

async function commitmentFor(content: string) {
  const [row] = await getTestDb().select().from(commitments).where(eq(commitments.content, content))
  return row
}

beforeEach(async () => {
  await resetDb()
})

describe('commitment-task-linking', () => {
  it('stores the commitment id on the action item it was proposed from', async () => {
    const analysisId = await seed([
      { content: 'Ron sends the contract', owner: 'Ron' },
      { content: 'Ron books the venue', owner: 'Ron' },
    ])
    const items = await itemsOf(analysisId)
    const sent = await commitmentFor('Ron sends the contract')
    const booked = await commitmentFor('Ron books the venue')
    expect(items[0].commitmentId).toBe(sent.id)
    expect(items[1].commitmentId).toBe(booked.id)
  })

  it('accepting the commitment under התחייבויות marks the meeting item as created', async () => {
    const analysisId = await seed([{ content: 'Ron sends the contract', owner: 'Ron' }])
    const caller = await createTestCaller()
    const c = await commitmentFor('Ron sends the contract')
    const { taskId } = await caller.commitments.accept({ commitmentId: c.id })
    const [item] = await itemsOf(analysisId)
    expect(item).toMatchObject({ commitmentId: c.id, taskId })
    const analysis = await caller.meetings.getAnalysis({ meetingId: 'm1' })
    expect(analysis?.actionItems[0].taskId).toBe(taskId)
  })

  it('accepting with a task made in TaskModal (fast path) also reaches the meeting item', async () => {
    const analysisId = await seed([{ content: 'Ron sends the contract', owner: 'Ron' }])
    const db = getTestDb()
    await db.insert(tasks).values({ id: 't-modal', title: 'Contract', done: false, status: 'not_started', priority: 'medium', source: 'manual', createdAt: NOW, updatedAt: NOW })
    const c = await commitmentFor('Ron sends the contract')
    await (await createTestCaller()).commitments.accept({ commitmentId: c.id, taskId: 't-modal' })
    expect((await itemsOf(analysisId))[0].taskId).toBe('t-modal')
  })

  it('creating the task on the meeting accepts the commitment by id, even after its text was edited', async () => {
    const analysisId = await seed([{ content: 'Ron sends the contract', owner: 'Ron' }])
    const db = getTestDb()
    const c = await commitmentFor('Ron sends the contract')
    // Text no longer matches — only the id ties them together now.
    await db.update(commitments).set({ content: 'Ron sends the signed contract' }).where(eq(commitments.id, c.id))
    const { createdTaskIds } = await (await createTestCaller()).meetings.createTasksFromAnalysis({ analysisId, indices: [0] })
    const [after] = await db.select().from(commitments).where(eq(commitments.id, c.id))
    expect(after).toMatchObject({ status: 'accepted', taskId: createdTaskIds[0] })
  })

  it('linking an existing task to the item from the meeting accepts the commitment', async () => {
    const analysisId = await seed([{ content: 'Ron sends the contract', owner: 'Ron' }])
    const db = getTestDb()
    await db.insert(tasks).values({ id: 't-1', title: 'Contract', done: false, status: 'not_started', priority: 'medium', source: 'manual', createdAt: NOW, updatedAt: NOW })
    await (await createTestCaller()).meetings.linkActionItemTasks({ analysisId, links: [{ actionItemIndex: 0, taskId: 't-1' }] })
    expect(await commitmentFor('Ron sends the contract')).toMatchObject({ status: 'accepted', taskId: 't-1' })
  })

  it('dismissing under התחייבויות closes the meeting item and "צור הכל" skips it', async () => {
    const analysisId = await seed([
      { content: 'Ron sends the contract', owner: 'Ron' },
      { content: 'Ron books the venue', owner: 'Ron' },
    ])
    const caller = await createTestCaller()
    await caller.commitments.dismiss({ commitmentId: (await commitmentFor('Ron sends the contract')).id })
    expect((await itemsOf(analysisId))[0].dismissed).toBe(true)
    const { createdTaskIds } = await caller.meetings.createTasksFromAnalysis({ analysisId })
    expect(createdTaskIds).toHaveLength(1)
    const items = await itemsOf(analysisId)
    expect(items[0].taskId).toBeUndefined()
    expect(items[1].taskId).toBe(createdTaskIds[0])
  })

  it('re-analysis keeps the link and carries an existing task onto the new item', async () => {
    const analysisId = await seed([{ content: 'Ron sends the contract', owner: 'Ron' }])
    const caller = await createTestCaller()
    const c = await commitmentFor('Ron sends the contract')
    const { taskId } = await caller.commitments.accept({ commitmentId: c.id })
    const db = getTestDb()
    const later = new Date(Date.now() + 1000).toISOString()
    await db.insert(meetingAnalyses).values({
      id: 'ma_rerun', meetingId: 'm1', source: 'notion_transcript', status: 'completed',
      actionItemsJson: JSON.stringify([{ content: 'Ron sends the contract', owner: 'Ron' }]), createdAt: later, updatedAt: later,
    })
    await proposeCommitmentsFromAnalysis(db, 'ma_rerun')
    expect(await db.select().from(commitments)).toHaveLength(1)
    expect((await itemsOf('ma_rerun'))[0]).toMatchObject({ commitmentId: c.id, taskId })
    void analysisId
  })

  it('heals an older analysis on view: pairs items and pulls in state changed under התחייבויות', async () => {
    const analysisId = await seed([{ content: 'Ron sends the contract', owner: 'Ron' }])
    const db = getTestDb()
    const c = await commitmentFor('Ron sends the contract')
    // Simulate pre-feature data: no id on the item, commitment accepted outside the sync path.
    await db.update(meetingAnalyses).set({ actionItemsJson: JSON.stringify([{ content: 'Ron sends the contract', owner: 'Ron' }]) }).where(eq(meetingAnalyses.id, analysisId))
    await db.insert(tasks).values({ id: 't-old', title: 'Contract', done: false, status: 'not_started', priority: 'medium', source: 'manual', createdAt: NOW, updatedAt: NOW })
    await db.update(commitments).set({ status: 'accepted', taskId: 't-old' }).where(eq(commitments.id, c.id))
    const analysis = await (await createTestCaller()).meetings.getAnalysis({ meetingId: 'm1' })
    expect(analysis?.actionItems[0]).toMatchObject({ commitmentId: c.id, taskId: 't-old' })
    expect((await itemsOf(analysisId))[0].taskId).toBe('t-old')
  })
})

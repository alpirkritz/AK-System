import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

function seedMeetingWithAiNotes() {
  const dbPath = path.join(__dirname, '../data/e2e.sqlite')
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  const meetingId = `m_ai_notes_${Date.now()}`
  const noteId = `mn_ai_notes_${Date.now()}`
  const body = 'החלטנו לדחות את השחרור לשלישי ולעקוב אחרי דנה'
  db.prepare(
    `INSERT INTO meetings (id, title, date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(meetingId, 'פגישת AI Notes', now.slice(0, 10), now, now)
  try {
    db.exec('ALTER TABLE meeting_notes ADD COLUMN source_kind TEXT')
  } catch {
    /* already exists */
  }
  try {
    db.exec('ALTER TABLE meeting_notes ADD COLUMN source_block_id TEXT')
  } catch {
    /* already exists */
  }
  db.prepare(
    `INSERT INTO meeting_notes (
      id, title, date, snippet, body_text, notion_url, notion_page_id, meeting_id,
      source, source_kind, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'notion', 'meeting_page', ?, ?)`,
  ).run(
    noteId,
    'פגישת AI Notes',
    now.slice(0, 10),
    body.slice(0, 40),
    body,
    'https://www.notion.so/3cce7d50cb8e809c8f7cda639bce5478',
    '3cce7d50-cb8e-809c-8f7c-da639bce5478',
    meetingId,
    now,
    now,
  )
  db.close()
  return { meetingId, body }
}

test.describe('In-page AI Meeting Notes', () => {
  test('meeting detail shows סיכום AI excerpt from body_text', async ({ page }) => {
    const { meetingId, body } = seedMeetingWithAiNotes()
    await page.goto(`/meetings/${meetingId}`)
    await expect(page.getByRole('heading', { name: 'פגישת AI Notes' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('סיכום AI (Notion)')).toBeVisible()
    await expect(page.getByText('מדף הפגישה ב-Notion')).toBeVisible()
    await expect(page.getByText(body)).toBeVisible()
  })

  test('long Notion briefing is structured with expand control', async ({ page }) => {
    const dbPath = path.join(__dirname, '../data/e2e.sqlite')
    const db = new Database(dbPath)
    const now = new Date().toISOString()
    const meetingId = `m_ai_brief_${Date.now()}`
    const noteId = `mn_ai_brief_${Date.now()}`
    const body = [
      'R&D Monthly sync',
      'Executive Briefing (What Happened)',
      'Context & Core Trigger: This was a scheduled monthly R&D sync, not an ad-hoc meeting.',
      'High-Level Outcome: Team aligned on messaging.',
      'Discussed Topics & Key Stances',
      'Topic 1: Pizza Hut Acquisition',
      'Leadership emphasized recent wins.',
      'Topic 2: Algo 4 Milestone',
      'The team completed Algo 4 M1.',
    ].join('\n')
    db.prepare(
      `INSERT INTO meetings (id, title, date, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(meetingId, 'פגישת בריפינג', now.slice(0, 10), now, now)
    db.prepare(
      `INSERT INTO meeting_notes (
        id, title, date, snippet, body_text, notion_url, notion_page_id, meeting_id,
        source, source_kind, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'notion', 'meeting_page_summary', ?, ?)`,
    ).run(
      noteId,
      'פגישת בריפינג',
      now.slice(0, 10),
      body.slice(0, 40),
      body,
      'https://www.notion.so/3cce7d50cb8e809c8f7cda639bce5478',
      '3cce7d50-cb8e-809c-8f7c-da639bce5478',
      meetingId,
      now,
      now,
    )
    db.close()

    await page.goto(`/meetings/${meetingId}`)
    await expect(page.getByRole('heading', { name: 'פגישת בריפינג' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByText('Context & Core Trigger')).toBeVisible()
    await expect(page.getByRole('button', { name: 'קרא עוד ›' })).toBeVisible()
    await page.getByRole('button', { name: 'קרא עוד ›' }).click()
    await expect(page.getByText('Topic 2: Algo 4 Milestone')).toBeVisible()
    await expect(page.getByRole('button', { name: '‹ צמצם' })).toBeVisible()
  })

  test('meetings list has calendar sync; Notion notes sync is optional when configured', async ({ page }) => {
    await page.goto('/meetings')
    await expect(page.getByRole('heading', { name: 'פגישות' })).toBeVisible({ timeout: 20000 })
    await expect(page.getByRole('button', { name: /סנכרן מיומן/ })).toBeVisible()
    const notionBtn = page.getByTestId('sync-notion-meeting-notes')
    if (await notionBtn.count()) {
      await expect(notionBtn).toHaveText(/סנכרן סיכומי Notion/)
    }
  })
})

import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

const dbPath = path.join(__dirname, '../data/e2e.sqlite')

function seed() {
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  const stamp = Date.now()
  const personId = `p_ev_${stamp}`
  const otherId = `p_ev2_${stamp}`
  const name = `נועה בדיקה ${stamp}`
  const other = `יואב בדיקה ${stamp}`
  const meetingId = `m_voice_${stamp}`
  const recordingId = `vr_${stamp}`
  const analysisId = `ma_voice_${stamp}`
  const account = 'me@work.com'

  const person = db.prepare(`INSERT INTO people (id, name, email, status, source, created_at) VALUES (?, ?, ?, 'confirmed', 'manual', ?)`)
  person.run(personId, name, `noa${stamp}@acme.com`, now)
  person.run(otherId, other, null, now)

  db.prepare(
    `INSERT INTO person_email_threads (id, person_id, gmail_thread_id, account_email, subject, "from", "to", date, snippet, message_count, last_synced_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 2, ?, ?)`,
  ).run(`pet_${stamp}`, personId, `${account}::thr${stamp}`, account, `הצעת מחיר ${stamp}`, `noa${stamp}@acme.com`, account, now, 'מצרפת את ההצעה המעודכנת', now, now)

  db.prepare(
    `INSERT INTO meetings (id, title, date, time, end_time, source, created_at, updated_at) VALUES (?, ?, ?, '10:00', '10:30', 'voice', ?, ?)`,
  ).run(meetingId, `שיחה מוקלטת · ${name}`, now.slice(0, 10), now, now)
  db.prepare(`INSERT INTO meeting_people (meeting_id, person_id) VALUES (?, ?)`).run(meetingId, personId)
  db.prepare(
    `INSERT INTO meeting_analyses (id, meeting_id, source, transcript_text, topic, key_insight, action_items_json, status, created_at, updated_at)
     VALUES (?, ?, 'voice', 'תמלול', ?, ?, ?, 'completed', ?, ?)`,
  ).run(analysisId, meetingId, `תכנון השקה ${stamp}`, 'סיכמנו על תאריך השקה', JSON.stringify([{ content: 'לשלוח לוח זמנים', owner: name }]), now, now)
  db.prepare(
    `INSERT INTO voice_recordings (id, audio_path, mime_type, size_bytes, transcript_text, analysis_id, meeting_id, created_meeting_id, duration, status, consent_confirmed_at, created_at, updated_at)
     VALUES (?, '/nonexistent.webm', 'audio/webm', 10, 'תמלול', ?, ?, ?, 754, 'completed', ?, ?, ?)`,
  ).run(recordingId, analysisId, meetingId, meetingId, now, now, now)
  db.prepare(`INSERT INTO voice_recording_people (recording_id, person_id) VALUES (?, ?)`).run(recordingId, personId)

  const commitment = db.prepare(
    `INSERT INTO commitments (id, person_id, owner, content, source, source_id, source_snippet, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
  )
  commitment.run(`cm_email_${stamp}`, personId, 'them', `לשלוח חוזה ${stamp}`, 'email', `${account}::thr${stamp}`, 'Can you send the contract?', now, now)
  commitment.run(`cm_voice_${stamp}`, personId, 'them', `לשלוח לוח זמנים ${stamp}`, 'voice', meetingId, null, now, now)
  db.close()
  return { stamp, name, other, meetingId, recordingId }
}

test.describe('Email, voice and the shared commitment queue', () => {
  test('person card shows email threads, recordings and source badges', async ({ page }) => {
    const { stamp, name } = seed()
    await page.goto('/people')
    await page.getByPlaceholder('חיפוש אנשים...').fill(name)
    await page.getByText(name, { exact: true }).first().click()

    const emails = page.getByTestId('person-email-threads')
    await expect(emails).toBeVisible({ timeout: 20000 })
    await expect(emails).toContainText(`הצעת מחיר ${stamp}`)
    await expect(emails.getByRole('link', { name: `פתח ב-Gmail: הצעת מחיר ${stamp}` })).toHaveAttribute(
      'href',
      `https://mail.google.com/mail/u/?authuser=me%40work.com#all/thr${stamp}`,
    )

    const voice = page.getByTestId('person-voice-recordings')
    await expect(voice).toContainText(`תכנון השקה ${stamp}`)
    await expect(voice).toContainText('12:34')
    await voice.getByRole('button', { name: 'השמע הקלטה' }).click()
    await expect(voice.locator('audio')).toHaveCount(1)

    const commitments = page.getByTestId('person-commitments')
    await expect(commitments.getByTestId('commitment-source')).toHaveCount(2)
    expect((await commitments.getByTestId('commitment-source').allTextContents()).sort()).toEqual(['Email', 'הקלטה'])
    await expect(page.getByTestId('record-conversation-link')).toHaveAttribute('href', /\/voice\?person=/)
  })

  test('commitments page badges each source and links to Gmail or the recording', async ({ page }) => {
    const { stamp, meetingId } = seed()
    await page.goto('/commitments')
    await expect(page.getByTestId('commitments-list')).toBeVisible({ timeout: 20000 })

    const email = page.getByTestId('commitment-row').filter({ hasText: `לשלוח חוזה ${stamp}` })
    await expect(email.getByTestId('commitment-source')).toHaveText('Email')
    const gmail = email.getByTestId('commitment-source-link')
    await expect(gmail).toHaveText('פתח ב-Gmail')
    await expect(gmail).toHaveAttribute('target', '_blank')

    const voice = page.getByTestId('commitment-row').filter({ hasText: `לשלוח לוח זמנים ${stamp}` })
    await expect(voice.getByTestId('commitment-source')).toHaveText('הקלטה')
    await expect(voice).toContainText('מהקלטה ב-')
    await expect(voice.getByTestId('commitment-source-link')).toHaveAttribute('href', `/meetings/${meetingId}`)
  })

  test('voice page gates recording on consent and saves people on an analyzed recording', async ({ page }) => {
    const { stamp, other, recordingId } = seed()
    await page.goto('/voice')
    const start = page.getByTestId('voice-start')
    await expect(start).toBeDisabled({ timeout: 20000 })
    await page.getByTestId('voice-consent').check()
    await expect(start).toBeEnabled()

    await page.goto(`/voice?recording=${recordingId}`)
    const result = page.getByTestId('voice-result')
    await expect(result).toBeVisible({ timeout: 20000 })
    await expect(result.getByTestId('voice-status')).toHaveText('נותח')
    await expect(result).toContainText('סיכמנו על תאריך השקה')
    await expect(result).toContainText('לשלוח לוח זמנים')

    await result.getByLabel('לאיזה אנשים לקשר?').fill(other)
    await result.getByRole('option', { name: other }).click()
    await expect(result.getByTestId('voice-person-chip')).toHaveCount(2)
    await result.getByRole('button', { name: 'שמור קישור' }).click()
    await expect(result.getByRole('status')).toHaveText('נשמר')
    await expect(page.getByTestId('voice-recent')).toContainText(`תכנון השקה ${stamp}`)
  })

  test('upload endpoint refuses recordings without consent or under 10 seconds', async ({ request }) => {
    const audio = { name: 'r.webm', mimeType: 'audio/webm', buffer: Buffer.from('fake-audio') }
    const noConsent = await request.post('/api/voice/upload', {
      multipart: { audio, durationSeconds: '60', consentConfirmed: 'false' },
    })
    expect(noConsent.status()).toBe(400)
    expect((await noConsent.json()).error).toContain('הסכימו')

    const tooShort = await request.post('/api/voice/upload', {
      multipart: { audio, durationSeconds: '4', consentConfirmed: 'true' },
    })
    expect(tooShort.status()).toBe(400)
    expect((await tooShort.json()).error).toContain('קצרה')
  })
})

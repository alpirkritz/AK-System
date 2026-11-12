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
  const calendarMeetingId = `m_cal_${stamp}`
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

  // A calendar meeting covering the whole of today in the server's timezone, so the recording
  // screen always offers it as "עכשיו" regardless of when the suite runs.
  const localDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' }).format(new Date())
  db.prepare(
    `INSERT INTO meetings (id, title, date, time, end_time, location, source, created_at, updated_at)
     VALUES (?, ?, ?, '00:00', '23:59', 'חדר ישיבות', 'calendar', ?, ?)`,
  ).run(calendarMeetingId, `סטטוס שבועי ${stamp}`, localDate, now, now)
  db.prepare(`INSERT INTO meeting_people (meeting_id, person_id) VALUES (?, ?)`).run(calendarMeetingId, personId)
  db.prepare(
    `INSERT INTO meeting_analyses (id, meeting_id, source, transcript_text, topic, key_insight, action_items_json, status, created_at, updated_at)
     VALUES (?, ?, 'voice', 'תמלול', ?, ?, ?, 'completed', ?, ?)`,
  ).run(analysisId, meetingId, `תכנון השקה ${stamp}`, 'סיכמנו על תאריך השקה', JSON.stringify([{ content: 'לשלוח לוח זמנים', owner: name }]), now, now)
  db.prepare(
    `INSERT INTO voice_recordings (id, audio_path, mime_type, size_bytes, transcript_text, analysis_id, meeting_id, created_meeting_id, duration, status, consent_confirmed_at, created_at, updated_at)
     VALUES (?, '/nonexistent.webm', 'audio/webm', 10, 'תמלול', ?, ?, ?, 754, 'completed', ?, ?, ?)`,
  ).run(recordingId, analysisId, meetingId, meetingId, now, now, now)
  db.prepare(`INSERT INTO voice_recording_people (recording_id, person_id) VALUES (?, ?)`).run(recordingId, personId)
  const segment = db.prepare(
    `INSERT INTO voice_transcript_segments (id, recording_id, speaker_label, start_ms, end_ms, text, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  segment.run(`vts_${stamp}_1`, recordingId, 'דובר 1', 0, 3000, 'אני אשלח סיכום', now)
  segment.run(`vts_${stamp}_2`, recordingId, 'דובר 2', 3000, 6000, 'מצוין תודה', now)
  db.prepare(
    `INSERT INTO voice_speaker_identities (id, recording_id, speaker_label, person_id, state, created_at)
     VALUES (?, ?, 'דובר 2', ?, 'auto', ?)`,
  ).run(`vsi_${stamp}`, recordingId, personId, now)

  const commitment = db.prepare(
    `INSERT INTO commitments (id, person_id, owner, content, source, source_id, source_snippet, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
  )
  commitment.run(`cm_email_${stamp}`, personId, 'them', `לשלוח חוזה ${stamp}`, 'email', `${account}::thr${stamp}`, 'Can you send the contract?', now, now)
  commitment.run(`cm_voice_${stamp}`, personId, 'them', `לשלוח לוח זמנים ${stamp}`, 'voice', meetingId, null, now, now)

  // A group commitment with its surrounding messages, so the row can be read in context.
  const groupJid = `grp_${stamp}@g.us`
  const groupName = `צוות בדיקה ${stamp}`
  const msgTs = Date.now() - 45 * 60_000
  const message = db.prepare(
    `INSERT INTO whatsapp_messages (id, group_jid, wa_message_id, sender, sender_name, text, ts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  )
  message.run(`wm_a_${stamp}`, groupJid, `wa_a_${stamp}`, '972500000002@s.whatsapp.net', other, 'מה קורה עם ההצעה?', msgTs - 60_000, now)
  message.run(`wm_b_${stamp}`, groupJid, `wa_b_${stamp}`, '972500000001@s.whatsapp.net', name, `אשלח את ההצעה עד מחר ${stamp}`, msgTs, now)
  db.prepare(
    `INSERT INTO commitments (id, person_id, owner, content, source, source_id, source_snippet, source_ts, source_chat_jid, source_chat_name, source_reason, status, created_at, updated_at)
     VALUES (?, ?, 'me', ?, 'whatsapp_group', ?, ?, ?, ?, ?, ?, 'proposed', ?, ?)`,
  ).run(
    `cm_group_${stamp}`,
    personId,
    `לשלוח את ההצעה ${stamp}`,
    `wa_b_${stamp}`,
    `אשלח את ההצעה עד מחר ${stamp}`,
    msgTs,
    groupJid,
    groupName,
    'הובטח בקבוצה ולא נשלח עדיין.',
    now,
    now,
  )
  db.close()
  return { stamp, name, other, meetingId, calendarMeetingId, recordingId, groupName }
}

test.describe('Email, voice and the shared commitment queue', () => {
  test('person card shows email threads, recordings and source badges', async ({ page }) => {
    const { stamp, name } = seed()
    await page.goto('/people')
    await page.getByPlaceholder('חיפוש אנשים...').fill(name)
    await page.getByText(name, { exact: true }).first().click()

    const emails = page.getByTestId('person-email-thread').filter({ hasText: `הצעת מחיר ${stamp}` })
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
    await expect(commitments.getByTestId('commitment-source')).toHaveCount(3)
    expect((await commitments.getByTestId('commitment-source').allTextContents()).sort()).toEqual(['Email', 'WhatsApp', 'הקלטה'])
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
    await expect(voice.getByTestId('commitment-source-link')).toHaveAttribute('href', `/meetings/${meetingId}`)
  })

  test('a whatsapp commitment names its chat, when it was said, and opens the original messages', async ({ page }) => {
    const { stamp, name, other, groupName } = seed()
    await page.goto('/commitments')
    await expect(page.getByTestId('commitments-list')).toBeVisible({ timeout: 20000 })

    const row = page.getByTestId('commitment-row').filter({ hasText: `לשלוח את ההצעה ${stamp}` })
    // The conversation's own time, not when the scan ran.
    await expect(row).toContainText(groupName)
    await expect(row).toContainText('לפני 45 דק׳')
    await expect(row).toContainText('למה: הובטח בקבוצה ולא נשלח עדיין.')

    await row.getByTestId('commitment-context-toggle').click()
    const context = row.getByTestId('commitment-context')
    await expect(context).toContainText('מה קורה עם ההצעה?')
    await expect(context).toContainText(`אשלח את ההצעה עד מחר ${stamp}`)
    await expect(context).toContainText(other)
    await expect(context).toContainText(name)
  })

  test('voice page lists today meetings and records one straight from the list', async ({ page }) => {
    const { stamp, name, calendarMeetingId } = seed()
    await page.goto('/voice')

    const rows = page.getByTestId('voice-meeting-row')
    await expect(rows.first()).toBeVisible({ timeout: 20000 })
    // Other suites seed meetings into the same day, so the list may be collapsed past this one.
    const expand = page.getByRole('button', { name: /עוד פגישות להיום/ })
    if (await expand.isVisible()) await expand.click()
    const row = rows.filter({ hasText: `סטטוס שבועי ${stamp}` })
    await expect(row).toBeVisible()
    // Participants come from the calendar, so the row already shows who is in the room.
    await expect(row).toContainText(name)
    await expect(row).toContainText('עכשיו')

    // Unchecking consent must block every row, not only the free-recording button.
    await page.getByTestId('voice-consent').uncheck()
    await expect(row).toBeDisabled()
    await expect(page.getByText('צריך לאשר הסכמה קודם')).toBeVisible()
    await page.getByTestId('voice-consent').check()
    await expect(row).toBeEnabled()

    // The deep link from a meeting preselects it instead of showing the whole day.
    await page.goto(`/voice?meeting=${calendarMeetingId}`)
    const preset = page.getByTestId('voice-preset-meeting')
    await expect(preset).toContainText(`סטטוס שבועי ${stamp}`, { timeout: 20000 })
    await expect(preset.getByRole('link', { name: 'בחר פגישה אחרת' })).toHaveAttribute('href', '/voice')
  })

  test('voice page gates recording on consent and saves people on an analyzed recording', async ({ page }) => {
    const { stamp, other, recordingId } = seed()
    await page.goto('/voice')
    // The recorder sits beside the meeting list, so it is reachable without expanding anything.
    const start = page.getByTestId('voice-start')
    await expect(start).toBeEnabled({ timeout: 20000 })
    await page.getByTestId('voice-consent').uncheck()
    await expect(start).toBeDisabled()
    await page.getByTestId('voice-consent').check()
    await expect(start).toBeEnabled()

    await page.goto(`/voice?recording=${recordingId}`)
    const result = page.getByTestId('voice-result')
    await expect(result).toBeVisible({ timeout: 20000 })
    await expect(result.getByTestId('voice-status')).toHaveText('נותח')
    await expect(result).toContainText('סיכמנו על תאריך השקה')
    await expect(result).toContainText('לשלוח לוח זמנים')

    await result.getByLabel('משתתפים').fill(other)
    await result.getByRole('option', { name: other }).click()
    await expect(result.getByTestId('voice-person-chip')).toHaveCount(2)
    await result.getByRole('button', { name: 'שמור קישור' }).click()
    await expect(result.getByRole('status')).toHaveText('נשמר')
    await expect(page.getByTestId('voice-recent')).toContainText(`תכנון השקה ${stamp}`)
  })

  test('voice page shows an automatic speaker match and lets the user correct it', async ({ page }) => {
    const { name, other, recordingId } = seed()
    await page.goto(`/voice?recording=${recordingId}`)

    const automatic = page.getByTestId('voice-auto-speaker')
    await expect(automatic).toContainText(`זוהה אוטומטית: ${name}`, { timeout: 20000 })
    await automatic.getByRole('button', { name: 'לא נכון? תקן' }).click()
    await automatic.getByPlaceholder('הוסף אדם לפי שם').fill(other)
    await automatic.getByRole('option', { name: other }).click()
    // Picking only marks the row; nothing is saved until the one save button.
    await expect(automatic).toHaveCount(1)
    await expect(automatic.getByRole('button', { name: /שמור תיקון|זה הוא/ })).toHaveCount(0)
    await page.getByTestId('voice-speakers-save').click()

    await expect(automatic).toHaveCount(0)
    await expect(page.getByTestId('voice-unknown-speaker')).toContainText('דובר 1')
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

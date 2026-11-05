import { test, expect } from '@playwright/test'
import Database from 'better-sqlite3'
import path from 'node:path'

/**
 * docs/specs/recording-uses-chosen-people.md. There is no hook to fake Gemini inside the running
 * app, so this seeds the state processing leaves behind with a fake analyzer (covered by
 * packages/api/src/services/voice-chosen-people.test.ts): three chosen people, every speaker
 * attributed automatically, and an action item linked by personId whose owner was said as "עומרי".
 */
const dbPath = path.join(__dirname, '../data/e2e.sqlite')

function seed() {
  const db = new Database(dbPath)
  const now = new Date().toISOString()
  const stamp = Date.now()
  const omri = `p_omri_${stamp}`
  const dana = `p_dana_${stamp}`
  const yoav = `p_yoav_${stamp}`
  const omriName = `Omri Ben Simon ${stamp}`
  const meetingId = `m_voice_cp_${stamp}`
  const recordingId = `vr_cp_${stamp}`
  const analysisId = `ma_voice_cp_${stamp}`

  const person = db.prepare(`INSERT INTO people (id, name, status, source, created_at) VALUES (?, ?, 'confirmed', 'manual', ?)`)
  person.run(omri, omriName, now)
  person.run(dana, `דנה בדיקה ${stamp}`, now)
  person.run(yoav, `יואב בדיקה ${stamp}`, now)

  db.prepare(
    `INSERT INTO meetings (id, title, date, time, end_time, source, created_at, updated_at) VALUES (?, ?, ?, '10:00', '10:30', 'voice', ?, ?)`,
  ).run(meetingId, `שיחת צוות ${stamp}`, now.slice(0, 10), now, now)
  const attendee = db.prepare(`INSERT INTO meeting_people (meeting_id, person_id) VALUES (?, ?)`)
  for (const id of [omri, dana, yoav]) attendee.run(meetingId, id)

  db.prepare(
    `INSERT INTO meeting_analyses (id, meeting_id, source, transcript_text, topic, key_insight, participants_json, action_items_json, status, created_at, updated_at)
     VALUES (?, ?, 'voice', 'תמלול', ?, ?, ?, ?, 'completed', ?, ?)`,
  ).run(
    analysisId,
    meetingId,
    `תכנון רבעון ${stamp}`,
    'סוכם לוח זמנים',
    JSON.stringify([{ name: omriName, confirmed: true, personId: omri }]),
    JSON.stringify([{ content: `לשלוח את התוכנית ${stamp}`, owner: omriName, personId: omri }]),
    now,
    now,
  )
  db.prepare(
    `INSERT INTO voice_recordings (id, audio_path, mime_type, size_bytes, transcript_text, analysis_id, meeting_id, created_meeting_id, duration, status, consent_confirmed_at, created_at, updated_at)
     VALUES (?, '/nonexistent.webm', 'audio/webm', 10, 'תמלול', ?, ?, ?, 600, 'completed', ?, ?, ?)`,
  ).run(recordingId, analysisId, meetingId, meetingId, now, now, now)
  const tag = db.prepare(`INSERT INTO voice_recording_people (recording_id, person_id) VALUES (?, ?)`)
  for (const id of [omri, dana, yoav]) tag.run(recordingId, id)

  const segment = db.prepare(
    `INSERT INTO voice_transcript_segments (id, recording_id, speaker_label, start_ms, end_ms, text, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
  const identity = db.prepare(
    `INSERT INTO voice_speaker_identities (id, recording_id, speaker_label, person_id, state, created_at) VALUES (?, ?, ?, ?, 'auto', ?)`,
  )
  ;[
    ['דובר 1', omri, 'אני אשלח את התוכנית'],
    ['דובר 2', dana, 'עומרי, מתי זה יגיע?'],
    ['דובר 3', yoav, 'ואני אבדוק את התקציב'],
  ].forEach(([label, personId, text], i) => {
    segment.run(`vts_cp_${stamp}_${i}`, recordingId, label, i * 3000, i * 3000 + 2500, text, now)
    identity.run(`vsi_cp_${stamp}_${i}`, recordingId, label, personId, now)
  })
  db.close()
  return { recordingId, omri, omriName }
}

test.describe('recording uses the people chosen before upload', () => {
  test('every speaker is identified automatically and the action item shows the People name', async ({ page }) => {
    const { recordingId, omri, omriName } = seed()
    await page.goto(`/voice?recording=${recordingId}`)
    const result = page.getByTestId('voice-result')
    // The first hit on a cold dev server compiles the tRPC route.
    await expect(result.getByTestId('voice-status')).toHaveText('נותח', { timeout: 60_000 })

    // Nobody to ask about: no unknown-speaker rows, only the automatic matches.
    await expect(result.getByTestId('voice-auto-speaker')).toHaveCount(3)
    await expect(result.getByTestId('voice-unknown-speaker')).toHaveCount(0)
    await expect(result.getByTestId('voice-auto-speaker').first()).toContainText(`זוהה אוטומטית: ${omriName}`)

    const owner = result.getByTestId('voice-action-owner')
    await expect(owner).toHaveText(omriName)
    await expect(owner).toHaveAttribute('href', `/people?person=${omri}`)
  })
})
